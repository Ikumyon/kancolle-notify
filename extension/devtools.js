import { apiName, supported, parameters, extract } from './core/parser.js';
let sourceId = crypto.randomUUID(), started = false, chain = Promise.resolve();
const message = async value => {
  const result = await chrome.runtime.sendMessage(value);
  if (result?.error) throw new Error(result.error);
  return result?.value;
};
function getBody(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('body_timeout')), 10000);
    try {
      request.getContent((body, encoding) => {
        clearTimeout(timer);
        try {
          if (encoding === 'base64') body = new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0)));
          resolve(body);
        } catch { reject(new Error('body_missing')); }
      });
    } catch { clearTimeout(timer); reject(new Error('body_missing')); }
  });
}
chrome.devtools.network.onRequestFinished.addListener(request => {
  const api = apiName(request.request.url);
  if (!supported(api)) return;
  if (api.startsWith('api_start2') && started) sourceId = crypto.randomUUID();
  started = true;
  const source = sourceId, observedAt = Date.now(), params = parameters(request.request);
  const header = request.response.headers?.find(h => h.name.toLowerCase() === 'date')?.value;
  const responseDate = header && Number.isFinite(Date.parse(header)) ? Date.parse(header) : null;
  const content = getBody(request).then(body => ({ body }), error => ({ error }));
  chain = chain.catch(() => {}).then(async () => {
    const result = await content; if (result.error) throw result.error;
    const extracted = extract(api, result.body, params, request.response.status);
    await message({ type: 'enqueue', observation: { sourceId: source, api, observedAt, responseDate, ...extracted } });
  }).catch(e => message({ type: 'collector', active: true, error: e.message }).catch(() => {}));
});
chrome.devtools.panels.create('観測・送信', '', 'panel.html');
message({ type: 'collector', active: true }).catch(() => {});

let keepAlivePort = null;
function setupKeepAlive() {
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'keep-alive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      setTimeout(setupKeepAlive, 5000);
    });
  } catch {}
}
setupKeepAlive();
const keepAliveTimer = setInterval(() => {
  try {
    if (keepAlivePort) {
      keepAlivePort.postMessage('ping');
    } else {
      setupKeepAlive();
    }
  } catch {}
}, 20000);

window.addEventListener('unload', () => {
  clearInterval(keepAliveTimer);
  if (keepAlivePort) {
    try { keepAlivePort.disconnect(); } catch {}
  }
  chrome.runtime.sendMessage({ type: 'collector', active: false }).catch(() => {});
});
