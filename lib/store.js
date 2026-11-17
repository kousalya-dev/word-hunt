// Tiny key-value/hash store with two backends:
//  - Upstash Redis (used on Vercel; env UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
//  - Local JSON file (used when running on your laptop without Redis)
// All values are strings; callers JSON-encode.
const fs = require('fs');
const path = require('path');

function redisStore(url, token) {
  const { Redis } = require('@upstash/redis');
  const r = new Redis({ url, token, automaticDeserialization: false });
  const str = (v) => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));
  return {
    kind: 'redis',
    get: async (k) => str(await r.get(k)),
    set: (k, v, ttl) => (ttl ? r.set(k, v, { ex: ttl }) : r.set(k, v)),
    setnx: async (k, v) => (await r.setnx(k, v)) === 1,
    del: (...ks) => (ks.length ? r.del(...ks) : 0),
    expire: (k, s) => r.expire(k, s),
    hget: async (k, f) => str(await r.hget(k, f)),
    hset: (k, f, v) => r.hset(k, { [f]: v }),
    hsetnx: async (k, f, v) => (await r.hsetnx(k, f, v)) === 1,
    hdel: (k, ...fs) => (fs.length ? r.hdel(k, ...fs) : 0),
    hlen: (k) => r.hlen(k),
    hgetall: async (k) => {
      // without automatic deserialization the SDK returns a flat [field, value, ...] array
      const raw = (await r.hgetall(k)) || {};
      const o = {};
      if (Array.isArray(raw)) for (let i = 0; i < raw.length; i += 2) o[raw[i]] = str(raw[i + 1]);
      else for (const f of Object.keys(raw)) o[f] = str(raw[f]);
      return o;
    },
    mget: async (ks) => (ks.length ? (await r.mget(...ks)).map(str) : []),
  };
}

function fileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let db = {};
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let t = null;
  const save = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);
    }, 150);
  };
  const h = (k) => (db[k] && typeof db[k] === 'object' ? db[k] : (db[k] = {}));
  return {
    kind: 'file',
    get: async (k) => (typeof db[k] === 'string' ? db[k] : null),
    set: async (k, v) => { db[k] = v; save(); },
    setnx: async (k, v) => { if (db[k] !== undefined) return false; db[k] = v; save(); return true; },
    del: async (...ks) => { ks.forEach((k) => delete db[k]); save(); },
    expire: async () => {},
    hget: async (k, f) => (db[k] && db[k][f] !== undefined ? db[k][f] : null),
    hset: async (k, f, v) => { h(k)[f] = v; save(); },
    hsetnx: async (k, f, v) => { const o = h(k); if (o[f] !== undefined) return false; o[f] = v; save(); return true; },
    hdel: async (k, ...fs) => { if (db[k]) fs.forEach((f) => delete db[k][f]); save(); },
    hlen: async (k) => Object.keys(db[k] || {}).length,
    hgetall: async (k) => ({ ...(db[k] || {}) }),
    mget: async (ks) => ks.map((k) => (typeof db[k] === 'string' ? db[k] : null)),
  };
}

function createStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return redisStore(url, token);
  if (process.env.VERCEL) return null; // serverless needs a shared database
  const dir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  return fileStore(path.join(dir, 'store.json'));
}

module.exports = { createStore };
