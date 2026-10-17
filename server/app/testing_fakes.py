"""Stand-ins for a database connection, so tests can check the SQL without touching any database."""


class FakeCursor:
    def __init__(self, connection, rows):
        self._connection = connection
        self._rows = list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def executemany(self, sql, rows):
        self._connection.statements.append((sql, list(rows)))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConnection:
    """Records every statement. `results` are handed out one per `execute` call, in order."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []  # (sql, params); for executemany the params are the list of rows
        self.committed = False
        self.closed = False

    def execute(self, sql, params=None):
        self.statements.append((sql, params))
        return FakeCursor(self, self._results.pop(0) if self._results else [])

    def cursor(self):
        return FakeCursor(self, [])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.committed = exc_type is None
        self.closed = True
        return False


class FakeDatabase:
    """Used in place of `psycopg.connect`. Each call hands back a new connection.

    `FakeDatabase(first, second)`: `first` is the list of result sets (one per `execute`) for the
    first connection, `second` for the next one, and so on. Missing results are empty.
    """

    def __init__(self, *per_connection, error=None):
        self._per_connection = list(per_connection)
        self._error = error
        self.calls = []  # (url, keyword arguments) per connection attempt
        self.connections = []

    def __call__(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self._error is not None:
            raise self._error
        connection = FakeConnection(self._per_connection.pop(0) if self._per_connection else [])
        self.connections.append(connection)
        return connection

    @property
    def statements(self):
        return [statement for connection in self.connections for statement in connection.statements]
