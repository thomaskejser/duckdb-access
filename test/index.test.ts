import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSql, openDuckDb, type DuckDb } from '../src/index.js';

const sql = (name: string) => loadSql(new URL(`./sql/${name}.sql`, import.meta.url));

describe('in-memory database', () => {
	let db: DuckDb;

	beforeEach(async () => {
		db = openDuckDb({ path: ':memory:' });
		await db.exec(await sql('schema'));
	});

	afterEach(() => db.close());

	it('binds named parameters from a .sql file', async () => {
		const rows = await db.query(await sql('customer-by-id'), { customer_id: 1n });
		expect(rows).toEqual([{ customer_id: 1n, customer: 'Acme', credit: 10.5 }]);
	});

	it('returns no rows when nothing matches', async () => {
		expect(await db.query(await sql('customer-by-id'), { customer_id: 99n })).toEqual([]);
	});

	it('treats a parameter value as data, never as SQL', async () => {
		const rows = await db.query('SELECT customer FROM customer WHERE customer = $name', {
			name: "Acme' OR '1'='1"
		});
		expect(rows).toEqual([]);
	});

	it('rejects a query whose parameter is missing', async () => {
		await expect(db.query(await sql('customer-by-id'), {})).rejects.toThrow();
	});

	it('rolls back a transaction that throws', async () => {
		await expect(
			db.transaction(async (tx) => {
				await tx.run('DELETE FROM customer');
				throw new Error('abort');
			})
		).rejects.toThrow('abort');
		expect(await db.query('SELECT count(*) AS n FROM customer')).toEqual([{ n: 2n }]);
	});

	it('commits a transaction that succeeds', async () => {
		await db.transaction((tx) => tx.run("INSERT INTO customer (customer) VALUES ('Initech')"));
		expect(await db.query('SELECT count(*) AS n FROM customer')).toEqual([{ n: 3n }]);
	});

	it('refuses work after close', async () => {
		await db.close();
		await expect(db.query('SELECT 1')).rejects.toThrow('closed');
	});
});

describe('read-only file that is rebuilt', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'duckdb-access-'));
	});

	afterEach(() => rm(dir, { recursive: true, force: true }));

	async function build(path: string, value: number, mtime: Date) {
		await rm(path, { force: true });
		const writer = openDuckDb({ path });
		await writer.run('CREATE TABLE t AS SELECT $v::BIGINT AS v', { v: value });
		await writer.close();
		await utimes(path, mtime, mtime);
	}

	it('sees the new file when reopenOnChange is set', async () => {
		const path = join(dir, 'data.duckdb');
		await build(path, 1, new Date('2026-01-01'));
		const reader = openDuckDb({ path, readOnly: true, reopenOnChange: true });
		expect(await reader.query('SELECT v FROM t')).toEqual([{ v: 1n }]);

		await build(path, 2, new Date('2026-01-02'));
		expect(await reader.query('SELECT v FROM t')).toEqual([{ v: 2n }]);
		await reader.close();
	});

	it('refuses writes when read-only', async () => {
		const path = join(dir, 'data.duckdb');
		await build(path, 1, new Date('2026-01-01'));
		const reader = openDuckDb({ path, readOnly: true });
		await expect(reader.run('DELETE FROM t')).rejects.toThrow();
		await reader.close();
	});

	it('rejects reopenOnChange for an in-memory database', () => {
		expect(() => openDuckDb({ path: ':memory:', reopenOnChange: true })).toThrow();
	});
});
