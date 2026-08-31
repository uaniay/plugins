# mcp-pgsql-query

MCP server for read-only PostgreSQL queries. Only SELECT statements are allowed — all other operations are rejected at the SQL validation layer.

## Features

- SELECT-only enforcement (INSERT/UPDATE/DELETE/DDL/COPY all blocked)
- AST-level SQL analysis via `sqlglot` to catch injection and embedded write operations
- Blocks dangerous functions: `pg_read_file`, `pg_write_file`, `lo_export`, `dblink`, etc.
- Stacked statement prevention (`;` separated statements)
- Returns results as JSON with column names, rows, and truncation indicator

## Configuration

Set these environment variables:

| Variable | Description | Default |
|---|---|---|
| `PG_HOST` | PostgreSQL hostname | `localhost` |
| `PG_PORT` | Port | `5432` |
| `PG_DATABASE` | Database name | |
| `PG_USERNAME` | Login username | |
| `PG_PASSWORD` | Login password | |

## Claude Desktop configuration

```json
{
  "mcpServers": {
    "pgsql": {
      "command": "uvx",
      "args": ["mcp-pgsql-query@latest"],
      "env": {
        "PG_HOST": "your-server",
        "PG_DATABASE": "your-db",
        "PG_USERNAME": "your-user",
        "PG_PASSWORD": "your-password"
      }
    }
  }
}
```

## Tool

### `query_pgsql`

Run a read-only SELECT query against the configured PostgreSQL database.

**Parameters:**
- `sql` (required) — PostgreSQL SELECT statement
- `max_rows` (optional) — Maximum rows to return, default 100, max 1000
