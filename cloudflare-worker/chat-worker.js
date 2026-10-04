// NERO AI — chat proxy with Google sign-in and per-user daily quota.
// Provider keys stay on the server; each signed-in user gets an app session token + their own daily allowance.
//
// Setup (see README): D1 database bound as DB (run schema.sql), then in Settings -> Variables and Secrets:
//   Secrets  : GROQ_API_KEY (optional), GEMINI_API_KEY, CEREBRAS_API_KEY, SESSION_SECRET (required, 32+ random chars)
//   Bindings : AI (optional Workers AI binding; enables the free nero/cloudflare fallback)
//   Variables: ALLOWED_ORIGINS (required), GOOGLE_CLIENT_ID (required), DAILY_LIMIT (optional, default 40)
//              GEMINI_MODEL (default gemini-flash-latest), CEREBRAS_MODEL (default gpt-oss-120b)
//              CLOUDFLARE_MODEL (default @cf/meta/llama-3.1-8b-instruct)

const UPSTREAM = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
};
const GROQ_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
const CLOUDFLARE_MODEL = 'nero/cloudflare';
const SESSION_DAYS = 30;

function route(model, env) {
  if (GROQ_MODELS.has(model)) return { provider: 'groq', key: env.GROQ_API_KEY, model };
  if (model === 'nero/gemini-flash') return { provider: 'gemini', key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-flash-latest' };
  if (model === 'nero/cerebras') return { provider: 'cerebras', key: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL || 'gpt-oss-120b' };
  if (model === CLOUDFLARE_MODEL) return { provider: 'cloudflare', key: env.AI ? 'workers-ai-binding' : '', model: env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct' };
  return null;
}

// ---------- base64url + signing helpers ----------
const te = new TextEncoder(), td = new TextDecoder();
const b64uEnc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

async function signSession(payload, secret) {
  const data = b64uEnc(te.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), te.encode(data));
  return data + '.' + b64uEnc(sig);
}
async function verifySession(token, secret) {
  try {
    const [data, sig] = String(token || '').split('.');
    if (!data || !sig) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), b64uDec(sig), te.encode(data));
    if (!ok) return null;
    const p = JSON.parse(td.decode(b64uDec(data)));
    return p && p.sub && p.exp * 1000 > Date.now() ? p : null;
  } catch { return null; }
}

// Verifies a Google Sign-In ID token (RS256) against Google's public keys.
async function verifyGoogleIdToken(idToken, env) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(td.decode(b64uDec(parts[0])));
    if (header.alg !== 'RS256') return null;
    const jwks = await (await fetch('https://www.googleapis.com/oauth2/v3/certs', { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
    const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uDec(parts[2]), te.encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const p = JSON.parse(td.decode(b64uDec(parts[1])));
    const issOk = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
    if (!issOk || p.aud !== env.GOOGLE_CLIENT_ID || p.exp * 1000 < Date.now() || !p.sub || p.email_verified !== true) return null;
    return p;
  } catch { return null; }
}

// Best-effort per-IP limit (in-memory): 20 requests per minute.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 20;
}

const num = (v, min, max, def) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };

// Atomically count a successful response without allowing concurrent requests to
// push a user over the daily limit. Returns null if the database operation fails.
async function chargeSuccessfulMessage(env, uid, day, limit) {
  try {
    return await env.DB.prepare(
      'INSERT INTO usage_daily (uid, day, n) VALUES (?, ?, 1) ' +
      'ON CONFLICT(uid, day) DO UPDATE SET n = usage_daily.n + 1 ' +
      'WHERE usage_daily.n < ? RETURNING n'
    ).bind(uid, day, limit).first();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };
    const reply = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    const err = (message, status) => reply({ error: { message } }, status);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return err('Use POST', 405);
    if (!allowed.length || !env.SESSION_SECRET || !env.GOOGLE_CLIENT_ID) return err('Server is not configured', 500);
    if (!originOk) return err('Origin not allowed', 403);
    if (limited(request.headers.get('CF-Connecting-IP') || 'unknown')) return err('Too many requests, wait a minute', 429);

    const path = new URL(request.url).pathname;

    // ---- POST /auth : exchange a Google ID token for an app session token ----
    if (path === '/auth') {
      let b; try { b = await request.json(); } catch { return err('Invalid JSON', 400); }
      const g = await verifyGoogleIdToken(b.credential, env);
      if (!g) return err('Google sign-in could not be verified', 401);
      const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
      const token = await signSession({ sub: g.sub, exp }, env.SESSION_SECRET);
      return reply({ token, exp, uid: g.sub, email: g.email, name: g.name || g.email }, 200);
    }

    // ---- POST / : chat ----
    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const user = await verifySession(bearer, env.SESSION_SECRET);
    if (!user) return err('Please sign in', 401);

    if (!env.DB) return err('Server is not configured (DB)', 500);

    // ---- POST /sync : save this user's chats and return changes since the cursor (not counted in the daily quota) ----
    if (path === '/sync') {
      const text = await request.text();
      if (text.length > 6_000_000) return err('Request too large', 413);
      let b; try { b = JSON.parse(text); } catch { return err('Invalid JSON', 400); }
      const now = Date.now();
      const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 80;
      const stmts = [];
      for (const c of (Array.isArray(b.upserts) ? b.upserts.slice(0, 5) : [])) {
        if (!c || !validId(c.id) || !Array.isArray(c.messages)) continue;
        const data = JSON.stringify({ title: String(c.title || '').slice(0, 200), createdAt: num(c.createdAt, 0, 8.64e15, now), messages: c.messages.slice(0, 100) });
        if (data.length > 900_000) continue; // D1 row limit is 2 MB; keep headroom
        stmts.push(env.DB.prepare(
          'INSERT INTO chats (uid, id, data, updated_at, synced_at, deleted) VALUES (?, ?, ?, ?, ?, 0) ' +
          'ON CONFLICT(uid, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, synced_at = excluded.synced_at, deleted = 0 ' +
          'WHERE excluded.updated_at >= chats.updated_at'
        ).bind(user.sub, c.id, data, num(c.updatedAt, 0, now + 86400000, now), now));
      }
      for (const id of (Array.isArray(b.deletes) ? b.deletes.slice(0, 50) : [])) {
        if (!validId(id)) continue;
        stmts.push(env.DB.prepare(
          "INSERT INTO chats (uid, id, data, updated_at, synced_at, deleted) VALUES (?, ?, '{}', ?, ?, 1) " +
          "ON CONFLICT(uid, id) DO UPDATE SET data = '{}', updated_at = excluded.updated_at, synced_at = excluded.synced_at, deleted = 1"
        ).bind(user.sub, id, now, now));
      }
      try {
        if (stmts.length) await env.DB.batch(stmts);
        const since = num(b.since, 0, 8.64e15, 0);
        const { results } = await env.DB.prepare(
          'SELECT id, data, updated_at, deleted FROM chats WHERE uid = ? AND synced_at > ? ORDER BY updated_at DESC LIMIT 100'
        ).bind(user.sub, since).all();
        const chats = (results || []).map(r => {
          let d = {}; try { d = JSON.parse(r.data); } catch {}
          return { id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, title: d.title, createdAt: d.createdAt, messages: d.messages };
        });
        return reply({ cursor: now, chats }, 200);
      } catch {
        return err('Sync failed', 500);
      }
    }
    const day = new Date().toISOString().slice(0, 10); // quota resets at 00:00 UTC
    const limit = num(env.DAILY_LIMIT, 1, 100000, 40);
    const row = await env.DB.prepare('SELECT n FROM usage_daily WHERE uid = ? AND day = ?').bind(user.sub, day).first();
    if ((row?.n || 0) >= limit) return err('Daily limit reached', 402); // 402 = per-user limit (not provider 429)

    const raw = await request.text();
    if (raw.length > 16_000_000) return err('Request too large', 413);
    let b;
    try { b = JSON.parse(raw); } catch { return err('Invalid JSON', 400); }

    const r = route(b.model, env);
    if (!r) return err('Unknown model', 400);
    if (!r.key) return err('Provider not configured', 404); // client skips to the next model

    const msgs = Array.isArray(b.messages) ? b.messages : null;
    if (!msgs || !msgs.length || msgs.length > 200 || msgs.some(m => !m || !['system', 'user', 'assistant'].includes(m.role))) {
      return err('Invalid messages', 400);
    }

    const maxTokens = num(b.max_completion_tokens, 1, 8192, 4096);
    const body = { model: r.model, messages: msgs, stream: !!b.stream, temperature: num(b.temperature, 0, 2, 0.7) };
    if (r.provider === 'gemini') body.max_tokens = maxTokens; else body.max_completion_tokens = maxTokens;

    if (r.provider === 'groq') {
      if (['none', 'low', 'medium', 'high'].includes(b.reasoning_effort)) body.reasoning_effort = b.reasoning_effort;
      if (typeof b.include_reasoning === 'boolean') body.include_reasoning = b.include_reasoning;
      if (b.reasoning_format === 'hidden') body.reasoning_format = 'hidden';
      if (Array.isArray(b.tools) && b.tools.length === 1 && b.tools[0]?.type === 'browser_search') {
        body.tools = [{ type: 'browser_search' }];
        if (b.tool_choice === 'required') body.tool_choice = 'required';
      }
    }

    // Workers AI has no OpenAI-compatible HTTP endpoint here, so normalize its
    // response to the same SSE contract consumed by index.html.
    if (r.provider === 'cloudflare') {
      try {
        const out = await env.AI.run(r.model, {
          messages: msgs,
          max_tokens: maxTokens,
          temperature: body.temperature,
          stream: false,
        });
        const answer = String(out?.response || out?.result?.response || '').trim();
        if (!answer) return err('Empty AI response', 502);
        const charged = await chargeSuccessfulMessage(env, user.sub, day, limit);
        if (charged === null) return err('Quota accounting failed', 500);
        if (!charged) return err('Daily limit reached', 402);
        if (!b.stream) {
          return reply({ choices: [{ message: { role: 'assistant', content: answer } }] }, 200);
        }
        const encoder = new TextEncoder();
        const payload = JSON.stringify({ choices: [{ delta: { content: answer } }] });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
      } catch (e) {
        return err(`Cloudflare AI failed: ${String(e?.message || e).slice(0, 240)}`, 502);
      }
    }

    let up;
    try {
      up = await fetch(UPSTREAM[r.provider], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${r.key}` },
        body: JSON.stringify(body),
      });
    } catch {
      return err('Upstream unreachable', 502);
    }

    if (!up.ok) {
      // Never forward 401/403 from providers: 401 from us must only mean "your session is invalid".
      if (up.status === 401 || up.status === 403) return err('Provider rejected the server key', 502);
      let msg = 'Upstream error';
      try { const j = await up.json(); msg = String(j?.error?.message || j?.message || msg).slice(0, 300); } catch {}
      return err(msg, up.status === 402 ? 502 : up.status);
    }

    // Count only successful requests, so provider fallback attempts cost one message.
    const charged = await chargeSuccessfulMessage(env, user.sub, day, limit);
    if (charged === null) return err('Quota accounting failed', 500);
    if (!charged) return err('Daily limit reached', 402);

    return new Response(up.body, {
      status: 200,
      headers: { ...cors, 'Content-Type': up.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
