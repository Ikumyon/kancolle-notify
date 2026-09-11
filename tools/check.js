import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.js')) {
      const r = spawnSync(process.execPath, ['--check', file.pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
      if (r.status) { console.error(r.stderr); process.exitCode = 1; }
    } else if (entry.name.endsWith('.json')) JSON.parse(readFileSync(file, 'utf8'));
  }
}
walk(root);
if (!process.exitCode) console.log('JavaScript構文とJSONの検証に成功しました');
