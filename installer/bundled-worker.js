// server/src/domain/timer.js
var retryDelay = (attempt) => Math.min(3e5, 1e3 * 2 ** Math.min(attempt, 8));
function targetDeliveryTime(timer, offsetSec) {
  if (timer.state !== "active" || !Number.isSafeInteger(timer.endAt)) return null;
  return timer.endAt + (timer.kind === "manual" ? 0 : offsetSec * 1e3);
}
function nextDeliveryAt(state, now) {
  const times = [];
  for (const delivery of Object.values(state.deliveries)) {
    if (!state.settings.providers[delivery.provider] || delivery.status === "sent" || delivery.status === "failed" || delivery.status === "cancelled") continue;
    times.push(Math.max(delivery.dueAt, delivery.nextTryAt || 0, delivery.leaseUntil || 0));
  }
  for (const timer of Object.values(state.timers)) {
    if (timer.state !== "active") continue;
    for (const event of timer.events || []) {
      if (!Number.isSafeInteger(event.endAt)) continue;
      const dueAt = event.endAt + (timer.kind === "manual" ? 0 : state.settings.offsetSec * 1e3);
      if (dueAt > now - 6e4) {
        times.push(dueAt);
      }
    }
  }
  return times.length ? Math.max(now, Math.min(...times)) : null;
}
function publicTimer(timer, settings, now) {
  const copy = structuredClone(timer);
  if (copy.kind === "build" && settings.hideBuildName) {
    copy.name = "";
  }
  return copy;
}

// server/src/domain/generation.js
var validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
function issueSession(s, requestId, device) {
  if (!validId(requestId)) throw new Error("invalid_session");
  const key = device + ":" + requestId;
  if (s.sessions[key]) return { sessionId: s.sessions[key], fresh: false };
  const sessionId = crypto.randomUUID();
  s.sessions[key] = sessionId;
  s.session = { id: sessionId, device, sequence: 0 };
  return { sessionId, fresh: true };
}

// server/src/domain/state.js
var kinds = ["expedition", "repair", "build", "akashi", "fatigue"];
var defaultCalculationSettings = () => ({ fatigueTarget: 49, fatiguePresets: [40, 49], fatigueTargets: {} });
var defaultSettings = () => ({
  offsetSec: 0,
  providers: { discord: false, telegram: false },
  categories: Object.fromEntries(kinds.map((k) => [k, true])),
  hideBuildName: true,
  calculation: defaultCalculationSettings()
});
var emptyState = () => ({ schema: 2, settings: defaultSettings(), session: null, sessions: {}, timers: {}, deliveries: {}, history: [] });
function record(s, now, type, detail = {}) {
  s.history.push({ at: now, type, ...detail });
}
function beginSession(s, requestId, device, now) {
  const { sessionId, fresh } = issueSession(s, requestId, device);
  if (fresh) record(s, now, "session_start");
  return { sessionId };
}
function reconcile(s, now) {
  for (const timer of Object.values(s.timers)) {
    timer.notifyAt = targetDeliveryTime(timer, s.settings.offsetSec);
    const enabled = timer.kind === "manual" || s.settings.categories[timer.kind];
    for (const d of Object.values(s.deliveries).filter((d2) => d2.timerId === timer.id)) {
      if (["pending", "sending"].includes(d.status) && (!enabled || !s.settings.providers[d.provider] || d.revision !== timer.revision || !timer.events.some((e) => e.id === d.eventId) || d.type !== "correction" && timer.state !== "active")) d.status = "cancelled";
    }
    for (const event of timer.events) for (const provider of ["discord", "telegram"]) {
      if (!enabled || !s.settings.providers[provider]) continue;
      const jobs = Object.values(s.deliveries).filter((d) => d.timerId === timer.id && d.eventId === event.id && d.provider === provider);
      const sent = jobs.filter((d) => d.status === "sent");
      const latest = sent.reduce((last, d) => !last || d.revision > last.revision ? d : last, null);
      const isCancelled = timer.state === "cancelled" || timer.state === "empty" && latest?.item?.state === "active";
      const isTimeChanged = latest && Number.isSafeInteger(event.endAt) && latest.eventEndAt !== event.endAt;
      const corrected = isTimeChanged || isCancelled;
      const make = (type, dueAt) => {
        const id = `${event.id}:${timer.revision}:${type}:${provider}`;
        let d = s.deliveries[id];
        if (!d) d = s.deliveries[id] = {
          id,
          timerId: timer.id,
          eventId: event.id,
          revision: timer.revision,
          provider,
          phase: event.phase,
          type,
          eventEndAt: event.endAt,
          text: event.text || null,
          item: structuredClone(timer),
          status: "pending",
          dueAt,
          nextTryAt: 0,
          leaseUntil: 0,
          attempts: 0,
          createdAt: now
        };
        if (d.status === "cancelled") {
          d.status = "pending";
          d.leaseUntil = 0;
        }
        if (d.status === "pending") {
          d.dueAt = dueAt;
          d.item = structuredClone(timer);
          d.text = event.text || null;
        }
      };
      if (corrected && timer.suppressedRevision !== timer.revision && !sent.some((d) => d.revision === timer.revision)) make("correction", now);
      if (timer.state === "active" && Number.isSafeInteger(event.endAt) && !sent.some((d) => d.type === "notification" && d.eventEndAt === event.endAt)) {
        make("notification", event.endAt + (timer.kind === "manual" ? 0 : s.settings.offsetSec * 1e3));
      }
    }
  }
}
function updateTimer(s, input, now, reason = "observation") {
  const old = s.timers[input.id];
  if (old?.observedAt && input.observedAt && input.observedAt < old.observedAt) return;
  const changed = !old || JSON.stringify([old.name, old.state, old.events]) !== JSON.stringify([input.name, input.state, input.events]);
  const revision = (old?.revision || 0) + (changed ? 1 : 0);
  s.timers[input.id] = {
    ...input,
    revision,
    updatedAt: changed ? now : old.updatedAt,
    suppressedRevision: reason === "settings" && changed ? revision : old?.suppressedRevision ?? null,
    notifyAt: null
  };
  reconcile(s, now);
}
function applySettings(s, patch, now) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !["offsetSec", "providers", "categories", "hideBuildName", "calculation"].includes(k))) throw new Error("invalid_settings");
  const next = structuredClone(s.settings);
  for (const [key, value] of Object.entries(patch)) {
    if (key === "offsetSec") {
      if (!Number.isInteger(value) || Math.abs(value) > 3600) throw new Error("invalid_settings");
    } else if (key === "hideBuildName") {
      if (typeof value !== "boolean") throw new Error("invalid_settings");
    } else if (key === "calculation") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_settings");
      const target = (v) => Number.isInteger(v) && v >= 0 && v <= 54;
      if (value.fatigueTarget !== void 0 && !target(value.fatigueTarget)) throw new Error("invalid_settings");
      if (value.fatiguePresets !== void 0 && (!Array.isArray(value.fatiguePresets) || value.fatiguePresets.length < 1 || value.fatiguePresets.length > 12 || !value.fatiguePresets.every(target))) throw new Error("invalid_settings");
      if (value.fatigueTargets !== void 0) {
        if (!value.fatigueTargets || typeof value.fatigueTargets !== "object" || Array.isArray(value.fatigueTargets) || Object.entries(value.fatigueTargets).some(([id, v]) => !["1", "2", "3", "4"].includes(id) || v !== null && !target(v))) throw new Error("invalid_settings");
      }
      next.calculation = { ...next.calculation, ...value };
      if (value.fatigueTargets) next.calculation.fatigueTargets = { ...next.calculation.fatigueTargets, ...value.fatigueTargets };
      continue;
    } else {
      if (!value || Array.isArray(value) || typeof value !== "object" || Object.entries(value).some(([k, v]) => !Object.hasOwn(next[key], k) || typeof v !== "boolean")) throw new Error("invalid_settings");
      Object.assign(next[key], value);
      continue;
    }
    next[key] = value;
  }
  s.settings = next;
  for (const d of Object.values(s.deliveries)) if (patch.providers?.[d.provider] === true && d.status === "failed") {
    d.status = "pending";
    d.nextTryAt = now;
  }
  record(s, now, "settings_changed");
}
function createManual(s, command, now) {
  if (!command || !validId(command.requestId) || typeof command.name !== "string" || !command.name.trim() || command.name.length > 80 || Object.keys(command).some((k) => !["requestId", "name", "endAt", "minutes"].includes(k)) || Object.hasOwn(command, "endAt") === Object.hasOwn(command, "minutes")) throw new Error("invalid_manual");
  const id = "manual:" + command.requestId;
  if (s.timers[id]) return s.timers[id];
  const endAt = command.endAt ?? now + command.minutes * 6e4;
  if (command.minutes !== void 0 && (!Number.isInteger(command.minutes) || command.minutes < 1) || !Number.isSafeInteger(endAt) || endAt <= now || endAt > now + 365 * 864e5) throw new Error("invalid_manual");
  if (Object.values(s.timers).filter((t) => t.kind === "manual" && t.state === "active").length >= 100) throw new Error("manual_limit");
  updateTimer(s, { id, kind: "manual", slot: null, state: "active", name: command.name.trim(), endAt, events: [{ id: command.requestId + "-manual", phase: "complete", endAt }] }, now);
  return s.timers[id];
}
function cancelManual(s, id, now) {
  const timer = s.timers["manual:" + id];
  if (!timer) throw new Error("manual_not_found");
  if (timer.state !== "cancelled") updateTimer(s, { ...timer, state: "cancelled", endAt: null, events: timer.events.map((e) => ({ ...e, endAt: null })) }, now);
  return s.timers[timer.id];
}

// server/src/repository/repository.js
var Repository = class {
  constructor(db) {
    this.db = db;
  }
  async read() {
    await this.db.prepare("INSERT OR IGNORE INTO account_state(id,revision,body) VALUES(?,0,?)").bind("owner", JSON.stringify(emptyState())).run();
    const row = await this.db.prepare("SELECT revision,body FROM account_state WHERE id=?").bind("owner").first();
    const state = JSON.parse(row.body);
    if (state.schema !== 2 || !state.settings || !state.timers || !state.deliveries) throw new Error("initialization_required");
    return { revision: row.revision, state };
  }
  async mutate(fn) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const { revision, state } = await this.read();
      const value = fn(state);
      const events = state.history;
      state.history = [];
      const commit = crypto.randomUUID();
      const statements = [
        this.db.prepare("UPDATE account_state SET revision=revision+1,body=?,commit_id=? WHERE id=? AND revision=?").bind(JSON.stringify(state), commit, "owner", revision)
      ];
      if (events.length) {
        statements.push(
          this.db.prepare("INSERT INTO audit_batches(id,created_at,body) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM account_state WHERE id=? AND commit_id=?)").bind(commit, Math.max(...events.map((e) => e.at)), JSON.stringify(events), "owner", commit)
        );
      }
      const results = await this.db.batch(statements);
      if (results[0].meta.changes === 1) return value;
    }
    throw new Error("write_contention");
  }
  async history(now = Date.now()) {
    const { results } = await this.db.prepare("SELECT body FROM audit_batches WHERE created_at>=? ORDER BY created_at DESC LIMIT 200").bind(now - 30 * 864e5).all();
    return results.flatMap((r) => JSON.parse(r.body)).filter((h) => h.at >= now - 30 * 864e5).sort((a, b) => b.at - a.at).slice(0, 200);
  }
  async prune(now) {
    await this.db.prepare("DELETE FROM audit_batches WHERE created_at<?").bind(now - 30 * 864e5).run();
    await this.mutate((s) => {
      for (const [id, d] of Object.entries(s.deliveries)) {
        const timer = s.timers[d.timerId];
        if (["sent", "cancelled", "failed"].includes(d.status) && d.createdAt < now - 30 * 864e5 && (!timer || !timer.events.some((e) => e.id === d.eventId))) delete s.deliveries[id];
      }
    });
  }
};

// server/src/api/auth.js
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
async function authenticate(request, env) {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if (!token) return null;
  let devices;
  try {
    devices = JSON.parse(env.DEVICE_TOKENS || "{}");
  } catch {
    return null;
  }
  const digest = await hash(token);
  return Object.entries(devices).find(([id, h]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && h === digest)?.[0] || null;
}

// server/src/api/handlers/status.js
var json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function readBody(request, limit = 2097152) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error("too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("invalid_json");
  }
}
async function snapshot(repo, now = Date.now()) {
  const { revision, state } = await repo.read();
  return {
    revision,
    now,
    settings: state.settings,
    timers: Object.values(state.timers).map((t) => publicTimer(t, state.settings, now)),
    deliveries: Object.values(state.deliveries).map(({ item, token, ...d }) => ({ ...d, item: publicTimer(item, state.settings, now) })),
    history: await repo.history(now)
  };
}
async function handleStatus(request, env, repo) {
  return json(await snapshot(repo));
}

// server/src/api/handlers/session.js
async function handleSession(request, env, repo, device) {
  const body = await readBody(request, 1024);
  if (!body || Object.keys(body).some((k) => k !== "requestId")) throw new Error("invalid_session");
  return json(await repo.mutate((s) => beginSession(s, body.requestId, device, Date.now())));
}

// server/src/domain/reservations.js
var object = (value) => value && typeof value === "object" && !Array.isArray(value);
var exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
var time = (value) => Number.isSafeInteger(value) && value > 0;
function validateUpdate(u) {
  if (!object(u) || !(u.observedAt === null || time(u.observedAt)) || !["observation", "settings"].includes(u.reason) || !Array.isArray(u.timers) || !u.timers.length || u.timers.length > 32) throw new Error("invalid_update");
  const ids = /* @__PURE__ */ new Set(), events = /* @__PURE__ */ new Set();
  for (const t of u.timers) {
    if (!exact(t, ["id", "kind", "slot", "name", "state", "startAt", "endAt", "events"]) || !kinds.includes(t.kind) || !Number.isInteger(t.slot) || t.slot < 1 || t.slot > 4 || t.id !== `${t.kind}:${t.slot}` || ids.has(t.id) || typeof t.name !== "string" || t.name.length > 200 || !["pending", "empty", "active", "complete", "cancelled"].includes(t.state) || t.startAt !== null && !time(t.startAt) || !Array.isArray(t.events) || !t.events.length || t.events.length > 10 || (t.state === "active" ? !time(t.endAt) : t.endAt !== null)) throw new Error("invalid_timer");
    ids.add(t.id);
    const phases = /* @__PURE__ */ new Set();
    for (const e of t.events) {
      const hasText = Object.hasOwn(e, "text");
      const validKeys = hasText ? ["id", "phase", "endAt", "text"] : ["id", "phase", "endAt"];
      if (!exact(e, validKeys) || !validId(e.id) || !validId(e.phase) || events.has(e.id) || phases.has(e.phase) || hasText && (typeof e.text !== "string" || e.text.length > 200) || (t.state === "active" ? !time(e.endAt) : e.endAt !== null)) throw new Error("invalid_event");
      events.add(e.id);
      phases.add(e.phase);
    }
    if (t.state === "active" && t.endAt !== Math.max(...t.events.map((e) => e.endAt))) throw new Error("invalid_timer");
  }
}
function receiveUpdate(s, u, device, now) {
  validateUpdate(u);
  const receipt = { sequence: u.sequence ?? 0, receivedAt: now };
  for (const t of u.timers) for (const e of t.events) {
    if (Object.values(s.timers).some((old) => old.id !== t.id && old.events.some((v) => v.id === e.id))) throw new Error("invalid_event_owner");
  }
  for (const timer of u.timers) updateTimer(s, { ...structuredClone(timer), observedAt: u.observedAt }, now, u.reason);
  record(s, now, "timers_received", { count: u.timers.length, reason: u.reason, observedAt: u.observedAt });
  return { ...receipt, status: "accepted" };
}

// server/src/api/handlers/timers.js
async function handleTimers(request, env, repo, device) {
  const body = await readBody(request);
  if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.updates) || !body.updates.length || body.updates.length > 25) throw new Error("invalid_batch");
  body.updates.forEach(validateUpdate);
  const { results, timers } = await repo.mutate((s) => {
    let stopped;
    const res = body.updates.map((u) => {
      const result = stopped ? { sequence: u.sequence, receivedAt: Date.now(), status: stopped } : receiveUpdate(s, u, device, Date.now());
      if (!["accepted", "duplicate"].includes(result.status)) stopped = result.status;
      return result;
    });
    return { results: res, timers: structuredClone(s.timers) };
  });
  return json({ results, timers });
}

// server/src/api/handlers/manual.js
async function handleManual(request, env, repo, id) {
  if (request.method === "GET") return json({ reservations: Object.values((await repo.read()).state.timers).filter((t) => t.kind === "manual") });
  if (request.method === "POST") {
    const command = await readBody(request, 2048);
    return json({ reservation: await repo.mutate((s) => createManual(s, command, Date.now())) });
  }
  if (!validId(id)) throw new Error("invalid_manual");
  return json({ reservation: await repo.mutate((s) => cancelManual(s, id, Date.now())) });
}

// server/src/api/handlers/settings.js
async function handleGetSettings(request, env, repo) {
  return json((await repo.read()).state.settings);
}
async function handlePatchSettings(request, env, repo) {
  const patch = await readBody(request, 4096);
  const settings = await repo.mutate((s) => {
    const now = Date.now();
    applySettings(s, patch, now);
    reconcile(s, now);
    return s.settings;
  });
  return json(settings);
}

// server/src/notify/formatters/text.js
var labels = { expedition: "\u9060\u5F81", repair: "\u5165\u6E20", build: "\u5EFA\u9020", fatigue: "\u75B2\u52B4\u56DE\u5FA9", akashi: "\u6CCA\u5730\u4FEE\u7406", manual: "\u624B\u52D5\u4E88\u7D04" };
var date = (value) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
var escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function deliveryStyle(d) {
  if (d.type === "correction") return { label: "\u8A02\u6B63", color: 15105570 };
  if (d.attempts > 1 || d.sentAt - d.dueAt > 6e4) return { label: "\u9045\u5EF6", color: 15158332 };
  const end = d.eventEndAt;
  if (d.dueAt < end) return { label: "\u4E8B\u524D\u901A\u77E5", color: 3066993 };
  return { label: "\u4E88\u5B9A\u901A\u77E5", color: 3447003 };
}
function formatPlainText(d) {
  const t = d.item, lines = [`\u3010${deliveryStyle(d).label}\u3011${labels[t.kind]} ${t.slot ? "\u7B2C" + t.slot + (["repair", "build"].includes(t.kind) ? "\u30C9\u30C3\u30AF" : "\u8266\u968A") : ""} ${t.name || ""}`.trim()];
  const end = d.eventEndAt;
  if (d.type === "correction") {
    lines.push(end ? "\u7D42\u4E86\u4E88\u5B9A\u3092\u66F4\u65B0\u3057\u307E\u3057\u305F" : "\u3053\u306E\u4E88\u5B9A\u306E\u901A\u77E5\u306F\u4E0D\u8981\u306B\u306A\u308A\u307E\u3057\u305F");
  } else if (t.kind === "akashi") {
    if (d.phase === "start") {
      lines.push("\u6700\u521D\u306E20\u5206\u304C\u7D4C\u904E\u3059\u308B\u898B\u8FBC\u307F\u3067\u3059");
      if (d.text) lines.push(d.text);
    } else {
      lines.push(d.text ? `${d.text} \u5168\u56DE\u5FA9\u306E\u898B\u8FBC\u307F\u3067\u3059` : "\u8266\u968A\u306E\u5168\u56DE\u5FA9\u898B\u8FBC\u307F\u3067\u3059");
    }
  } else if (t.kind === "fatigue") {
    lines.push("\u76EE\u6A19cond\u3078\u306E\u56DE\u5FA9\u898B\u8FBC\u307F\u3067\u3059");
  } else {
    lines.push("\u7D42\u4E86\u4E88\u5B9A\u306E\u304A\u77E5\u3089\u305B\u3067\u3059");
  }
  if (end) lines.push("\u4E88\u5B9A\u6642\u523B: " + date(end));
  return lines.join("\n");
}

// server/src/api/handlers/chat-webhook.js
async function handleTelegramWebhook(request, env, repo) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: "forbidden" }, 403);
  const body = await readBody(request, 32768);
  const message = body?.message;
  if (!message) return json({ ok: true });
  if (String(message.chat?.id) !== String(env.TELEGRAM_CHAT_ID)) return json({ error: "forbidden" }, 403);
  if (!Number.isSafeInteger(body.update_id)) return json({ error: "invalid_update" }, 400);
  const [command, ...args] = String(message.text || "").trim().split(/\s+/);
  const cmd = command.match(/^\/(offset|provider|providers|status|fleet|dock|build|help|test)(?:@[A-Za-z0-9_]+)?$/)?.[1];
  if (!cmd) return json({ ok: true });
  let text;
  if (cmd === "offset") {
    if (args.length === 0) {
      const state = await snapshot(repo);
      text = `\u73FE\u5728\u306E\u30AA\u30D5\u30BB\u30C3\u30C8: ${state.settings.offsetSec}\u79D2
\u5909\u66F4\u3059\u308B\u5834\u5408: /offset <\u79D2\u6570>\uFF08-3600\u301C+3600\uFF09`;
    } else {
      const valid = args.length === 1 && /^[+-]?\d+$/.test(args[0]) && Math.abs(Number(args[0])) <= 3600;
      if (!valid) text = "\u4F7F\u3044\u65B9: /offset <\u79D2\u6570>\uFF08-3600\u301C+3600\uFF09";
      else text = await repo.mutate((s) => {
        s.chatUpdates ||= {};
        if (!s.chatUpdates[body.update_id]) {
          const now = Date.now();
          applySettings(s, { offsetSec: Number(args[0]) }, now);
          reconcile(s, now);
          s.chatUpdates[body.update_id] = { at: now, text: Number(args[0]) + "\u79D2\u306B\u8A2D\u5B9A\u3057\u307E\u3057\u305F" };
          for (const [id, update] of Object.entries(s.chatUpdates)) if (update.at < now - 7 * 864e5) delete s.chatUpdates[id];
        }
        return s.chatUpdates[body.update_id].text;
      });
    }
  } else if (cmd === "provider" || cmd === "providers") {
    if (args.length === 2 && ["telegram", "discord"].includes(args[0].toLowerCase()) && ["on", "off", "enable", "disable"].includes(args[1].toLowerCase())) {
      const provider = args[0].toLowerCase();
      const enabled = ["on", "enable"].includes(args[1].toLowerCase());
      text = await repo.mutate((s) => {
        s.chatUpdates ||= {};
        if (!s.chatUpdates[body.update_id]) {
          const now = Date.now();
          applySettings(s, { providers: { [provider]: enabled } }, now);
          reconcile(s, now);
          s.chatUpdates[body.update_id] = { at: now, text: `${provider} \u3092${enabled ? "\u6709\u52B9" : "\u7121\u52B9"}\u306B\u8A2D\u5B9A\u3057\u307E\u3057\u305F` };
          for (const [id, update] of Object.entries(s.chatUpdates)) if (update.at < now - 7 * 864e5) delete s.chatUpdates[id];
        }
        return s.chatUpdates[body.update_id].text;
      });
    } else {
      const state = await snapshot(repo);
      const provList = Object.entries(state.settings.providers).map(([p, en]) => `\u30FB${p}: ${en ? "\u6709\u52B9" : "\u7121\u52B9"}`).join("\n");
      const recentHistory = (state.history || []).filter((h) => h.event === "delivery_sent" || h.event === "delivery_failed").slice(-3).map((h) => {
        const p = h.data?.provider || "\u901A\u77E5";
        const st = h.event === "delivery_sent" ? "\u6210\u529F" : `\u5931\u6557 (${h.data?.code || "\u30A8\u30E9\u30FC"})`;
        return `${p}: ${st}`;
      });
      const historySection = recentHistory.length ? ["\n\u3010\u76F4\u8FD1\u306E\u914D\u4FE1\u3011", ...recentHistory.map((h) => `\u30FB${h}`)] : [];
      text = [
        "\u3010\u901A\u77E5\u30D7\u30ED\u30D0\u30A4\u30C0\u3011",
        provList || "\u306A\u3057",
        ...historySection,
        "\n\u5207\u308A\u66FF\u3048: /provider <telegram|discord> <on|off>"
      ].join("\n");
    }
  } else if (cmd === "test") {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: "<b>\u3010\u30C6\u30B9\u30C8\u901A\u77E5\u3011</b>\n\u8266\u3053\u308C\u901A\u77E5\u306E\u80FD\u52D5\u7684API\u9001\u4FE1\u30C6\u30B9\u30C8\u306B\u6210\u529F\u3057\u307E\u3057\u305F\uFF01",
          parse_mode: "HTML"
        })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        text = "\u2705 Telegram API\u3078\u306E\u80FD\u52D5\u9001\u4FE1\u306B\u6210\u529F\u3057\u307E\u3057\u305F\uFF01(MessageID: " + (data.result?.message_id || "ok") + ")";
      } else {
        text = `\u274C Telegram API\u9001\u4FE1\u30A8\u30E9\u30FC: HTTP ${res.status}
\u8A73\u7D30: ${data.description || "\u4E0D\u660E"} (\u30A8\u30E9\u30FC\u30B3\u30FC\u30C9: ${data.error_code || res.status})`;
      }
    } catch (e) {
      text = "\u274C \u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u30A8\u30E9\u30FC: " + e.message;
    }
  } else if (cmd === "help") {
    text = [
      "/status \u6B21\u306E\u901A\u77E5\u30BF\u30A4\u30DF\u30F3\u30B0\u4E00\u89A7",
      "/fleet \u8266\u968A\u306E\u72B6\u614B\u3092\u8868\u793A",
      "/dock \u5165\u6E20\uFF08\u4FEE\u7406\u30EA\u30B9\u30C8\uFF09\u3092\u8868\u793A",
      "/build \u5EFA\u9020\u30C9\u30C3\u30AF\u306E\u72B6\u614B\u3092\u8868\u793A",
      "/offset [\u79D2\u6570] \u901A\u77E5\u6642\u523B\u306E\u78BA\u8A8D\u30FB\u5909\u66F4",
      "/provider \u30D7\u30ED\u30D0\u30A4\u30C0\u72B6\u614B\u306E\u78BA\u8A8D\u30FB\u5909\u66F4",
      "/test Telegram\u901A\u77E5\u306E\u9001\u4FE1\u30C6\u30B9\u30C8",
      "/help \u3053\u306E\u6848\u5185\u3092\u8868\u793A"
    ].join("\n");
  } else {
    const state = await snapshot(repo);
    const now = state.now || Date.now();
    const formatRemain = (endAt) => {
      if (!Number.isSafeInteger(endAt)) return "";
      const diff = endAt - now;
      const timeStr = new Date(endAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
      if (diff <= 0) return `(\u5B8C\u4E86 / ${timeStr})`;
      const mins = Math.ceil(diff / 6e4);
      const remain = mins >= 60 ? `${Math.floor(mins / 60)}\u6642\u9593${mins % 60}\u5206` : `${mins}\u5206`;
      return `(\u3042\u3068${remain} / ${timeStr})`;
    };
    if (cmd === "fleet") {
      const fleetLines = [1, 2, 3, 4].map((slot) => {
        const exp = state.timers.find((t) => t.kind === "expedition" && t.slot === slot);
        const akashi = state.timers.find((t) => t.kind === "akashi" && t.slot === slot);
        const fatigue = state.timers.find((t) => t.kind === "fatigue" && t.slot === slot);
        if (exp && exp.state === "active") {
          return `\u7B2C${slot}\u8266\u968A: \u9060\u5F81\u300C${exp.name}\u300D ${formatRemain(exp.endAt)}`;
        }
        if (akashi && akashi.state === "active") {
          const events = akashi.events || [];
          const earliestEvent = events.filter((e) => Number.isSafeInteger(e.endAt) && e.endAt > now).sort((a, b) => a.endAt - b.endAt)[0];
          const displayEvent = earliestEvent || events[0];
          const label = displayEvent?.text ? displayEvent.text : akashi.name ? `\u6CCA\u5730\u4FEE\u7406\u300C${akashi.name}\u300D` : "\u6CCA\u5730\u4FEE\u7406\u4E2D";
          return `\u7B2C${slot}\u8266\u968A: ${label} ${formatRemain(displayEvent?.endAt || akashi.endAt)}`;
        }
        if (fatigue && fatigue.state === "active") {
          return `\u7B2C${slot}\u8266\u968A: \u75B2\u52B4\u56DE\u5FA9\u4E2D ${formatRemain(fatigue.endAt)}`;
        }
        if (fatigue && fatigue.state === "complete") {
          return `\u7B2C${slot}\u8266\u968A: \u5F85\u6A5F\u4E2D (\u5168\u5FEB)`;
        }
        return `\u7B2C${slot}\u8266\u968A: \u5F85\u6A5F\u4E2D`;
      });
      text = ["\u3010\u8266\u968A\u3011", ...fleetLines].join("\n");
    } else if (cmd === "dock") {
      const repairActive = state.timers.filter((t) => t.kind === "repair" && t.state === "active").sort((a, b) => (a.slot || 0) - (b.slot || 0));
      const repairLines = repairActive.length ? repairActive.map((t) => `\u7B2C${t.slot}\u30C9\u30C3\u30AF: ${t.name || "\u4FEE\u7406\u4E2D"} ${formatRemain(t.endAt)}`) : ["\u5168\u30C9\u30C3\u30AF\u7A7A\u304D"];
      if (repairActive.length && repairActive.length < 4) {
        repairLines.push(`\uFF08\u7A7A\u304D: ${4 - repairActive.length}\u30C9\u30C3\u30AF\uFF09`);
      }
      text = ["\u3010\u5165\u6E20\u3011", ...repairLines].join("\n");
    } else if (cmd === "build") {
      const buildActive = state.timers.filter((t) => t.kind === "build" && t.state === "active").sort((a, b) => (a.slot || 0) - (b.slot || 0));
      const buildLines = buildActive.length ? buildActive.map((t) => `\u7B2C${t.slot}\u30C9\u30C3\u30AF: ${t.name || "\u5EFA\u9020\u4E2D"} ${formatRemain(t.endAt)}`) : ["\u5168\u5EFA\u9020\u30C9\u30C3\u30AF\u7A7A\u304D"];
      text = ["\u3010\u5EFA\u9020\u3011", ...buildLines].join("\n");
    } else {
      const items = [];
      for (const t of state.timers) {
        if (t.state !== "active") continue;
        if (t.kind === "expedition" && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `\u7B2C${t.slot}\u8266\u968A \u9060\u5F81\u300C${t.name}\u300D`, endAt: t.endAt });
        } else if (t.kind === "repair" && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `\u7B2C${t.slot}\u30C9\u30C3\u30AF \u5165\u6E20\u300C${t.name || "\u4FEE\u7406\u4E2D"}\u300D`, endAt: t.endAt });
        } else if (t.kind === "build" && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `\u7B2C${t.slot}\u30C9\u30C3\u30AF \u5EFA\u9020${t.name ? `\u300C${t.name}\u300D` : ""}`, endAt: t.endAt });
        } else if (t.kind === "manual" && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `\u624B\u52D5\u30BF\u30A4\u30DE\u30FC\u300C${t.name}\u300D`, endAt: t.endAt });
        } else if (t.kind === "fatigue" && Number.isSafeInteger(t.endAt)) {
          const condLabel = t.detail?.target ? `[cond${t.detail.target}]` : "";
          items.push({ title: `\u7B2C${t.slot}\u8266\u968A \u75B2\u52B4\u56DE\u5FA9\u5B8C\u4E86${condLabel}`, endAt: t.endAt });
        } else if (t.kind === "akashi") {
          const events = (t.events || []).filter((e) => Number.isSafeInteger(e.endAt) && e.endAt > now - 6e4);
          const repairEvents = events.filter((e) => e.phase?.startsWith("repair_"));
          if (repairEvents.length) {
            for (const re of repairEvents) {
              const shipNames = re.text ? re.text.split("\n").map((l) => l.split(":")[0].trim()).join("\u30FB") : "";
              const nameLabel = shipNames ? `\u300C${shipNames}\u300D` : "";
              items.push({ title: `\u7B2C${t.slot}\u8266\u968A \u6CCA\u5730\u4FEE\u7406${nameLabel} \u5168\u5FEB`, endAt: re.endAt });
            }
          } else if (Number.isSafeInteger(t.endAt)) {
            items.push({ title: `\u7B2C${t.slot}\u8266\u968A \u6CCA\u5730\u4FEE\u7406`, endAt: t.endAt });
          }
        }
      }
      items.sort((a, b) => a.endAt - b.endAt);
      const itemLines = items.length ? items.map((item) => `\u30FB${item.title} ${formatRemain(item.endAt)}`) : ["\u73FE\u5728\u3001\u901A\u77E5\u4E88\u5B9A\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u5F85\u6A5F\u4E2D\uFF09"];
      text = ["\u3010\u6B21\u306E\u901A\u77E5\u4E88\u5B9A\u3011", ...itemLines].join("\n");
    }
  }
  return json({
    method: "sendMessage",
    chat_id: env.TELEGRAM_CHAT_ID,
    text: escapeHtml(text.slice(0, 3e3)),
    parse_mode: "HTML"
  });
}

// server/src/api/router.js
async function route(request, env) {
  const path = new URL(request.url).pathname, method = request.method, repo = new Repository(env.DB);
  try {
    if (path === "/webhook/telegram" && method === "POST") return await handleTelegramWebhook(request, env, repo);
    const device = await authenticate(request, env);
    if (!device) return json({ error: "unauthorized" }, 401);
    if (path === "/api/status" && method === "GET") return await handleStatus(request, env, repo);
    if (path === "/api/session" && method === "POST") return await handleSession(request, env, repo, device);
    if (path === "/api/timers" && method === "POST") return await handleTimers(request, env, repo, device);
    if (path === "/api/settings" && method === "GET") return await handleGetSettings(request, env, repo);
    if (path === "/api/settings" && method === "PATCH") return await handlePatchSettings(request, env, repo);
    if (path === "/api/manual" && ["GET", "POST"].includes(method)) return await handleManual(request, env, repo);
    const match = path.match(/^\/api\/manual\/([A-Za-z0-9_-]+)$/);
    if (match && method === "DELETE") return await handleManual(request, env, repo, match[1]);
    return json({ error: "not_found" }, 404);
  } catch (e) {
    if (e.message === "too_large") return json({ error: e.message }, 413);
    if (e.message.startsWith("invalid_") || e.message === "manual_limit") return json({ error: e.message }, 400);
    if (e.message === "manual_not_found") return json({ error: e.message }, 404);
    throw e;
  }
}

// server/src/notify/provider.js
var BaseProvider = class {
  constructor(name) {
    this.name = name;
  }
  isConfigured(env) {
    throw new Error("not_implemented");
  }
  async send(delivery, env, sendFn = fetch) {
    throw new Error("not_implemented");
  }
};

// server/src/notify/formatters/discord-embed.js
function formatDiscordPayload(delivery) {
  const style = deliveryStyle(delivery);
  return { allowed_mentions: { parse: [] }, embeds: [{ title: style.label, description: formatPlainText(delivery).slice(0, 4e3), color: style.color }] };
}

// server/src/notify/providers/discord.js
var DiscordProvider = class extends BaseProvider {
  constructor() {
    super("discord");
  }
  isConfigured(env) {
    try {
      const url = new URL(env.DISCORD_WEBHOOK_URL);
      return url.protocol === "https:" && url.hostname === "discord.com" && !url.username && !url.password && /^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(url.pathname);
    } catch {
      return false;
    }
  }
  async send(delivery, env, sendFn = fetch) {
    if (!this.isConfigured(env)) return { ok: false, permanent: true, code: "invalid_discord_webhook" };
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    const payload = formatDiscordPayload(delivery);
    try {
      const fetcher = typeof sendFn === "function" ? (...args) => sendFn.call(globalThis, ...args) : fetch;
      const response = await fetcher(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.status === 204 || response.status === 200) {
        return { ok: true, channel: this.name };
      }
      const status = Number(response.status);
      const retryHeader = response.headers?.get?.("Retry-After");
      let retryAfterMs = Number.isFinite(Number(retryHeader)) ? Math.max(0, Number(retryHeader)) * 1e3 : Math.max(0, Date.parse(retryHeader) - Date.now()) || 0;
      if (status === 429) {
        try {
          const body = await response.json();
          retryAfterMs = Math.max(retryAfterMs, Number(body.retry_after) * 1e3 || 0);
        } catch {
        }
      }
      console.error("[discord] API error status:", status);
      return {
        ok: false,
        channel: this.name,
        code: `discord_${status}`,
        permanent: [400, 401, 403, 404].includes(status),
        retryAfter: retryAfterMs
      };
    } catch (e) {
      console.error("[discord] send exception:", e);
      return { ok: false, channel: this.name, code: "transport", uncertain: true };
    }
  }
};

// server/src/notify/providers/telegram.js
var TelegramProvider = class extends BaseProvider {
  constructor() {
    super("telegram");
  }
  isConfigured(env) {
    return Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID);
  }
  async send(delivery, env, sendFn = fetch) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    const text = "<b>\u8266\u3053\u308C\u901A\u77E5</b>\n" + escapeHtml(formatPlainText(delivery));
    try {
      const fetcher = typeof sendFn === "function" ? (...args) => sendFn.call(globalThis, ...args) : fetch;
      const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
      });
      const body = await response.json();
      const status = Number(body.error_code || response.status);
      if (response.ok && body.ok) {
        return { ok: true, channel: this.name, messageId: body.result?.message_id };
      }
      console.error("[telegram] API error response:", body);
      return {
        ok: false,
        channel: this.name,
        code: `telegram_${status}`,
        permanent: [400, 401, 403, 404].includes(status),
        retryAfter: Math.max(0, Number(body.parameters?.retry_after) || 0) * 1e3
      };
    } catch (e) {
      console.error("[telegram] send exception:", e);
      return { ok: false, channel: this.name, code: "transport", uncertain: true };
    }
  }
};

// server/src/notify/dispatcher.js
var NotificationDispatcher = class {
  constructor(providers = [new DiscordProvider(), new TelegramProvider()]) {
    this.providers = providers;
  }
  async dispatch(env, { now = () => Date.now(), send = fetch } = {}) {
    const repo = new Repository(env.DB), token = crypto.randomUUID();
    const safeSend = typeof send === "function" ? (...args) => send.call(globalThis, ...args) : fetch;
    const claimed = await repo.mutate((s) => {
      reconcile(s, now());
      const ready = [];
      for (const provider of this.providers) {
        if (!s.settings.providers[provider.name]) continue;
        const d = Object.values(s.deliveries).filter((d2) => d2.provider === provider.name && ["pending", "sending"].includes(d2.status) && Math.max(d2.dueAt, d2.nextTryAt, d2.leaseUntil) <= now()).sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!d) continue;
        d.status = "sending";
        d.token = token;
        d.leaseUntil = now() + 6e4;
        d.attempts++;
        ready.push({ ...structuredClone(d), item: publicTimer(d.item, s.settings, now()) });
      }
      return ready;
    });
    const results = await Promise.all(claimed.map(async (d) => {
      const provider = this.providers.find((p) => p.name === d.provider);
      let result;
      try {
        result = provider.isConfigured(env) ? await provider.send({ ...d, sentAt: now() }, env, safeSend) : { ok: false, permanent: true, code: "not_configured" };
      } catch (e) {
        console.error(`[dispatcher] error sending via ${d.provider}:`, e);
        result = { ok: false, uncertain: true, code: "transport" };
      }
      await repo.mutate((s) => {
        const current = s.deliveries[d.id];
        if (!current || current.token !== token) return;
        current.leaseUntil = 0;
        current.status = result.ok ? "sent" : result.permanent ? "failed" : "pending";
        current.code = result.code || null;
        current.uncertain = !!result.uncertain;
        if (result.ok) {
          current.sentAt = now();
          current.messageId = result.messageId ?? null;
        } else current.nextTryAt = now() + Math.max(retryDelay(current.attempts), result.retryAfter || 0);
        const timer = s.timers[d.timerId];
        if (timer?.kind === "manual" && timer.state === "active") {
          const enabled = Object.entries(s.settings.providers).filter(([, value]) => value).map(([name]) => name);
          if (enabled.length && enabled.every((provider2) => Object.values(s.deliveries).some((job) => job.timerId === timer.id && job.provider === provider2 && job.phase === "complete" && job.status === "sent"))) {
            timer.state = "complete";
            timer.notifyAt = null;
          }
        }
        record(s, now(), result.ok ? "delivery_sent" : "delivery_failed", { id: d.id, provider: d.provider, code: current.code });
        reconcile(s, now());
      });
      return { id: d.id, provider: d.provider, ...result };
    }));
    await repo.prune(now());
    return results;
  }
};
var dispatcher = new NotificationDispatcher();
var dispatch = (env, options) => dispatcher.dispatch(env, options);

// server/src/scheduler/scheduler.js
var NotificationScheduler = class {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.serial = Promise.resolve();
    this.clients = /* @__PURE__ */ new Set();
    this.sentEvents = /* @__PURE__ */ new Set();
  }
  run(fn) {
    const next = this.serial.then(fn);
    this.serial = next.catch(() => {
    });
    return next;
  }
  async schedule() {
    const { state } = await new Repository(this.env.DB).read();
    const next = nextDeliveryAt(state, Date.now());
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
  }
  broadcast(data) {
    const text = `data: ${JSON.stringify(data)}

`;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    for (const client of Array.from(this.clients)) {
      try {
        client.writer.write(bytes).catch(() => {
          this.clients.delete(client);
        });
      } catch {
        this.clients.delete(client);
      }
    }
  }
  handleEvents(request) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    writer.write(encoder.encode(": connected\n\n")).catch(() => {
    });
    const client = { writer };
    this.clients.add(client);
    request.signal.addEventListener("abort", () => {
      this.clients.delete(client);
      try {
        writer.close();
      } catch {
      }
    });
    this.run(async () => {
      try {
        const snap = await snapshot(new Repository(this.env.DB));
        const data = { type: "sync", timers: snap.timers, now: snap.now, offsetSec: snap.settings?.offsetSec ?? 0 };
        writer.write(encoder.encode(`data: ${JSON.stringify(data)}

`)).catch(() => {
        });
      } catch {
      }
    });
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  async checkDesktopNotifications(now) {
    const { state } = await new Repository(this.env.DB).read();
    const activeKeys = /* @__PURE__ */ new Set();
    for (const timer of Object.values(state.timers || {})) {
      if (timer.state !== "active") continue;
      for (const event of timer.events || []) {
        if (!Number.isSafeInteger(event.endAt)) continue;
        const key = `${timer.id}:${event.id}:${event.phase}`;
        activeKeys.add(key);
        const dueAt = event.endAt + (timer.kind === "manual" ? 0 : state.settings.offsetSec * 1e3);
        if (now >= dueAt && !this.sentEvents.has(key)) {
          this.sentEvents.add(key);
          this.broadcast({
            type: "notify",
            timerId: timer.id,
            kind: timer.kind,
            slot: timer.slot,
            name: timer.name,
            phase: event.phase,
            timestamp: now
          });
        }
      }
    }
    for (const k of Array.from(this.sentEvents)) {
      if (!activeKeys.has(k)) {
        this.sentEvents.delete(k);
      }
    }
  }
  fetch(request) {
    return this.run(async () => {
      const url = new URL(request.url);
      if (url.pathname === "/api/events" && request.method === "GET") {
        return this.handleEvents(request);
      }
      await this.ctx.storage.setAlarm(Date.now() + 6e4);
      const response = await route(request, this.env);
      await this.schedule();
      if (["POST", "PATCH", "DELETE"].includes(request.method) && this.clients.size > 0 && response.ok) {
        try {
          const snap = await snapshot(new Repository(this.env.DB));
          this.broadcast({ type: "update", timers: snap.timers, now: snap.now, offsetSec: snap.settings?.offsetSec ?? 0 });
        } catch {
        }
      }
      return response;
    });
  }
  alarm() {
    return this.run(async () => {
      await this.ctx.storage.setAlarm(Date.now() + 6e4);
      const now = Date.now();
      await dispatch(this.env, { send: this.env.NOTIFICATION_SEND ? (...args) => this.env.NOTIFICATION_SEND(...args) : fetch });
      await this.checkDesktopNotifications(now);
      await this.schedule();
    });
  }
};

// server/src/index.js
var src_default = {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname !== "/webhook/telegram" && !await authenticate(request, env)) return json({ error: "unauthorized" }, 401);
      if (!env.SCHEDULER) return json({ error: "scheduler_unavailable" }, 503);
      return await env.SCHEDULER.get(env.SCHEDULER.idFromName("owner")).fetch(request);
    } catch {
      return json({ error: "server_error" }, 503);
    }
  }
};
export {
  NotificationScheduler,
  src_default as default,
  dispatch
};
