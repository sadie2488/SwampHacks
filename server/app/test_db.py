"""Tests for the table statements built from the contract, the safe error text, and `python -m app.db`."""
import copy
import io
import json
import os
import re
import subprocess
import sys

import psycopg
import pytest
from jsonschema import Draft202012Validator

from . import config, db
from .testing_fakes import FakeDatabase

# Made-up pieces, assembled here so no address-shaped text sits in the source.
USER, PASSWORD, HOST, NAME = "leakuser7", "leakpass7", "leakhost7.invalid", "leakdb7"
FAKE_URL = "postgresql://" + USER + ":" + PASSWORD + "@" + HOST + ":5432/" + NAME


@pytest.fixture(scope="module")
def contract():
    return db.load_contract()


@pytest.fixture
def statements(contract):
    return db.build_schema_sql(contract)


def create_statement(statements, table):
    return next(s for s in statements if s.startswith(f'CREATE TABLE IF NOT EXISTS "{table}" '))


# --- the contract itself ---------------------------------------------------------------------------

def test_the_contract_file_follows_its_own_schema(contract):
    schema = json.loads((config.CONTRACTS_DIR / "db-schema.schema.json").read_text(encoding="utf-8"))
    assert list(Draft202012Validator(schema).iter_errors(contract)) == []


# --- tables ----------------------------------------------------------------------------------------

def test_every_table_in_the_contract_is_created_with_all_its_columns(contract, statements):
    creates = [s for s in statements if s.startswith("CREATE TABLE")]
    assert len(creates) == len(contract["tables"]) == 6
    for table in contract["tables"]:
        sql = create_statement(statements, table["name"])
        for column in table["columns"]:
            line = next(line.strip() for line in sql.splitlines() if line.strip().startswith(f'"{column["name"]}" '))
            assert f'"{column["name"]}" {column["type"]}' in line
            assert ("PRIMARY KEY" in line) == bool(column.get("primary_key"))
            required = not column.get("nullable", False) and not column.get("primary_key")
            assert ("NOT NULL" in line) == required, line
            if column.get("references"):
                ref_table, ref_column = column["references"].split(".")
                assert f'REFERENCES "{ref_table}" ("{ref_column}")' in line
            else:
                assert "REFERENCES" not in line


def test_primary_keys_and_defaults(statements):
    assert '"id" text PRIMARY KEY' in create_statement(statements, "songs")
    assert '"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()' in create_statement(statements, "analyses")
    assert '"created_at" timestamptz NOT NULL DEFAULT now()' in create_statement(statements, "songs")
    sessions = create_statement(statements, "practice_sessions")
    assert '"ended_at" timestamptz,' in sessions  # nullable timestamps have no default
    assert '"summary" jsonb' in sessions and '"user_id" text,' in sessions


def test_tables_come_after_the_tables_they_point_at(statements):
    order = [re.search(r'TABLE IF NOT EXISTS "(\w+)"', s).group(1) for s in statements if s.startswith("CREATE TABLE")]
    assert order.index("songs") < order.index("analyses")
    assert order.index("songs") < order.index("practice_sessions") < order.index("practice_samples")
    assert order.index("practice_sessions") < order.index("feedback_items")


def test_tables_listed_in_the_wrong_order_are_still_created_in_a_working_order(contract):
    flipped = copy.deepcopy(contract)
    flipped["tables"].reverse()
    order = [
        re.search(r'TABLE IF NOT EXISTS "(\w+)"', s).group(1) for s in db.build_schema_sql(flipped)
        if s.startswith("CREATE TABLE")
    ]
    assert order.index("songs") < order.index("practice_sessions") < order.index("feedback_items")


def test_identifiers_are_quoted_so_words_like_time_and_value_are_safe(statements):
    samples = create_statement(statements, "practice_samples")
    assert '"time" timestamptz NOT NULL DEFAULT now()' in samples and '"value" double precision NOT NULL' in samples


# --- the time-series table --------------------------------------------------------------------------

def test_the_hypertable_is_converted_only_when_timescaledb_is_there(statements):
    blocks = [s for s in statements if s.startswith("DO $$")]
    assert len(blocks) == 1  # only practice_samples is a hypertable
    block = blocks[0]
    assert "create_hypertable('practice_samples', 'time', if_not_exists => TRUE, migrate_data => TRUE)" in block
    # Guarded: only runs if the extension exists, and any failure leaves a plain table.
    assert "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'" in block
    assert block.count("EXCEPTION WHEN OTHERS THEN") == 2
    assert "stays a plain table" in block
    assert block.index("IF EXISTS (SELECT 1 FROM pg_extension") < block.index("PERFORM create_hypertable")
    # Created after the table exists and before the table's index.
    position = statements.index(block)
    assert statements.index(create_statement(statements, "practice_samples")) < position
    assert position < next(i for i, s in enumerate(statements) if "practice_samples_session_id_time_idx" in s)


def test_plain_tables_get_no_hypertable_call(statements):
    assert sum("create_hypertable" in s for s in statements) == 1


# --- indexes and later additions ----------------------------------------------------------------------

def test_every_index_in_the_contract_is_created(contract, statements):
    expected = []
    for table in contract["tables"]:
        for columns in table.get("indexes", []):
            cols = ", ".join(f'"{c}"' for c in columns)
            expected.append(
                f'CREATE INDEX IF NOT EXISTS "{table["name"]}_{"_".join(columns)}_idx" ON "{table["name"]}" ({cols})'
            )
    assert len(expected) == 4
    assert [s for s in statements if s.startswith("CREATE INDEX")] == expected


def test_long_index_names_are_shortened_to_fit_postgres(contract):
    doc = copy.deepcopy(contract)
    table = doc["tables"][2]
    columns = [c["name"] for c in table["columns"]]
    table["indexes"] = [columns]
    index = next(s for s in db.build_schema_sql(doc) if s.startswith("CREATE INDEX") and 'ON "practice_sessions"' in s)
    name = re.search(r'CREATE INDEX IF NOT EXISTS "(\w+)"', index).group(1)
    assert len(name) <= 63 and name.startswith("practice_sessions_id_user_id")


def test_every_statement_can_be_run_again(statements):
    for sql in statements:
        assert sql.startswith(("CREATE TABLE IF NOT EXISTS", "DO $$", "CREATE INDEX IF NOT EXISTS")), sql


def known_columns(doc):
    return {(t["name"], c["name"]) for t in doc["tables"] for c in t["columns"]}


def test_a_fresh_set_of_statements_has_no_alter_table(statements):
    assert not any(s.startswith("ALTER") for s in statements)


def test_columns_added_to_the_contract_later_are_added_to_existing_tables(contract):
    doc = copy.deepcopy(contract)
    already_there = known_columns(doc)
    doc["tables"][0]["columns"] += [
        {"name": "tags", "type": "jsonb", "nullable": True},
        {"name": "added_at", "type": "timestamptz"},
        {"name": "plays", "type": "integer"},
    ]
    everything = db.build_schema_sql(doc, already_there)
    alters = [s for s in everything if s.startswith("ALTER")]
    assert alters == [
        'ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "tags" jsonb',
        # A required column can only be added to a table that already has rows if it has a default.
        'ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "added_at" timestamptz NOT NULL DEFAULT now()',
        'ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "plays" integer',
    ]
    # New columns exist before anything (like an index) can use them.
    assert everything.index(alters[-1]) > everything.index(create_statement(everything, "feedback_items"))
    assert everything.index(alters[-1]) < next(i for i, s in enumerate(everything) if s.startswith("DO $$"))
    assert db.build_schema_sql(doc, known_columns(doc)) == db.build_schema_sql(doc)  # nothing missing, nothing added


def test_primary_keys_are_never_added_later(contract):
    without_ids = {pair for pair in known_columns(contract) if pair[1] != "id"}
    assert db.add_missing_columns_sql(contract, without_ids) == []


# --- bad contracts ---------------------------------------------------------------------------------

def broken(contract, change):
    doc = copy.deepcopy(contract)
    change(doc)
    return doc


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.__setitem__("version", 2),
        lambda d: d["tables"][0].__setitem__("name", 'songs"; DROP TABLE songs; --'),
        lambda d: d["tables"][0]["columns"][0].__setitem__("name", "Id"),
        lambda d: d["tables"][0]["columns"][1].__setitem__("type", "text); DROP TABLE x; --"),
        lambda d: d["tables"][1]["columns"][1].__setitem__("references", "nowhere.id"),
        lambda d: d["tables"][1]["columns"][1].__setitem__("references", "songs.nothing"),
        lambda d: d["tables"][1].__setitem__("indexes", [["not_a_column"]]),
        lambda d: d["tables"][3].__setitem__("time_column", "metric"),
        lambda d: d["tables"][3].__setitem__("time_column", "missing"),
    ],
)
def test_a_broken_contract_is_refused_before_any_sql_is_written(contract, change):
    with pytest.raises(ValueError):
        db.build_schema_sql(broken(contract, change))


def test_tables_that_point_at_each_other_are_refused(contract):
    def loop(doc):
        doc["tables"][0]["columns"].append({"name": "latest_session", "type": "uuid", "nullable": True,
                                            "references": "practice_sessions.id"})

    with pytest.raises(ValueError, match="circle"):
        db.build_schema_sql(broken(contract, loop))


# --- safe error text ---------------------------------------------------------------------------------

def test_redact_hides_the_connection_string_and_each_part_of_it(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", FAKE_URL)
    text = f"could not connect to {FAKE_URL}; user {USER} pw {PASSWORD} host {HOST} db {NAME}"
    cleaned = db.redact(text)
    for part in (FAKE_URL, USER, PASSWORD, HOST, NAME):
        assert part not in cleaned
    assert cleaned.count(db.HIDDEN) + cleaned.count("[address hidden]") >= 4


def test_redact_handles_encoded_passwords(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://" + USER + ":" + "p%40ss%2Fword9" + "@" + HOST + "/" + NAME)
    assert "p@ss/word9" not in db.redact("login failed for p@ss/word9") and "p%40ss" not in db.redact("p%40ss%2Fword9")


def test_redact_hides_the_other_private_values(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "markergemini-1234")
    monkeypatch.setenv("AUTH0_DOMAIN", "markertenant7.invalid")
    monkeypatch.setenv("VULTR_S3_SECRET_KEY", "markerstorage-9876")
    cleaned = db.redact("a markergemini-1234 b markertenant7.invalid c markerstorage-9876")
    assert "marker" not in cleaned


def test_redact_hides_address_shaped_text_even_when_the_environment_is_empty():
    nasty = (
        'connection to server at "db-1.example.invalid" (10.20.30.40), port 5432 failed: FATAL: password '
        'authentication failed for user "someone" database "stuff" '
        "host=db-2.example.invalid user=someone password=hunter2 dbname=stuff service=prod "
        "see https://db-3.example.invalid/path?x=1 and postgres://some-host.invalid/db"
    )
    cleaned = db.redact(nasty)
    for fragment in ("db-1", "10.20.30.40", "someone", "stuff", "db-2", "hunter2", "db-3", "some-host", "prod"):
        assert fragment not in cleaned, fragment
    assert "port 5432 failed" in cleaned  # the useful part stays


def test_redact_hides_extra_values_and_leaves_plain_text_alone():
    assert db.redact("hello leakword and more", extra=["leakword"]) == f"hello {db.HIDDEN} and more"
    assert db.redact("The song was too short.") == "The song was too short."


def test_describe_error_explains_without_leaking(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", FAKE_URL)
    refused = psycopg.OperationalError(
        f'connection failed: connection to server at "{HOST}" (10.1.2.3), port 5432 failed: {FAKE_URL}\nsecond line'
    )
    text = db.describe_error(refused)
    assert text.startswith("OperationalError: could not reach the database")
    assert "second line" not in text  # only the first line of the message is kept
    for part in (FAKE_URL, USER, PASSWORD, HOST, NAME, "10.1.2.3"):
        assert part not in text


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (psycopg.errors.InvalidPassword("nope"), "check the user and password"),
        (psycopg.errors.InvalidAuthorizationSpecification("nope"), "check the user and password"),
        (psycopg.errors.InvalidCatalogName("nope"), "database name does not exist"),
        (psycopg.errors.UndefinedTable("nope"), "app.db migrate"),
        (psycopg.errors.InsufficientPrivilege("nope"), "not allowed"),
    ],
)
def test_describe_error_gives_a_hint_for_the_common_failures(error, expected):
    text = db.describe_error(error)
    assert expected in text and error.sqlstate in text


def test_describe_error_copes_with_odd_errors():
    assert db.describe_error(ValueError()) == "ValueError"
    assert db.describe_error(RuntimeError("plain words")) == "RuntimeError: plain words"


# --- the command line ----------------------------------------------------------------------------------

def run_main(*args):
    out = io.StringIO()
    code = db.main(list(args), out=out)
    return code, out.getvalue()


def test_status_says_memory_without_a_database_address():
    code, text = run_main("status")
    assert code == 0 and text.startswith("repository: memory")


def test_status_says_postgres_but_never_shows_the_address(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", FAKE_URL)
    code, text = run_main("status")
    assert code == 0 and text.startswith("repository: postgres")
    for part in (FAKE_URL, USER, PASSWORD, HOST, NAME):
        assert part not in text


def test_sql_prints_every_statement_without_needing_a_database(statements):
    code, text = run_main("sql")
    assert code == 0 and text.count(";\n\n") == len(statements)
    assert 'CREATE TABLE IF NOT EXISTS "creations"' in text


def test_migrate_and_ping_need_a_database_address():
    for command in ("migrate", "ping"):
        code, text = run_main(command)
        assert code == 2 and "DATABASE_URL is not set" in text


def test_migrate_runs_every_statement_in_one_transaction(monkeypatch, contract):
    monkeypatch.setenv("DATABASE_URL", FAKE_URL)
    tables, finish = db.create_tables_sql(contract), db.finish_schema_sql(contract)
    database = FakeDatabase([[]] * len(tables) + [sorted(known_columns(contract))])
    monkeypatch.setattr(psycopg, "connect", database)
    code, text = run_main("migrate")
    assert code == 0 and f"{len(tables) + len(finish)} statements applied" in text
    assert len(database.connections) == 1
    connection = database.connections[0]
    assert [sql for sql, _ in connection.statements] == [*tables, db.EXISTING_COLUMNS_SQL, *finish]
    assert connection.committed and connection.closed
    assert database.calls[0] == (FAKE_URL, {"connect_timeout": db.CONNECT_TIMEOUT_SEC})
    assert FAKE_URL not in text


def test_migrate_adds_columns_that_an_older_database_is_missing(monkeypatch, contract):
    monkeypatch.setenv("DATABASE_URL", FAKE_URL)
    tables, finish = db.create_tables_sql(contract), db.finish_schema_sql(contract)
    older = sorted(known_columns(contract) - {("songs", "file_name"), ("practice_samples", "song_time_sec")})
    database = FakeDatabase([[]] * len(tables) + [older])
    monkeypatch.setattr(psycopg, "connect", database)
    code, text = run_main("migrate")
    assert code == 0 and f"{len(tables) + 2 + len(finish)} statements applied" in text
    executed = [sql for sql, _ in database.connections[0].statements]
    assert executed == [
        *tables, db.EXISTING_COLUMNS_SQL,
        'ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "file_name" text',
        'ALTER TABLE "practice_samples" ADD COLUMN IF NOT EXISTS "song_time_sec" double precision',
        *finish,
    ]


def test_a_failed_migrate_reports_in_safe_words_and_exits_with_an_error(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", FAKE_URL)
    error = psycopg.OperationalError(f'connection to server at "{HOST}" (10.4.4.4), port 5432 failed: {FAKE_URL}')
    monkeypatch.setattr(psycopg, "connect", FakeDatabase(error=error))
    code, text = run_main("migrate")
    assert code == 1 and text.startswith("That did not work: OperationalError")
    for part in (FAKE_URL, USER, PASSWORD, HOST, NAME, "10.4.4.4"):
        assert part not in text


def test_ping_runs_select_one(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", FAKE_URL)
    database = FakeDatabase()
    monkeypatch.setattr(psycopg, "connect", database)
    code, text = run_main("ping")
    assert code == 0 and "answered" in text
    assert database.statements == [("SELECT 1", None)]


def test_an_unknown_command_prints_usage():
    code, text = run_main("explode")
    assert code == 2 and "Usage:" in text
    assert run_main()[0] == 2


def test_the_module_runs_from_the_command_line_and_prints_no_address():
    env = {**os.environ, "DATABASE_URL": ""}  # blank counts as "not set", even if a real server/.env exists
    done = subprocess.run(
        [sys.executable, "-m", "app.db", "status"],
        check=False, cwd=config.SERVER_ROOT, capture_output=True, text=True, timeout=120, env=env,
    )
    assert done.returncode == 0, done.stderr[-500:]
    assert done.stdout.startswith("repository: memory")
