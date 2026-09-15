export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
}

export async function authenticate(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if (!token) return null;
  let devices;
  try {
    devices = JSON.parse(env.DEVICE_TOKENS || '{}');
  } catch {
    return null;
  }
  const digest = await hash(token);
  return Object.entries(devices).find(([id, h]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && h === digest)?.[0] || null;
}
