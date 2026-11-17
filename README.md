# Word Hunt 🔤 (v2)

A phone-based team word game. Players open the link, pick an emoji avatar, enter their name (and optionally an email), and race to fill in the missing letters of each word:

```
N _ _ _ _ _ A T _ _ _      (Business · 11 letters)
💡 Reveal hint 1 of 3  (−25 pts)
```

| Page | Who | Path |
|---|---|---|
| Welcome + game | everyone, on their phone | `/` (QR code on the host screen) |
| Host screen | you, on the shared screen | `/host` |
| Word editor | you | `/admin` |

**Features**
- Welcome page explaining how to play, with the scoring chart and an avatar picker.
- Live lobby on the big screen.
- **3 hints per word**, revealed one at a time. Each costs 25 points.
- 3 tries per word and a 45-second timer.
- On-screen keyboard (no autocorrect).
- Live leaderboard with the scoring chart, then a podium and confetti.
- **Top-3 winner emails** (via Resend, once you add a key).
- Tested with **100 simultaneous players**.

---

## Scoring

| Hints used | Max points for a correct word |
|---|---|
| None | **200** |
| 1 | 175 |
| 2 | 150 |
| 3 | 125 |
| Wrong 3×, skipped, or time-out | 0 |

- **Formula:** `100 for correct + up to 100 speed bonus − 25 × hints used`.
- **Speed bonus:** shrinks as the timer runs down.
- **Ranking:** total score first, then total time as the tiebreaker.

---

## Deploy to Vercel (about 10 minutes)

On Vercel each request can run on a different server instance, so game data is stored in **Upstash Redis** (free tier, added from Vercel's Marketplace). Without it, the app shows a "Database not connected" message.

1. **Push this folder to GitHub.**
   ```bash
   git init && git add . && git commit -m "Word Hunt"
   ```
   Create a GitHub repo and push.

2. **Import it on Vercel:** go to vercel.com/new and select the repo. Vercel detects **Express** automatically, so don't change any build settings. Click **Deploy**.

3. **Add the database:**
   1. In the project, open **Storage** → **Create Database** → **Upstash for Redis**.
   2. Choose the free plan and a region near you (e.g. Mumbai).
   3. **Connect** it to the project. This adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars automatically.

4. **Set your host PIN:** go to **Settings → Environment Variables** and add `HOST_PIN` = a number only you know, e.g. `482916`.

5. **Redeploy:** go to **Deployments**, click ⋯ on the latest one and choose **Redeploy**. Env changes only apply after a redeploy.

6. **Play:**
   1. Open `https://your-project.vercel.app/host` on the shared screen and enter the PIN.
   2. Open `/admin` to review the words.
   3. Players scan the QR code on the host screen.

Optional env vars: `TIME_LIMIT` (seconds, default 45), `QUESTION_COUNT` (default 25), `MAX_TRIES` (default 3), `GAME_NAME` (used in emails), `PUBLIC_URL` (if you add a custom domain).

## Turn on winner emails (later)

The game already collects optional emails and shows the top 3 on the final screen with an **📧 Email the winners** button. To activate it:

1. Create an account at **resend.com** and create an **API key**.
2. **Verify a sending domain** in Resend (it walks you through the DNS records). Resend's test sender only delivers to your own Resend account email, so a verified domain is needed to email colleagues.
3. In Vercel, add the env vars:
   - `RESEND_API_KEY` = `re_…`
   - `MAIL_FROM` = `Word Hunt <game@yourdomain.com>`
4. Redeploy.

**How sending works**
- After **End game**, click **📧 Email the winners**. Each top-3 player who gave an email and scored above 0 gets a congratulations email with their rank, points, words solved and time.
- Each winner is emailed once. The button shows ✓ per winner.
- **Privacy:** emails are never shown to other players, the host sees them masked (`ko•••@gmail.com`), and all game data, emails included, auto-deletes from Redis after 7 days.

---

## Run locally (no Redis needed)

```bash
npm install
npm start
```

- Open `http://localhost:3000/host`. The console prints the PIN, or set your own with `HOST_PIN=1234 npm start`.
- Phones on the same Wi-Fi join through the printed LAN link.
- **Storage:** locally, data is saved to `data/store.json`.
- **Test with your real Upstash database:** set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_*` pair) before `npm start`.

## Editing words

In `/admin` you can:
- add, edit, delete, reorder or shuffle words;
- tap letters to choose which ones are shown;
- write up to 3 hints, from vague to helpful;
- set a category and alternative spellings.

Only the first 25 words are played. **Restore default words** brings back the 25 built-in words: business, finance, geography, science, history, language and technology, all medium difficulty.

## Project structure

```
server.js          Express app: game API, scoring, timers (exported for Vercel, listens locally)
lib/store.js       storage: Upstash Redis (Vercel) or local JSON file
lib/words.js       25 default words with 3 hints each + letter-reveal logic
lib/mail.js        winner email via Resend
public/index.html  welcome page + phone game
public/host.html   host / big-screen view
public/admin.html  word editor
public/shared.js   shared UI helpers (score chart, confetti, dialogs)
public/style.css   theme
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "Database not connected" | Connect Upstash Redis under Storage, then redeploy |
| "HOST_PIN is not set" | Add `HOST_PIN` in Environment Variables, then redeploy |
| Email button says "not set up" | Add `RESEND_API_KEY` + `MAIL_FROM`, then redeploy |
| Email "failed" | The sending domain isn't verified in Resend yet, or `MAIL_FROM` doesn't use that domain |
| A phone looks stuck | Refresh. It resumes the same word with the time already used |
