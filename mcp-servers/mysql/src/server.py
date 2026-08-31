import json
import re
from os import environ

import pymysql
import pymysql.cursors
import sqlglot
import sqlglot.expressions as exp
from mcp.server import MCPServer

server = MCPServer("mcp-mysql-query")

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

# MySQL-specific dangerous constructs
_FORBIDDEN_FUNCTIONS = {
    "load_file",
    "into_outfile",
    "into_dumpfile",
    "sys_eval",
    "sys_exec",
    "sys_get",
}


def _get_conn_params() -> dict:
    return {
        "host": environ.get("MYSQL_HOST", "localhost"),
        "port": int(environ.get("MYSQL_PORT", "3306")),
        "db": environ.get("MYSQL_DATABASE", ""),
        "user": environ.get("MYSQL_USERNAME", ""),
        "password": environ.get("MYSQL_PASSWORD", ""),
        "connect_timeout": 10,
        "cursorclass": pymysql.cursors.DictCursor,
        "charset": "utf8mb4",
    }


def validate_query(sql: str) -> str | None:
    """Return an error message if the query is not safe, else None."""
    stripped = sql.strip()

    first_word = re.split(r"\s+", stripped, maxsplit=1)[0].upper()
    if first_word not in ("SELECT", "WITH"):
        return "Only SELECT queries are allowed."

    # Remove string literals to avoid false positives on semicolon check
    no_strings = re.sub(r"'[^']*'", "''", stripped)
    no_strings = re.sub(r'"[^"]*"', '""', no_strings)
    statements = [s.strip() for s in no_strings.split(";") if s.strip()]
    if len(statements) > 1:
        return "Multiple statements are not allowed."

    # Block LOAD DATA INFILE / SELECT ... INTO OUTFILE at text level
    if re.search(r"\bLOAD\s+DATA\b", no_strings, re.IGNORECASE):
        return "LOAD DATA is not allowed."
    if re.search(r"\bINTO\s+(?:OUTFILE|DUMPFILE)\b", no_strings, re.IGNORECASE):
        return "SELECT INTO OUTFILE/DUMPFILE is not allowed."

    try:
        parsed = sqlglot.parse(sql, dialect="mysql")
    except sqlglot.errors.ParseError as e:
        return f"SQL parse error: {e}"

    if not parsed:
        return "Could not parse SQL statement."

    for statement in parsed:
        if statement is None:
            continue

        if not isinstance(statement, (exp.Select, exp.With)):
            return f"Statement type '{type(statement).__name__}' is not allowed. Only SELECT is permitted."

        for node in statement.walk():
            if isinstance(node, _FORBIDDEN_STATEMENT_TYPES):
                return f"Statement contains forbidden operation: {type(node).__name__}."

            if isinstance(node, (exp.Anonymous, exp.Func)):
                fname = (
                    node.name.lower()
                    if hasattr(node, "name") and node.name
                    else ""
                )
                if fname in _FORBIDDEN_FUNCTIONS:
                    return f"Function '{fname}' is not allowed."

    return None


def run_query(sql: str, max_rows: int) -> dict:
    params = _get_conn_params()
    if not params["user"]:
        return {"error": "MYSQL_USERNAME is not configured."}

    try:
        with pymysql.connect(**params) as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql)
                columns = [desc[0] for desc in cursor.description]
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
    except pymysql.Error as e:
        return {"error": f"Database error: {e}"}


@server.tool()
def query_mysql(
    sql: str,
    max_rows: int = 100,
) -> str:
    """Run a read-only SELECT query against the configured MySQL database.

    Only SELECT statements are accepted. INSERT, UPDATE, DELETE, DDL,
    LOAD DATA INFILE, SELECT INTO OUTFILE, and any other data-modifying
    constructs are rejected.

    Args:
        sql: A SELECT SQL statement to execute (MySQL dialect).
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
