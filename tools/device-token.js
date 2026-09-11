import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const name = process.argv[2];
if (!name || !/^[A-Za-z0-9_-]{1,80}$/.test(name)) throw new Error('Usage: node tools/device-token.js windows');
const dir = new URL('../.local/', import.meta.url); mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString('base64url');
// Never overwrite an existing token file silently.
writeFileSync(new URL(`${name}.json`, dir), JSON.stringify({ device: name, token, hash: createHash('sha256').update(token).digest('hex') }, null, 2), { flag: 'wx' });
console.log(`.local/${name}.json に端末トークンと中央登録用ハッシュを保存しました。`);
