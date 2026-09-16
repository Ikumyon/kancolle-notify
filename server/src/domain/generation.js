export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export function issueSession(s, requestId, device) {
  if (!validId(requestId)) throw new Error('invalid_session');
  const key = device + ':' + requestId;
  if (s.sessions[key]) return { sessionId: s.sessions[key], fresh: false };
  const sessionId = crypto.randomUUID();
  s.sessions[key] = sessionId;
  s.session = { id: sessionId, device, sequence: 0 };
  return { sessionId, fresh: true };
}
