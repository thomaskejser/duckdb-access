# duckdb-access

Runs raw SQL from `.sql` files against DuckDB.
Named parameters are bound by the driver, never spliced into the SQL text.

## Install

```sh
npm i github:thomaskejser/duckdb-access#v0.1.0 @duckdb/node-api
```

- `@duckdb/node-api` is a peer dependency, so the app picks the DuckDB version.
- Installing from git runs `prepare`, which builds `dist/`.

## Use

```sql
-- src/lib/server/sql/customer-by-id.sql
SELECT customer_id, customer, credit
FROM customer
WHERE customer_id = $customer_id;
```

```ts
import { openDuckDb } from 'duckdb-access';
import customerById from '$lib/server/sql/customer-by-id.sql?raw';

const db = openDuckDb({ path: 'data/app.duckdb', readOnly: true, reopenOnChange: true });

const rows = await db.query(customerById, { customer_id: 1n });
```

- In SvelteKit, import `.sql` files with `?raw`.
- Outside Vite (ETL scripts, tests), read them with `loadSql(path)`.
- Create `db` once per process, in a server-only module.

## API

| Call | Does |
|---|---|
| `openDuckDb({ path, readOnly?, reopenOnChange? })` | Opens a database file, or `:memory:`. The file is opened lazily on first use. |
| `db.query(sql, params?)` | Runs one statement and returns rows as plain objects. |
| `db.run(sql, params?)` | Runs one statement and discards the result. |
| `db.exec(script)` | Runs several `;`-separated statements, e.g. a schema or ETL transform file. Takes no parameters. |
| `db.transaction(work)` | Runs `work` on one connection between `BEGIN` and `COMMIT`. Rolls back and rethrows if `work` throws. |
| `db.close()` | Closes the database. Later calls throw. |
| `loadSql(path)` | Reads a `.sql` file as UTF-8 text. |

## Parameters

- Write placeholders as `$name`; pass values as `{ name: value }`.
- A missing parameter is an error, not a `NULL`.
- Values are always data.
  A parameter cannot supply a table or column name.

## Connections

- Each call opens its own connection and closes it when done.
- `transaction` keeps one connection for all the work inside it.

## Rebuilt files

- `reopenOnChange` checks the file's modification time before each call.
- When it has changed, the database is closed and reopened, so a long-running reader sees a file an ETL job rebuilt.
- It needs a file path; with `:memory:` it throws.

## Result types

Rows come from DuckDB's JS conversion:

| DuckDB | JavaScript |
|---|---|
| `BIGINT` | `bigint` |
| `DOUBLE` | `number` |
| `DECIMAL` | `number`, so values beyond double precision lose digits |
| `TEXT` | `string` |
| `DATE`, `TIMESTAMP` | `Date` |

- SvelteKit `load` functions serialise `bigint` and `Date`.
- `JSON.stringify` does not handle `bigint`; convert before returning JSON from an endpoint.

## Develop

```sh
npm install
npm run check
npm test
```
