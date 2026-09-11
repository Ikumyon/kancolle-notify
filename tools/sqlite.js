import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export class LocalD1 {
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const stmt = this.sqlite.prepare(sql);
    const bound = args => ({
      bind: (...values) => bound(values),
      first: async () => stmt.get(...args) || null,
      all: async () => ({ results: stmt.all(...args) }),
      runSync: () => { const result = stmt.run(...args); return { meta: { changes: result.changes } }; },
      run: async () => { const result = stmt.run(...args); return { meta: { changes: result.changes } }; }
    });
    return bound([]);
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(statement.runSync());
      this.sqlite.exec('COMMIT'); return results;
    } catch (e) { this.sqlite.exec('ROLLBACK'); throw e; }
  }
  close() { this.sqlite.close(); }
}
