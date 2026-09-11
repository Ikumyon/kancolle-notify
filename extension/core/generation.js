export const MAX_GENERATION = 9223372036854775807n;
export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const validGeneration = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= MAX_GENERATION;
export function beginSession(s, session, device, now) {
  if (!validId(session)) throw new Error('invalid_session');
  const key = `${device}:${session}`;
  if (s.starts[key]) return s.starts[key];
  if (BigInt(s.generation) === MAX_GENERATION) {
    s.epoch = crypto.randomUUID(); s.generation = '0';
  }
  s.generation = (BigInt(s.generation) + 1n).toString();
  s.activeSession = { device, session, seq: 0 };
  const ticket = { epoch: s.epoch, generation: s.generation, session };
  s.starts[key] = ticket;
  s.history.push({ at: now, type: 'session_start', device, generation: s.generation });
  return ticket;
}
export function isCurrent(s, o, device) {
  return s.epoch === o.epoch && s.generation === o.generation
    && s.activeSession?.device === device && s.activeSession.session === o.session;
}
export const eventKey = e => `${e.kind}:${e.slot}`;
export const eventSignature = e => JSON.stringify([e.state, e.end, e.subject, e.name || '', e.repair || null]);
