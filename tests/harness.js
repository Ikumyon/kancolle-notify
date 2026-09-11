import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
export async function moduleIn(relative, globals) {
  const context = vm.createContext({ console, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
    crypto, structuredClone, AbortSignal, setTimeout, clearTimeout, ...globals });
  const cache = new Map();
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const mod = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
    cache.set(url.href, mod);
    await mod.link(specifier => load(new URL(specifier, url)));
    return mod;
  }
  const mod = await load(new URL(relative, import.meta.url)); await mod.evaluate(); return mod;
}
export const settle = () => new Promise(r => setTimeout(r, 25));
export function storage() {
  const data = {};
  return { data, api: { get: async keys => {
    if (keys === null) return structuredClone(data);
    const list = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(list.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
  }, remove: async keys => { for (const k of keys) delete data[k]; }, set: async patch => { Object.assign(data, structuredClone(patch)); }, setAccessLevel: async () => {} } };
}
