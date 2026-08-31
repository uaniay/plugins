# mcp-mysql-query

MCP server for read-only MySQL queries. Only SELECT statements are allowed — all other operations are rejected at the SQL validation layer.

## Features

- SELECT-only enforcement (INSERT/UPDATE/DELETE/DDL all blocked)
- AST-level SQL analysis via `sqlglot` to catch injection and embedded write operations
- Blocks dangerous constructs: `LOAD DATA INFILE`, `SELECT INTO OUTFILE`, `load_file()`, etc.
- Stacked statement prevention (`;` separated statements)
- Returns results as JSON with column names, rows, and truncation indicator

## Configuration

Set these environment variables:

| Variable | Description | Default |
|---|---|---|
| `MYSQL_HOST` | MySQL hostname | `localhost` |
| `MYSQL_PORT` | Port | `3306` |
| `MYSQL_DATABASE` | Database name | |
| `MYSQL_USERNAME` | Login username | |
| `MYSQL_PASSWORD` | Login password | |

## Claude Desktop configuration

```json
{
  "mcpServers": {
    "mysql": {
      "command": "uvx",
      "args": ["mcp-mysql-query@latest"],
      "env": {
        "MYSQL_HOST": "your-server",
        "MYSQL_DATABASE": "your-db",
        "MYSQL_USERNAME": "your-user",
        "MYSQL_PASSWORD": "your-password"
      }
    }
  }
}
```

## Tool

### `query_mysql`

Run a read-only SELECT query against the configured MySQL database.

**Parameters:**
- `sql` (required) — MySQL SELECT statement
- `max_rows` (optional) — Maximum rows to return, default 100, max 1000
