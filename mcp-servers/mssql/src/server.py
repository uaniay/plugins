import json
import re
from os import environ

import pymssql
import sqlglot
import sqlglot.expressions as exp
from mcp.server import MCPServer

server = MCPServer("mcp-mssql-query")

# Statements that must never appear even inside a SELECT
_FORBIDDEN_STATEMENT_TYPES = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Drop,
    exp.Create,
    exp.Alter,
    exp.Command,
    exp.Transaction,
    exp.Rollback,
    exp.Commit,
    exp.Grant,
    exp.Revoke,
    exp.TruncateTable,
    exp.Use,
)

# Dangerous functions that can write data or execute arbitrary code
_FORBIDDEN_FUNCTIONS = {
    "xp_cmdshell",
    "sp_executesql",
    "exec",
    "execute",
    "openrowset",
    "opendatasource",
    "bulk",
    "writetext",
    "updatetext",
}


def _get_conn_params() -> dict:
    import os
    # FreeTDS defaults to TDS 7.0; SQL Server 2012+ requires 7.4
    os.environ.setdefault("TDSVER", "7.4")
    return {
        "server": environ.get("MSSQL_HOST", "localhost"),
        "port": int(environ.get("MSSQL_PORT", "1433")),
        "database": environ.get("MSSQL_DATABASE", ""),
        "user": environ.get("MSSQL_USERNAME", ""),
        "password": environ.get("MSSQL_PASSWORD", ""),
        "login_timeout": 10,
        "as_dict": True,
    }


def validate_query(sql: str) -> str | None:
    """Return an error message if the query is not safe, else None."""
    stripped = sql.strip()

    # Must start with SELECT (after optional CTEs)
    first_word = re.split(r"\s+", stripped, maxsplit=1)[0].upper()
    if first_word not in ("SELECT", "WITH"):
        return "Only SELECT queries are allowed."

    # Check for stacked statements via semicolons (allow trailing semicolon only)
    # Remove string literals to avoid false positives
    no_strings = re.sub(r"'[^']*'", "''", stripped)
    no_strings = re.sub(r'"[^"]*"', '""', no_strings)
    statements = [s.strip() for s in no_strings.split(";") if s.strip()]
    if len(statements) > 1:
        return "Multiple statements are not allowed."

    # Parse with sqlglot
    try:
        parsed = sqlglot.parse(sql, dialect="tsql")
    except sqlglot.errors.ParseError as e:
        return f"SQL parse error: {e}"

    if not parsed:
        return "Could not parse SQL statement."

    for statement in parsed:
        if statement is None:
            continue

        # Top-level must be SELECT (or WITH leading into SELECT)
        if not isinstance(statement, (exp.Select, exp.With)):
            return f"Statement type '{type(statement).__name__}' is not allowed. Only SELECT is permitted."

        # Walk entire AST looking for forbidden node types
        for node in statement.walk():
            if isinstance(node, _FORBIDDEN_STATEMENT_TYPES):
                return f"Statement contains forbidden operation: {type(node).__name__}."

            # Check for dangerous function calls
            if isinstance(node, (exp.Anonymous, exp.Func)):
                fname = (
                    node.name.lower()
                    if hasattr(node, "name") and node.name
                    else ""
                )
                if fname in _FORBIDDEN_FUNCTIONS:
                    return f"Function '{fname}' is not allowed."

    # Block EXEC / EXECUTE patterns not caught by parser
    if re.search(r"\bexec(?:ute)?\b", no_strings, re.IGNORECASE):
        return "EXEC/EXECUTE is not allowed."

    return None


def run_query(sql: str, max_rows: int) -> dict:
    params = _get_conn_params()
    if not params["user"] and not params["password"]:
        return {"error": "MSSQL_USERNAME and MSSQL_PASSWORD are not configured."}

    try:
        with pymssql.connect(**params) as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql)
                columns = [col[0] for col in cursor.description]
                rows = []
                for row in cursor.fetchmany(max_rows + 1):
                    rows.append({
                        k: (v.isoformat() if hasattr(v, "isoformat") else v)
                        for k, v in row.items()
                    })
                truncated = len(rows) > max_rows
                if truncated:
                    rows = rows[:max_rows]
                return {
                    "columns": columns,
                    "rows": rows,
                    "row_count": len(rows),
                    "truncated": truncated,
                }
    except pymssql.Error as e:
        return {"error": f"Database error: {e}"}


@server.tool()
def query_mssql(
    sql: str,
    max_rows: int = 100,
) -> str:
    """Run a read-only SELECT query against the configured MSSQL database.

    Only SELECT statements are accepted. INSERT, UPDATE, DELETE, DDL, stored
    procedures, and any other data-modifying or code-executing constructs are
    rejected. Parameterized queries are not supported — pass literal values only.

    Args:
        sql: A SELECT SQL statement to execute (T-SQL dialect).
        max_rows: Maximum number of rows to return (default 100, max 1000).
    """
    max_rows = min(max(1, max_rows), 1000)

    err = validate_query(sql)
    if err:
        return json.dumps({"error": err})

    result = run_query(sql, max_rows)
    return json.dumps(result, ensure_ascii=False, default=str)


def main():
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
