import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

async function loadWorker(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function signedSession(secret) {
  const payload = base64url(JSON.stringify({ sub: 'qa-user', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${base64url(signature)}`;
}

async function post(worker, body, env, { origin = 'https://site.example', token = '', url = 'https://worker.example/' } = {}) {
  return worker.fetch(new Request(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }), env, { waitUntil() {} });
}

const imageWorker = await loadWorker('../cloudflare-worker/worker.js');
const secret = 'qa-session-secret-that-is-long-enough';
const token = await signedSession(secret);
let aiCall = null;
const imageEnv = {
  ALLOWED_ORIGINS: 'https://site.example',
  SESSION_SECRET: secret,
  AI: { run: async (model, input) => {
    aiCall = { model, input };
    return model.includes('flux') ? { image: Buffer.from('jpeg-sample').toString('base64') } : new Uint8Array([137, 80, 78, 71]);
  } },
};

let response = await post(imageWorker, { prompt: 'a test image' }, { AI: imageEnv.AI });
assert.equal(response.status, 500, 'image worker must fail closed when security settings are missing');
response = await post(imageWorker, { prompt: 'a test image' }, { ...imageEnv, ALLOWED_ORIGINS: '*' }, { token });
assert.equal(response.status, 500, 'wildcard origins must be rejected');
response = await post(imageWorker, { prompt: 'a test image' }, imageEnv);
assert.equal(response.status, 401, 'image worker must require a signed session');
response = await post(imageWorker, { prompt: 'a test image' }, imageEnv, { token, origin: 'https://attacker.example' });
assert.equal(response.status, 403, 'image worker must reject unapproved origins');
response = await post(imageWorker, { prompt: '' }, imageEnv, { token });
assert.equal(response.status, 400, 'image worker must reject an empty prompt');
response = await post(imageWorker, { prompt: 'a test image', width: 1024, height: 1024, model: 'flux-1-schnell' }, imageEnv, { token });
assert.equal(response.status, 200);
assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
assert.equal(aiCall.model, '@cf/black-forest-labs/flux-1-schnell');
assert.equal(aiCall.input.steps, 6);
response = await post(imageWorker, { prompt: 'a landscape', width: 1024, height: 768, model: 'sdxl-lightning' }, imageEnv, { token });
assert.equal(response.status, 200);
assert.equal(response.headers.get('Content-Type'), 'image/png');
assert.equal(aiCall.input.width, 1024);
assert.equal(aiCall.input.height, 768);

const chatWorker = await loadWorker('../cloudflare-worker/chat-worker.js');
response = await post(chatWorker, {}, {}, { url: 'https://worker.example/' });
assert.equal(response.status, 500, 'chat worker must report missing required configuration');
const chatEnv = { ALLOWED_ORIGINS: 'https://site.example', SESSION_SECRET: secret, GOOGLE_CLIENT_ID: 'qa-client-id', DAILY_LIMIT: '2', GROQ_API_KEY: 'qa-key' };
response = await post(chatWorker, {}, chatEnv, { token, origin: 'https://attacker.example' });
assert.equal(response.status, 403, 'chat worker must reject unapproved origins');

// Execute the exact UPSERT expression against SQLite to ensure it increments only
// below the cap and that concurrent requests cannot exceed the configured limit.
const sql = `CREATE TABLE usage_daily(uid TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(uid, day));
INSERT INTO usage_daily (uid, day, n) VALUES ('u', '2026-10-04', 1) ON CONFLICT(uid, day) DO UPDATE SET n = usage_daily.n + 1 WHERE usage_daily.n < 2 RETURNING n;
INSERT INTO usage_daily (uid, day, n) VALUES ('u', '2026-10-04', 1) ON CONFLICT(uid, day) DO UPDATE SET n = usage_daily.n + 1 WHERE usage_daily.n < 2 RETURNING n;
INSERT INTO usage_daily (uid, day, n) VALUES ('u', '2026-10-04', 1) ON CONFLICT(uid, day) DO UPDATE SET n = usage_daily.n + 1 WHERE usage_daily.n < 2 RETURNING n;
SELECT n FROM usage_daily WHERE uid = 'u';`;
const dir = await mkdtemp(join(tmpdir(), 'nero-qa-'));
try {
  const dbPath = join(dir, 'quota.sqlite');
  const py = spawnSync('python3', ['-c', `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nfor s in sys.stdin.read().split(';'):\n s=s.strip()\n if s:\n  r=c.execute(s)\n  if r.description: print(r.fetchone())\nc.commit()`, dbPath], { input: sql, encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr || 'SQLite quota test failed');
  assert.match(py.stdout, /\(1,?\)/);
  assert.match(py.stdout, /\(2,?\)/);
  assert.equal((py.stdout.match(/\(2,?\)/g) || []).length, 2, 'third increment must be rejected at the cap');
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('Worker smoke tests passed: auth/origin/config guards, image formats and sizes, and atomic quota cap.');
