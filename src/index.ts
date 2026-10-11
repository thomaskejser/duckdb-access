import { stat, readFile } from 'node:fs/promises';
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';

export type Row = Record<string, unknown>;
export type Params = Record<string, DuckDBValue>;

export interface DuckDbOptions {
	path: string;
	readOnly?: boolean;
	/** Reopen the database when the file's modification time changes, so a reader sees a rebuilt file. */
	reopenOnChange?: boolean;
}

export interface DuckDb {
	/** Runs one statement and returns its rows. `$name` placeholders are bound from `params`. */
	query<T extends Row = Row>(sql: string, params?: Params): Promise<T[]>;
	/** Runs one statement and discards any result. */
	run(sql: string, params?: Params): Promise<void>;
	/** Runs a script of several `;`-separated statements, without parameters. */
	exec(script: string): Promise<void>;
	/** Runs `work` on one connection inside a transaction; rolls back if it throws. */
	transaction<T>(work: (db: Pick<DuckDb, 'query' | 'run' | 'exec'>) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

export async function loadSql(path: string | URL): Promise<string> {
	return readFile(path, 'utf8');
}

export function openDuckDb(options: DuckDbOptions): DuckDb {
	if (options.reopenOnChange && options.path === ':memory:') {
		throw new Error('reopenOnChange needs a database file, not :memory:');
	}

	let instance: Promise<DuckDBInstance> | undefined;
	let openedAt = 0;
	let closed = false;

	async function fileMtime(): Promise<number> {
		return (await stat(options.path)).mtimeMs;
	}

	async function currentInstance(): Promise<DuckDBInstance> {
		if (closed) {
			throw new Error(`database ${options.path} is closed`);
		}
		if (instance && options.reopenOnChange) {
			const mtime = await fileMtime();
			if (mtime !== openedAt) {
				const stale = instance;
				instance = undefined;
				(await stale).closeSync();
			}
		}
		if (!instance) {
			instance = DuckDBInstance.create(
				options.path,
				options.readOnly ? { access_mode: 'READ_ONLY' } : {}
			);
			if (options.reopenOnChange) {
				openedAt = await fileMtime();
			}
		}
		return instance;
	}

	async function withConnection<T>(work: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
		const connection = await (await currentInstance()).connect();
		try {
			return await work(connection);
		} finally {
			connection.closeSync();
		}
	}

	function on(connection: DuckDBConnection): Pick<DuckDb, 'query' | 'run' | 'exec'> {
		return {
			async query<T extends Row = Row>(sql: string, params?: Params): Promise<T[]> {
				const reader = await connection.runAndReadAll(sql, params);
				return reader.getRowObjectsJS() as T[];
			},
			async run(sql: string, params?: Params): Promise<void> {
				await connection.run(sql, params);
			},
			async exec(script: string): Promise<void> {
				const statements = await connection.extractStatements(script);
				for (let i = 0; i < statements.count; i++) {
					await (await statements.prepare(i)).run();
				}
			}
		};
	}

	return {
		query: (sql, params) => withConnection((c) => on(c).query(sql, params)),
		run: (sql, params) => withConnection((c) => on(c).run(sql, params)),
		exec: (script) => withConnection((c) => on(c).exec(script)),
		transaction: (work) =>
			withConnection(async (c) => {
				await c.run('BEGIN TRANSACTION');
				try {
					const result = await work(on(c));
					await c.run('COMMIT');
					return result;
				} catch (error) {
					await c.run('ROLLBACK');
					throw error;
				}
			}),
		async close() {
			closed = true;
			if (instance) {
				(await instance).closeSync();
				instance = undefined;
			}
		}
	};
}
