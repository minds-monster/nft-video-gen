// A D1 double over Node's built-in SQLite, loaded with the real migrations — so the tests run
// the SQL worker/records.js actually sends, against the schema production actually has.
// Models the slice of the D1 API the Worker uses: prepare().bind().run()/all()/first(), and
// batch() as one transaction.

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

// D1 rejects `undefined`; so does this, loudly, rather than quietly binding NULL.
const checked = (args) =>
  args.map((value, index) => {
    if (value === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound at position ${index + 1}`);
    return typeof value === 'boolean' ? Number(value) : value;
  });

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, checked(args));
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.args).map((row) => ({ ...row })) };
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.args);
    if (!row) return null;
    return column ? row[column] : { ...row };
  }
}

export class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
      this.db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
    }
  }
  prepare(sql) {
    return new Statement(this.db, sql);
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Test convenience: every row of a table, or of a query. */
  rows(sqlOrTable) {
    const sql = /\s/.test(sqlOrTable) ? sqlOrTable : `SELECT * FROM ${sqlOrTable}`;
    return this.db.prepare(sql).all().map((row) => ({ ...row }));
  }
}
