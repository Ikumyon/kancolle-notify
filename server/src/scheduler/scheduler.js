import { Repository } from '../repository/repository.js';
import { nextDeliveryAt } from '../domain/timer.js';
import { route } from '../api/router.js';
import { dispatch } from '../notify/dispatcher.js';
import { snapshot } from '../api/handlers/status.js';
export class NotificationScheduler {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.serial = Promise.resolve();
    this.clients = new Set();
    this.sentEvents = new Set();
  }
  run(fn) { const next = this.serial.then(fn); this.serial = next.catch(() => {}); return next; }
  async schedule() {
    const { state } = await new Repository(this.env.DB).read();
    const next = nextDeliveryAt(state, Date.now());
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
  }
  broadcast(data) {
    const text = `data: ${JSON.stringify(data)}\n\n`;
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
    writer.write(encoder.encode(': connected\n\n')).catch(() => {});
    const client = { writer };
    this.clients.add(client);
    request.signal.addEventListener('abort', () => {
      this.clients.delete(client);
      try { writer.close(); } catch {}
    });
    this.run(async () => {
      try {
        const snap = await snapshot(new Repository(this.env.DB));
        const data = { type: 'sync', timers: snap.timers, now: snap.now, offsetSec: snap.settings?.offsetSec ?? 0 };
        writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {});
      } catch {}
    });
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  async checkDesktopNotifications(now) {
    const { state } = await new Repository(this.env.DB).read();
    const activeKeys = new Set();
    for (const timer of Object.values(state.timers || {})) {
      if (timer.state !== 'active') continue;
      for (const event of timer.events || []) {
        if (!Number.isSafeInteger(event.endAt)) continue;
        const key = `${timer.id}:${event.id}:${event.phase}`;
        activeKeys.add(key);
        const dueAt = event.endAt + (timer.kind === 'manual' ? 0 : state.settings.offsetSec * 1000);
        if (now >= dueAt && !this.sentEvents.has(key)) {
          this.sentEvents.add(key);
          this.broadcast({
            type: 'notify',
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
    // 古い送信済みキーのクリーンアップ
    for (const k of Array.from(this.sentEvents)) {
      if (!activeKeys.has(k)) {
        this.sentEvents.delete(k);
      }
    }
  }
  fetch(request) {
    return this.run(async () => {
      const url = new URL(request.url);
      if (url.pathname === '/api/events' && request.method === 'GET') {
        return this.handleEvents(request);
      }
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      const response = await route(request, this.env);
      await this.schedule();
      if (['POST', 'PATCH', 'DELETE'].includes(request.method) && this.clients.size > 0 && response.ok) {
        try {
          const snap = await snapshot(new Repository(this.env.DB));
          this.broadcast({ type: 'update', timers: snap.timers, now: snap.now, offsetSec: snap.settings?.offsetSec ?? 0 });
        } catch {}
      }
      return response;
    });
  }
  alarm() {
    return this.run(async () => {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      const now = Date.now();
      await dispatch(this.env, { send: this.env.NOTIFICATION_SEND ? (...args) => this.env.NOTIFICATION_SEND(...args) : fetch });
      await this.checkDesktopNotifications(now);
      await this.schedule();
    });
  }
}
