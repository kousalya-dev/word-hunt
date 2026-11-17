// Word Hunt: phone-based "fill the missing letters" team game.
// Local:  npm start   (data saved in ./data)      Vercel: zero-config Express + Upstash Redis
const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createStore } = require('./lib/store');
const { cleanWord, normalize, letterIdx, autoReveal, buildDefaults } = require('./lib/words');
const mail = require('./lib/mail');

const PORT = Number(process.env.PORT) || 3000;
const QUESTION_COUNT = Number(process.env.QUESTION_COUNT) || 25;
const TIME_LIMIT_MS = (Number(process.env.TIME_LIMIT) || 45) * 1000;
const MAX_TRIES = Number(process.env.MAX_TRIES) || 3;
const SCORING = { base: 100, speed: 100, hintPenalty: 25, maxHints: 3 };
const GRACE_MS = 1500;
const NAME_MAX = 20;
const TTL = 7 * 24 * 3600; // game data (incl. emails) auto-deletes after 7 days on Redis
const IS_VERCEL = !!process.env.VERCEL;

const store = createStore();

// ---------- keys & JSON helpers ----------
const K = {
  pin: 'wh:pin',
  words: 'wh:words',
  game: 'wh:game',
  players: (g) => `wh:${g}:players`, // id -> profile (name, emoji, email, token)
  names: (g) => `wh:${g}:names`,     // lowercase name -> id
  tok: (g) => `wh:${g}:tok`,         // token -> id
  stats: (g) => `wh:${g}:stats`,     // id -> {answered, correct, score, totalMs, hints, finished}
  prog: (g, id) => `wh:${g}:p:${id}`, // per-player progress
};
const parse = (s, d = null) => { if (s === null || s === undefined) return d; try { return JSON.parse(s); } catch { return d; } };
const getJ = async (k, d = null) => parse(await store.get(k), d);
const setJ = (k, v, ttl) => store.set(k, JSON.stringify(v), ttl);
const newId = () => crypto.randomBytes(8).toString('hex');
const freshGame = () => ({ gameId: crypto.randomBytes(6).toString('hex'), status: 'lobby', startedAt: null, endedAt: null, questions: [], emailed: {} });

async function getGame() {
  let g = await getJ(K.game);
  if (!g) { await store.setnx(K.game, JSON.stringify(freshGame())); g = await getJ(K.game); }
  return g;
}
async function getWords() {
  let w = await getJ(K.words);
  if (!w) { await store.setnx(K.words, JSON.stringify(buildDefaults())); w = await getJ(K.words); }
  return w;
}
let localPin = null;
async function hostPin() {
  if (process.env.HOST_PIN) return String(process.env.HOST_PIN);
  if (IS_VERCEL) return null; // must be configured on Vercel
  if (localPin) return localPin;
  await store.setnx(K.pin, String(crypto.randomInt(1000, 10000)));
  return (localPin = await store.get(K.pin));
}

// ---------- game helpers ----------
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) return ni.address;
  return 'localhost';
}
function joinUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '') + '/';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) return `http://${lanAddress()}:${PORT}/`;
  return `${req.headers['x-forwarded-proto'] || req.protocol}://${host}/`;
}
const pattern = (q) => [...q.word].map((ch, i) => (/[A-Z]/.test(ch) ? (q.reveal.includes(i) ? ch : null) : ch));
const pointsFor = (ms, hints) => Math.max(0, SCORING.base + Math.round(SCORING.speed * (1 - ms / TIME_LIMIT_MS)) - SCORING.hintPenalty * hints);

function statsOf(prog) {
  const a = prog.answers;
  return {
    answered: a.length,
    correct: a.filter((x) => x.correct).length,
    score: a.reduce((s, x) => s + x.points, 0),
    totalMs: a.reduce((s, x) => s + x.ms, 0),
    hints: a.reduce((s, x) => s + (x.hints || 0), 0),
    finished: !!prog.finishedAt,
  };
}
async function saveProgress(g, id, prog) {
  await Promise.all([setJ(K.prog(g.gameId, id), prog, TTL), store.hset(K.stats(g.gameId), id, JSON.stringify(statsOf(prog)))]);
}
function finishQuestion(g, prog, correct, now, timedOut = false) {
  const s = prog.served;
  const q = g.questions[s.index];
  const ms = timedOut ? TIME_LIMIT_MS : Math.min(Math.max(0, now - s.startedAt), TIME_LIMIT_MS);
  const points = correct ? pointsFor(ms, s.hints) : 0;
  prog.answers.push({ correct, ms, points, timedOut, hints: s.hints, tries: s.tries });
  prog.served = null;
  if (prog.answers.length >= g.questions.length) prog.finishedAt = now;
  return { correct, points, timedOut, hintsUsed: s.hints, answer: q.word };
}
// returns true if it changed progress
function expireIfNeeded(g, prog, now = Date.now()) {
  if (g.status !== 'live' && g.status !== 'ended') return false;
  if (prog.served && now - prog.served.startedAt > TIME_LIMIT_MS + GRACE_MS) { finishQuestion(g, prog, false, now, true); return true; }
  return false;
}
function view(g, prog, now = Date.now()) {
  const s = prog.served;
  const q = g.questions[s.index];
  return {
    state: 'question',
    index: s.index,
    total: g.questions.length,
    category: q.category || '',
    letters: letterIdx(q.word).length,
    pattern: pattern(q),
    hints: q.hints.slice(0, s.hints),
    hintsTotal: q.hints.length,
    triesLeft: MAX_TRIES - s.tries,
    maxTries: MAX_TRIES,
    remainingMs: Math.max(0, TIME_LIMIT_MS - (now - s.startedAt)),
    timeLimitMs: TIME_LIMIT_MS,
  };
}
async function leaderboard(g) {
  const [players, stats] = await Promise.all([store.hgetall(K.players(g.gameId)), store.hgetall(K.stats(g.gameId))]);
  const empty = { answered: 0, correct: 0, score: 0, totalMs: 0, hints: 0, finished: false };
  return Object.entries(players)
    .map(([id, p]) => { const pr = parse(p, {}); return { id, name: pr.name, emoji: pr.emoji, email: pr.email || '', joinedAt: pr.joinedAt, ...empty, ...parse(stats[id], {}) }; })
    .sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.joinedAt - b.joinedAt)
    .map((r, i) => ({ rank: i + 1, ...r }));
}
const publicRow = ({ email, joinedAt, ...r }) => r;
const maskEmail = (e) => { const [u, d] = e.split('@'); return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`; };

// ---------- app ----------
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
if (!IS_VERCEL) app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// On Vercel, /public is served by the CDN; friendly short links:
app.get('/host', (req, res) => res.redirect('/host.html'));
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/', (req, res) => res.redirect('/index.html'));

app.use('/api', (req, res, next) => {
  if (!store) return res.status(503).json({ error: 'Database not connected. In Vercel → Storage, connect an Upstash Redis database and redeploy.' });
  next();
});

const err = (res, code, msg) => res.status(code).json({ error: msg });

async function player(req, res, next) {
  const g = await getGame();
  const id = await store.hget(K.tok(g.gameId), req.get('x-player-token') || '-');
  if (!id) return err(res, 401, 'Not joined');
  req.game = g;
  req.pid = id;
  req.prog = (await getJ(K.prog(g.gameId, id))) || { answers: [], served: null, finishedAt: null };
  next();
}
async function host(req, res, next) {
  const pin = await hostPin();
  if (!pin) return err(res, 503, 'HOST_PIN is not set. Add it in Vercel → Settings → Environment Variables and redeploy.');
  if ((req.get('x-host-pin') || '') !== pin) return err(res, 401, 'Wrong PIN');
  next();
}

// ----- player API -----
app.get('/api/status', async (req, res) => {
  const g = await getGame();
  const words = g.status === 'lobby' ? await getWords() : null;
  res.json({
    status: g.status, gameId: g.gameId,
    questionCount: g.status === 'lobby' ? Math.min(words.length, QUESTION_COUNT) : g.questions.length,
    timeLimit: TIME_LIMIT_MS / 1000, maxTries: MAX_TRIES, scoring: SCORING,
    players: await store.hlen(K.players(g.gameId)),
  });
});

// Who's in the room (names + avatars only), for the waiting screen
app.get('/api/lobby', async (req, res) => {
  const g = await getGame();
  const players = Object.values(await store.hgetall(K.players(g.gameId))).map((p) => parse(p, {}))
    .sort((a, b) => a.joinedAt - b.joinedAt).map(({ name, emoji }) => ({ name, emoji }));
  res.json({ status: g.status, gameId: g.gameId, players });
});

app.post('/api/join', async (req, res) => {
  const g = await getGame();
  if (g.status === 'ended') return err(res, 403, 'This game has ended. Ask the host to start a new one.');
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (name.length < 2) return err(res, 400, 'Name must be at least 2 characters.');
  const emoji = [...String(req.body?.emoji || '🙂')].slice(0, 8).join('') || '🙂';
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(res, 400, 'That email doesn’t look right.');
  const id = newId();
  if (!(await store.hsetnx(K.names(g.gameId), name.toLowerCase(), id))) return err(res, 409, 'That name is already taken. Try another.');
  const token = crypto.randomBytes(16).toString('hex');
  await Promise.all([
    store.hset(K.players(g.gameId), id, JSON.stringify({ name, emoji, email, joinedAt: Date.now(), token })),
    store.hset(K.tok(g.gameId), token, id),
  ]);
  await Promise.all([K.players, K.names, K.tok, K.stats].map((k) => store.expire(k(g.gameId), TTL)));
  res.json({ token, gameId: g.gameId, id, name, emoji });
});

app.get('/api/me', player, async (req, res) => {
  const g = req.game, prog = req.prog;
  if (expireIfNeeded(g, prog)) await saveProgress(g, req.pid, prog);
  const board = await leaderboard(g);
  const me = board.find((r) => r.id === req.pid) || { rank: board.length };
  res.json({
    status: g.status, total: g.questions.length || QUESTION_COUNT, rank: me.rank, players: board.length, ...statsOf(prog),
    top: g.status === 'ended' ? board.slice(0, 5).map(({ id, rank, name, emoji, score, correct }) => ({ me: id === req.pid, rank, name, emoji, score, correct })) : undefined,
  });
});

app.post('/api/next', player, async (req, res) => {
  const g = req.game, prog = req.prog;
  if (g.status === 'lobby') return res.json({ state: 'waiting' });
  if (g.status === 'ended') return res.json({ state: 'ended' });
  let dirty = expireIfNeeded(g, prog);
  if (prog.finishedAt) { if (dirty) await saveProgress(g, req.pid, prog); return res.json({ state: 'finished' }); }
  const index = prog.answers.length;
  if (!prog.served || prog.served.index !== index) { prog.served = { index, startedAt: Date.now(), tries: 0, hints: 0 }; dirty = true; }
  if (dirty) await saveProgress(g, req.pid, prog);
  res.json(view(g, prog));
});

app.post('/api/hint', player, async (req, res) => {
  const g = req.game, prog = req.prog;
  if (g.status !== 'live') return err(res, 409, 'Game is not live');
  if (expireIfNeeded(g, prog)) { await saveProgress(g, req.pid, prog); return err(res, 409, 'Time is up'); }
  const s = prog.served;
  if (!s || s.index !== req.body?.index) return err(res, 409, 'Out of sync');
  const q = g.questions[s.index];
  if (s.hints < q.hints.length) { s.hints += 1; await saveProgress(g, req.pid, prog); }
  res.json(view(g, prog));
});

app.post('/api/answer', player, async (req, res) => {
  const g = req.game, prog = req.prog, now = Date.now();
  if (g.status !== 'live') return err(res, 409, 'Game is not live');
  const expired = expireIfNeeded(g, prog, now);
  const s = prog.served;
  if (!s || s.index !== req.body?.index) {
    if (expired) await saveProgress(g, req.pid, prog);
    const last = prog.answers[prog.answers.length - 1];
    if (last && prog.answers.length - 1 === req.body?.index) {
      const st = statsOf(prog);
      return res.json({ done: true, correct: last.correct, points: last.points, timedOut: last.timedOut, hintsUsed: last.hints, answer: g.questions[req.body.index].word, score: st.score, correctCount: st.correct, answered: st.answered, totalMs: st.totalMs, finished: st.finished });
    }
    return err(res, 409, 'Out of sync');
  }
  const q = g.questions[s.index];
  const guess = req.body?.guess;
  let result;
  if (guess === null || guess === undefined) result = finishQuestion(g, prog, false, now);
  else {
    s.tries += 1;
    const ok = [q.word, ...(q.accept || [])].some((w) => normalize(w) === normalize(guess));
    if (ok) result = finishQuestion(g, prog, true, now);
    else if (s.tries >= MAX_TRIES) result = finishQuestion(g, prog, false, now);
    else { await saveProgress(g, req.pid, prog); return res.json({ done: false, triesLeft: MAX_TRIES - s.tries }); }
  }
  await saveProgress(g, req.pid, prog);
  const st = statsOf(prog);
  res.json({ done: true, ...result, score: st.score, correctCount: st.correct, answered: st.answered, totalMs: st.totalMs, finished: st.finished });
});

// ----- host API -----
app.post('/api/host/login', host, (req, res) => res.json({ ok: true }));

const qrCache = new Map();
app.get('/api/host/overview', host, async (req, res) => {
  const g = await getGame();
  const words = await getWords();
  const url = joinUrl(req);
  if (!qrCache.has(url)) qrCache.set(url, await QRCode.toDataURL(url, { margin: 1, width: 420, color: { dark: '#1b1640', light: '#ffffff' } }));
  const board = await leaderboard(g);
  res.json({
    status: g.status, joinUrl: url, qr: qrCache.get(url),
    questionCount: g.status === 'lobby' ? Math.min(words.length, QUESTION_COUNT) : g.questions.length,
    availableQuestions: words.length, timeLimit: TIME_LIMIT_MS / 1000, maxTries: MAX_TRIES, scoring: SCORING,
    startedAt: g.startedAt, endedAt: g.endedAt,
    leaderboard: board.map(publicRow),
    winners: g.status === 'ended'
      ? board.slice(0, 3).map((w) => ({ rank: w.rank, name: w.name, emoji: w.emoji, score: w.score, email: w.email ? maskEmail(w.email) : '', sent: g.emailed?.[w.id] || null }))
      : [],
    mailConfigured: mail.configured(),
    storage: store.kind,
  });
});

app.post('/api/host/start', host, async (req, res) => {
  const g = await getGame();
  if (g.status !== 'lobby') return err(res, 409, 'Start a new game first.');
  const words = await getWords();
  if (!words.length) return err(res, 400, 'Add at least one word first.');
  g.questions = words.slice(0, QUESTION_COUNT);
  g.status = 'live';
  g.startedAt = Date.now();
  await setJ(K.game, g);
  res.json({ ok: true });
});

app.post('/api/host/end', host, async (req, res) => {
  const g = await getGame();
  if (g.status !== 'live') return err(res, 409, 'Game is not live.');
  // record timeouts for anyone stuck mid-question so the final board is accurate
  const ids = Object.keys(await store.hgetall(K.players(g.gameId)));
  const progs = await store.mget(ids.map((id) => K.prog(g.gameId, id)));
  const now = Date.now();
  await Promise.all(ids.map(async (id, i) => {
    const p = parse(progs[i]);
    if (p && expireIfNeeded(g, p, now)) await saveProgress(g, id, p);
  }));
  g.status = 'ended';
  g.endedAt = now;
  await setJ(K.game, g);
  res.json({ ok: true });
});

app.post('/api/host/reset', host, async (req, res) => {
  const old = await getGame();
  const ids = Object.keys(await store.hgetall(K.players(old.gameId)));
  await store.del(K.players(old.gameId), K.names(old.gameId), K.tok(old.gameId), K.stats(old.gameId), ...ids.map((id) => K.prog(old.gameId, id)));
  await setJ(K.game, freshGame());
  res.json({ ok: true });
});

app.delete('/api/host/players/:id', host, async (req, res) => {
  const g = await getGame();
  const p = parse(await store.hget(K.players(g.gameId), req.params.id));
  if (p) {
    await Promise.all([
      store.hdel(K.players(g.gameId), req.params.id), store.hdel(K.names(g.gameId), p.name.toLowerCase()),
      store.hdel(K.tok(g.gameId), p.token), store.hdel(K.stats(g.gameId), req.params.id), store.del(K.prog(g.gameId, req.params.id)),
    ]);
  }
  res.json({ ok: true });
});

app.post('/api/host/email-winners', host, async (req, res) => {
  if (!mail.configured()) return err(res, 501, 'Email is not set up yet. Add RESEND_API_KEY and MAIL_FROM, then redeploy.');
  const g = await getGame();
  if (g.status !== 'ended') return err(res, 409, 'End the game first.');
  const winners = (await leaderboard(g)).slice(0, 3).filter((w) => w.email && w.score > 0);
  g.emailed = g.emailed || {};
  const results = [];
  for (const w of winners) {
    if (g.emailed[w.id]) { results.push({ name: w.name, status: 'already sent' }); continue; }
    try {
      await mail.sendWinnerEmail(w, g.questions.length);
      g.emailed[w.id] = Date.now();
      results.push({ name: w.name, status: 'sent' });
    } catch (e) {
      console.error(e);
      results.push({ name: w.name, status: 'failed', error: e.message });
    }
  }
  await setJ(K.game, g);
  res.json({ results });
});

// ----- word admin API -----
async function notLive(req, res, next) {
  if ((await getGame()).status === 'live') return err(res, 409, 'Words are locked while a game is live.');
  next();
}
function parseWord(body) {
  const word = cleanWord(body.word);
  const L = letterIdx(word);
  if (L.length < 4) return { error: 'Word must have at least 4 letters.' };
  if (L.length > 24) return { error: 'Word is too long (max 24 letters).' };
  const hints = (Array.isArray(body.hints) ? body.hints : []).map((h) => String(h || '').trim().slice(0, 160)).filter(Boolean).slice(0, 3);
  if (!hints.length) return { error: 'Add at least one hint.' };
  const category = String(body.category || '').trim().slice(0, 30);
  const accept = (Array.isArray(body.accept) ? body.accept : String(body.accept || '').split(','))
    .map(cleanWord).filter((w) => w && normalize(w) !== normalize(word));
  let reveal = Array.isArray(body.reveal) ? [...new Set(body.reveal.map(Number))].filter((i) => L.includes(i)).sort((a, b) => a - b) : null;
  if (!reveal || !reveal.length) reveal = autoReveal(word);
  if (L.length - reveal.length < 2) return { error: 'Leave at least 2 letters hidden.' };
  return { word, category, hints, accept, reveal };
}
app.get('/api/admin/words', host, async (req, res) => res.json({ words: await getWords(), limit: QUESTION_COUNT, locked: (await getGame()).status === 'live' }));
app.post('/api/admin/words/auto-reveal', host, (req, res) => {
  const word = cleanWord(req.body?.word);
  if (letterIdx(word).length < 4) return err(res, 400, 'Word must have at least 4 letters.');
  res.json({ word, reveal: autoReveal(word) });
});
app.post('/api/admin/words', host, notLive, async (req, res) => {
  const w = parseWord(req.body || {});
  if (w.error) return err(res, 400, w.error);
  const words = await getWords();
  if (words.some((x) => normalize(x.word) === normalize(w.word))) return err(res, 409, 'That word is already in the list.');
  const item = { id: newId(), ...w };
  words.push(item);
  await setJ(K.words, words);
  res.json(item);
});
app.put('/api/admin/words/:id', host, notLive, async (req, res) => {
  const words = await getWords();
  const item = words.find((x) => x.id === req.params.id);
  if (!item) return err(res, 404, 'Not found');
  const w = parseWord(req.body || {});
  if (w.error) return err(res, 400, w.error);
  if (words.some((x) => x.id !== item.id && normalize(x.word) === normalize(w.word))) return err(res, 409, 'That word is already in the list.');
  Object.assign(item, w);
  await setJ(K.words, words);
  res.json(item);
});
app.delete('/api/admin/words/:id', host, notLive, async (req, res) => {
  await setJ(K.words, (await getWords()).filter((x) => x.id !== req.params.id));
  res.json({ ok: true });
});
app.post('/api/admin/words/move', host, notLive, async (req, res) => {
  const words = await getWords();
  const i = words.findIndex((x) => x.id === req.body?.id);
  const j = i + (req.body?.dir === 'up' ? -1 : 1);
  if (i >= 0 && j >= 0 && j < words.length) { [words[i], words[j]] = [words[j], words[i]]; await setJ(K.words, words); }
  res.json({ ok: true });
});
app.post('/api/admin/words/shuffle', host, notLive, async (req, res) => {
  const words = await getWords();
  for (let i = words.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [words[i], words[j]] = [words[j], words[i]]; }
  await setJ(K.words, words);
  res.json({ ok: true });
});
app.post('/api/admin/words/defaults', host, notLive, async (req, res) => { await setJ(K.words, buildDefaults()); res.json({ ok: true }); });
app.delete('/api/admin/words', host, notLive, async (req, res) => { await setJ(K.words, []); res.json({ ok: true }); });

app.use((e, req, res, next) => { console.error(e); res.status(500).json({ error: 'Server error' }); });

module.exports = app;

if (!IS_VERCEL && require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    const lan = process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}`;
    console.log('\n  Word Hunt is running' + (store.kind === 'redis' ? ' (Upstash Redis)' : ' (local file storage)'));
    console.log(`  Host screen : http://localhost:${PORT}/host`);
    console.log(`  Words       : http://localhost:${PORT}/admin`);
    console.log(`  Players join: ${lan}/`);
    console.log(`  Host PIN    : ${await hostPin()}${process.env.HOST_PIN ? ' (from HOST_PIN)' : ''}`);
    console.log(`  Winner email: ${mail.configured() ? 'on' : 'off (set RESEND_API_KEY + MAIL_FROM)'}\n`);
  });
}
