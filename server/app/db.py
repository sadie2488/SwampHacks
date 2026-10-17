"""Database setup: tables built from `contracts/db-schema.json`, safe error text, and a small command line.

    uv run python -m app.db status    which repository the server would use (never prints the address)
    uv run python -m app.db sql       print the table statements without touching a database
    uv run python -m app.db ping      connect once and run SELECT 1
    uv run python -m app.db migrate   create the tables (safe to run again)

The connection string comes from the environment variable DATABASE_URL (server/.env is loaded by
`config`). Nothing in this module prints or returns it, and error text goes through `redact` first.
"""
import hashlib
import json
import os
import re
import sys
from collections.abc import Callable, Iterable
from typing import Any
from urllib.parse import unquote, urlsplit

import psycopg

from . import config

SCHEMA_FILE = config.CONTRACTS_DIR / "db-schema.json"
CONNECT_TIMEOUT_SEC = 5
HIDDEN = "[hidden]"

_NAME = re.compile(r"^[a-z][a-z0-9_]*$")
_TYPES = frozenset({"text", "integer", "bigint", "double precision", "boolean", "timestamptz", "jsonb", "uuid"})
_MAX_IDENTIFIER = 63


# --- tables ------------------------------------------------------------------------------------

def load_contract(path=SCHEMA_FILE) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _ident(name: Any) -> str:
    if not isinstance(name, str) or not _NAME.match(name):
        raise ValueError("The database contract has a name that is not lowercase letters, digits and underscores.")
    return f'"{name}"'


def _split_reference(ref: str, tables: dict[str, dict]) -> tuple[str, str]:
    table_name, _, column_name = ref.partition(".")
    target = tables.get(table_name)
    if target is None or column_name not in {c["name"] for c in target["columns"]}:
        raise ValueError(f"The database contract points at {ref}, which does not exist.")
    return table_name, column_name


def _default(column: dict) -> str | None:
    """Defaults the contract does not spell out: new ids and "now" for required timestamps."""
    if column.get("primary_key") and column["type"] == "uuid":
        return "gen_random_uuid()"
    if column["type"] == "timestamptz" and not column.get("nullable", False):
        return "now()"
    return None


def _column_sql(column: dict, tables: dict[str, dict], *, adding: bool) -> str:
    if column["type"] not in _TYPES:
        raise ValueError(f"The database contract uses a column type we do not support: {column['type']}.")
    parts = [_ident(column["name"]), column["type"]]
    default = _default(column)
    if column.get("primary_key"):
        parts.append("PRIMARY KEY")
    elif not column.get("nullable", False) and (default or not adding):
        # Columns added to an existing table can only be required when they have a default.
        parts.append("NOT NULL")
    if default:
        parts.append(f"DEFAULT {default}")
    if column.get("references"):
        ref_table, ref_column = _split_reference(column["references"], tables)
        parts.append(f"REFERENCES {_ident(ref_table)} ({_ident(ref_column)})")
    return " ".join(parts)


def _in_creation_order(tables: dict[str, dict]) -> list[dict]:
    """Tables sorted so each one comes after the tables it points at."""
    ordered: list[dict] = []
    placed: set[str] = set()
    pending = list(tables.values())
    while pending:
        ready = [
            t for t in pending
            if all(
                c["references"].partition(".")[0] in placed or c["references"].partition(".")[0] == t["name"]
                for c in t["columns"] if c.get("references")
            )
        ]
        if not ready:
            raise ValueError("The database contract has tables that point at each other in a circle.")
        for table in ready:
            ordered.append(table)
            placed.add(table["name"])
            pending.remove(table)
    return ordered


def _index_name(table: str, columns: list[str]) -> str:
    name = f"{table}_{'_'.join(columns)}_idx"
    if len(name) > _MAX_IDENTIFIER:
        digest = hashlib.sha1(name.encode("ascii")).hexdigest()[:8]
        name = f"{name[: _MAX_IDENTIFIER - 9]}_{digest}"
    return name


def _hypertable_sql(table: dict) -> str:
    time_column = table.get("time_column")
    columns = {c["name"]: c for c in table["columns"]}
    if time_column not in columns or columns[time_column]["type"] != "timestamptz":
        raise ValueError(f"The time column of {table['name']} must be a timestamptz column of that table.")
    _ident(table["name"])
    _ident(time_column)
    name = table["name"]
    return (
        "DO $$\n"
        "BEGIN\n"
        "  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN\n"
        "    BEGIN\n"
        "      CREATE EXTENSION IF NOT EXISTS timescaledb;\n"
        "    EXCEPTION WHEN OTHERS THEN\n"
        "      RAISE NOTICE 'TimescaleDB is not available, so " + name + " stays a plain table.';\n"
        "    END;\n"
        "  END IF;\n"
        "  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN\n"
        "    BEGIN\n"
        f"      PERFORM create_hypertable('{name}', '{time_column}', if_not_exists => TRUE, migrate_data => TRUE);\n"
        "    EXCEPTION WHEN OTHERS THEN\n"
        "      RAISE NOTICE 'Could not turn " + name + " into a time series table, so it stays a plain table.';\n"
        "    END;\n"
        "  END IF;\n"
        "END\n"
        "$$"
    )


def _tables_in_order(doc: dict) -> tuple[dict[str, dict], list[dict]]:
    if doc.get("version") != 1:
        raise ValueError("This database contract version is not supported.")
    tables = {t["name"]: t for t in doc["tables"]}
    for table in tables.values():
        _ident(table["name"])
    return tables, _in_creation_order(tables)


def create_tables_sql(doc: dict) -> list[str]:
    """One CREATE TABLE IF NOT EXISTS per table, tables that others point at first."""
    tables, ordered = _tables_in_order(doc)
    statements = []
    for table in ordered:
        columns = ",\n".join("  " + _column_sql(c, tables, adding=False) for c in table["columns"])
        statements.append(f"CREATE TABLE IF NOT EXISTS {_ident(table['name'])} (\n{columns}\n)")
    return statements


def add_missing_columns_sql(doc: dict, existing: set[tuple[str, str]]) -> list[str]:
    """ALTER TABLE statements for columns the contract has gained since the table was created.

    `existing` holds (table, column) pairs that are already in the database. The contract only ever
    grows, so nothing is dropped or changed. A new required column gets a default only if it is a
    timestamp, because a required column without a default cannot be added to a table with rows.
    """
    tables, ordered = _tables_in_order(doc)
    return [
        f"ALTER TABLE {_ident(table['name'])} ADD COLUMN IF NOT EXISTS {_column_sql(column, tables, adding=True)}"
        for table in ordered
        for column in table["columns"]
        if not column.get("primary_key") and (table["name"], column["name"]) not in existing
    ]


def finish_schema_sql(doc: dict) -> list[str]:
    """The time-series conversion for hypertables, then the indexes."""
    _, ordered = _tables_in_order(doc)
    statements = [_hypertable_sql(table) for table in ordered if table["kind"] == "hypertable"]
    for table in ordered:
        names = {c["name"] for c in table["columns"]}
        for columns in table.get("indexes", []):
            if not set(columns) <= names:
                raise ValueError(f"An index of {table['name']} uses a column that does not exist.")
            cols = ", ".join(_ident(c) for c in columns)
            statements.append(
                f"CREATE INDEX IF NOT EXISTS {_ident(_index_name(table['name'], columns))} "
                f"ON {_ident(table['name'])} ({cols})"
            )
    return statements


def build_schema_sql(doc: dict, existing_columns: set[tuple[str, str]] | None = None) -> list[str]:
    """Every statement that sets up the contract's tables, in the order they must run. Safe to run again.

    Order: tables, columns added to the contract since an earlier run (only when `existing_columns`,
    the (table, column) pairs already in the database, is given), the time-series conversion for the
    hypertable (skipped, leaving a plain table, when TimescaleDB is missing), then indexes. Names and
    types are checked against the contract's own rules first.
    """
    extra = [] if existing_columns is None else add_missing_columns_sql(doc, existing_columns)
    return create_tables_sql(doc) + extra + finish_schema_sql(doc)


# --- the connection string and what is safe to say about it --------------------------------------

def database_url() -> str | None:
    """The connection string, or None when the server should run in the in-memory demo mode."""
    return os.environ.get("DATABASE_URL", "").strip() or None


def repository_kind() -> str:
    return "postgres" if database_url() else "memory"


_PRIVATE_ENV_NAMES = tuple(n for n in config.ENV_VAR_NAMES if n not in ("MUSIC_DATA_DIR", "AUTH0_CLIENT_ID")) + (
    "AUTH0_AUDIENCE",
)
_PATTERNS = (
    (re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^\s'\"<>]+"), "[address hidden]"),
    (re.compile(r"(?i)\b(password|passfile|user|host|hostaddr|dbname|service|sslkey|sslcert)\s*=\s*('[^']*'|\S+)"),
     r"\1=" + HIDDEN),
    (re.compile(r'(?i)\b(server at|user|role|database|host name|host) "[^"]*"'), r'\1 "' + HIDDEN + '"'),
    (re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"), "[address hidden]"),
)


def _known_secrets() -> set[str]:
    secrets: set[str] = set()
    for name in _PRIVATE_ENV_NAMES:
        value = os.environ.get(name, "").strip()
        if len(value) >= 4:
            secrets.add(value)
    url = database_url()
    if url:
        try:
            parts = urlsplit(url)
            pieces = [parts.username, parts.password, parts.hostname, parts.path.lstrip("/")]
        except ValueError:
            pieces = []
        for piece in pieces:
            if piece and len(piece) >= 3:
                secrets.update({piece, unquote(piece)})
    return secrets


def redact(text: str, extra: Iterable[str] = ()) -> str:
    """Hide the connection string and its parts, the other private values, and anything address-shaped."""
    text = str(text)
    for secret in sorted(_known_secrets() | {s for s in extra if s and len(s) >= 3}, key=len, reverse=True):
        text = text.replace(secret, HIDDEN)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


_HINTS = {
    "28P01": "the database refused the login (check the user and password in DATABASE_URL)",
    "28000": "the database refused the login (check the user and password in DATABASE_URL)",
    "3D000": "that database name does not exist on the server",
    "42P01": "a table is missing (run: uv run python -m app.db migrate)",
    "42501": "the database user is not allowed to do that",
}


def describe_error(exc: BaseException) -> str:
    """One safe line about a failure: what kind, a hint, and the database's own message with secrets removed."""
    kind = type(exc).__name__
    sqlstate = getattr(exc, "sqlstate", None)
    hint = _HINTS.get(sqlstate or "")
    if hint is None and isinstance(exc, psycopg.OperationalError) and not sqlstate:
        hint = "could not reach the database (check DATABASE_URL, the network, and that the project is running)"
    first_line = redact(str(exc).strip().splitlines()[0] if str(exc).strip() else "")[:200]
    pieces = [kind + (f" (SQLSTATE {sqlstate})" if sqlstate else "")]
    if hint:
        pieces.append(hint)
    if first_line:
        pieces.append(first_line)
    return ": ".join(pieces)


# --- command line --------------------------------------------------------------------------------

EXISTING_COLUMNS_SQL = "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()"


def apply_schema(connect: Callable[..., Any] | None = None) -> int:
    """Set up the tables in the database named by DATABASE_URL, all in one transaction. Returns the statement count.

    A fresh database gets the tables, the time-series conversion and the indexes. A database from an
    earlier run also gets any columns the contract has gained since.
    """
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set.")
    doc = load_contract()
    connect = connect or psycopg.connect
    with connect(url, connect_timeout=CONNECT_TIMEOUT_SEC) as conn:
        statements = create_tables_sql(doc)
        for statement in statements:
            conn.execute(statement)
        existing = {(table, column) for table, column in conn.execute(EXISTING_COLUMNS_SQL).fetchall()}
        later = add_missing_columns_sql(doc, existing) + finish_schema_sql(doc)
        for statement in later:
            conn.execute(statement)
    return len(statements) + len(later)


def _ping(connect: Callable[..., Any] | None = None) -> None:
    connect = connect or psycopg.connect
    with connect(database_url(), connect_timeout=CONNECT_TIMEOUT_SEC) as conn:
        conn.execute("SELECT 1")


def main(argv: list[str] | None = None, out=None) -> int:
    out = out or sys.stdout
    args = list(sys.argv[1:] if argv is None else argv)
    command = args[0] if args else ""

    def say(text: str) -> None:
        print(text, file=out)

    if command == "status":
        if database_url():
            say("repository: postgres (DATABASE_URL is set; the address is not shown)")
        else:
            say("repository: memory (DATABASE_URL is not set; saved data is lost when the server restarts)")
        return 0
    if command == "sql":
        for statement in build_schema_sql(load_contract()):
            say(statement + ";\n")
        return 0
    if command in ("ping", "migrate"):
        if not database_url():
            say("DATABASE_URL is not set, so there is no database to talk to. Add it to server/.env first.")
            return 2
        try:
            if command == "ping":
                _ping()
                say("The database answered.")
            else:
                count = apply_schema()
                say(f"Done: {count} statements applied. The tables are ready.")
        except Exception as exc:  # noqa: BLE001 - every failure is reported in safe words, never raw
            say(f"That did not work: {describe_error(exc)}")
            return 1
        return 0
    say("Usage: python -m app.db status | sql | ping | migrate")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
