// NERO AI — free image generation proxy on Cloudflare Workers AI.
// Setup: bind Workers AI as "AI" and set ALLOWED_ORIGINS to exact site origins (comma separated).
// SESSION_SECRET is required and must match the chat worker. The worker fails closed if misconfigured.

const MODELS = {
  'flux-1-schnell': '@cf/black-forest-labs/flux-1-schnell',
  'sdxl-lightning': '@cf/bytedance/stable-diffusion-xl-lightning',
};

// Best-effort per-IP limit (resets when the worker instance restarts): 10 images per minute.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 10;
}

// Same session token format as chat-worker.js (HMAC-SHA256 over base64url payload).
const te = new TextEncoder(), td = new TextDecoder();
const b64uDec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
async function verifySession(token, secret) {
  try {
    const [data, sig] = String(token || '').split('.');
    if (!data || !sig) return null;
    const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('HMAC', key, b64uDec(sig), te.encode(data)))) return null;
    const p = JSON.parse(td.decode(b64uDec(data)));
    return p && p.sub && p.exp * 1000 > Date.now() ? p : null;
  } catch { return null; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = Boolean(origin) && allowed.length > 0 && !allowed.includes('*') && allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };
    const json = (obj, status) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (!allowed.length || allowed.includes('*') || !env.SESSION_SECRET || !env.AI) return json({ error: 'Worker is not configured securely' }, 500);
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
    if (!originOk) return json({ error: 'Origin not allowed' }, 403);
    const tok = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!(await verifySession(tok, env.SESSION_SECRET))) return json({ error: 'Please sign in' }, 401);
    if (limited(request.headers.get('CF-Connecting-IP') || 'unknown')) return json({ error: 'Too many requests, wait a minute' }, 429);

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > 16_384) return json({ error: 'Request too large' }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request body' }, 400);

    const prompt = String(body.prompt || '').trim().slice(0, 2000);
    if (!prompt) return json({ error: 'Missing prompt' }, 400);
    const modelKey = MODELS[body.model] ? body.model : 'flux-1-schnell';

    try {
      if (modelKey === 'flux-1-schnell') {
        const out = await env.AI.run(MODELS[modelKey], { prompt, steps: 6 });
        const bin = Uint8Array.from(atob(out.image), c => c.charCodeAt(0));
        return new Response(bin, { headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
      }
      const clamp = (v) => Math.min(1024, Math.max(256, Math.round(Number(v) / 8) * 8 || 1024));
      const out = await env.AI.run(MODELS[modelKey], { prompt, width: clamp(body.width), height: clamp(body.height) });
      return new Response(out, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
    } catch (e) {
      const msg = String(e && e.message || e);
      const quota = /limit|quota|neurons|capacity/i.test(msg);
      return json({ error: quota ? 'Daily free limit reached' : 'Generation failed' }, quota ? 429 : 500);
    }
  },
};
