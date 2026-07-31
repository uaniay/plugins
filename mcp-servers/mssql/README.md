# mcp-mssql-query

MCP server for read-only SQL Server queries. Only SELECT statements are allowed — all other operations are rejected at the SQL validation layer.

## Features

- SELECT-only enforcement (INSERT/UPDATE/DELETE/DDL all blocked)
- AST-level SQL analysis via `sqlglot` to catch injection and embedded write operations
- Blocks dangerous functions: `xp_cmdshell`, `sp_executesql`, `OPENROWSET`, etc.
- Stacked statement prevention (`;` separated statements)
- Returns results as JSON with column names, rows, and truncation indicator

## Configuration

Set these environment variables:

| Variable | Description | Default |
|---|---|---|
| `MSSQL_HOST` | SQL Server hostname | `localhost` |
| `MSSQL_PORT` | Port | `1433` |
| `MSSQL_DATABASE` | Database name | |
| `MSSQL_USERNAME` | Login username | |
| `MSSQL_PASSWORD` | Login password | |

## Claude Desktop configuration

```json
{
  "mcpServers": {
    "mssql": {
      "command": "uvx",
      "args": ["mcp-mssql-query@latest"],
      "env": {
        "MSSQL_HOST": "your-server",
        "MSSQL_DATABASE": "your-db",
        "MSSQL_USERNAME": "your-user",
        "MSSQL_PASSWORD": "your-password"
      }
    }
  }
}
```

## Tool

### `query_mssql`

Run a read-only SELECT query against the configured SQL Server database.

**Parameters:**
- `sql` (required) — T-SQL SELECT statement
- `max_rows` (optional) — Maximum rows to return, default 100, max 1000
