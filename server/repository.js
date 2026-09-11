import { emptyState } from '../extension/core/state.js';
// A single personal account is updated with compare-and-swap; no read/modify/write lost updates.
export class Repository {
  constructor(db) { this.db = db; }
  async read() {
    await this.db.prepare('INSERT OR IGNORE INTO account_state(id,revision,body) VALUES(?,0,?)').bind('owner', JSON.stringify(emptyState())).run();
    const row = await this.db.prepare('SELECT revision,body FROM account_state WHERE id=?').bind('owner').first();
    return { revision: row.revision, state: JSON.parse(row.body) };
  }
  async mutate(fn) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const { revision, state } = await this.read();
      const value = fn(state);
      const events = state.history; state.history = [];
      const commit = crypto.randomUUID();
      const statements = [this.db.prepare('UPDATE account_state SET revision=revision+1,body=?,commit_id=? WHERE id=? AND revision=?')
        .bind(JSON.stringify(state), commit, 'owner', revision)];
      if (events.length) statements.push(this.db.prepare('INSERT INTO audit_batches(id,created_at,body) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM account_state WHERE id=? AND commit_id=?)')
        .bind(commit, Math.max(...events.map(e => e.at)), JSON.stringify(events), 'owner', commit));
      const results = await this.db.batch(statements);
      if (results[0].meta.changes === 1) return value;
    }
    throw new Error('write_contention');
  }
  async history(now = Date.now()) {
    const { results } = await this.db.prepare('SELECT body FROM audit_batches WHERE created_at>=? ORDER BY created_at DESC LIMIT 200').bind(now - 30 * 86400000).all();
    return results.flatMap(r => JSON.parse(r.body)).filter(h => h.at >= now - 30 * 86400000).sort((a, b) => b.at - a.at).slice(0, 200);
  }
  async prune(now) {
    await this.db.prepare('DELETE FROM audit_batches WHERE created_at<?').bind(now - 30 * 86400000).run();
  }
}
