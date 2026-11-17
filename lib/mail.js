// Winner emails via Resend (https://resend.com). Active only when RESEND_API_KEY and MAIL_FROM are set.
const configured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const PLACE = { 1: '1st', 2: '2nd', 3: '3rd' };

function template(w, total, gameName) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f2ff;font-family:Arial,Helvetica,sans-serif;color:#1b1640">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
  <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden">
    <tr><td style="background:#1c1a3d;padding:28px;text-align:center">
      <div style="font-size:30px;font-weight:900;color:#ffd23f;letter-spacing:2px">${esc(gameName)}</div>
    </td></tr>
    <tr><td style="padding:32px 32px 8px;text-align:center">
      <div style="font-size:64px;line-height:1">${MEDAL[w.rank]}</div>
      <h1 style="margin:14px 0 6px;font-size:26px">Congratulations, ${esc(w.name)}!</h1>
      <p style="margin:0;font-size:17px;color:#4b4870">You finished <b>${PLACE[w.rank]}</b> in today’s ${esc(gameName)}.</p>
    </td></tr>
    <tr><td style="padding:22px 32px">
      <table width="100%" cellpadding="0" cellspacing="0" style="text-align:center"><tr>
        <td style="background:#f4f2ff;border-radius:12px;padding:14px"><div style="font-size:24px;font-weight:900">${w.score}</div><div style="font-size:12px;color:#6b6890">points</div></td>
        <td width="10"></td>
        <td style="background:#f4f2ff;border-radius:12px;padding:14px"><div style="font-size:24px;font-weight:900">${w.correct}/${total}</div><div style="font-size:12px;color:#6b6890">words solved</div></td>
        <td width="10"></td>
        <td style="background:#f4f2ff;border-radius:12px;padding:14px"><div style="font-size:24px;font-weight:900">${(w.totalMs / 1000).toFixed(1)}s</div><div style="font-size:12px;color:#6b6890">total time</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:4px 32px 32px;text-align:center;color:#6b6890;font-size:14px">Well played, and thanks for joining the game!</td></tr>
  </table></td></tr></table></body></html>`;
}

async function sendWinnerEmail(w, total) {
  const gameName = process.env.GAME_NAME || 'Word Hunt';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [w.email],
      subject: `${MEDAL[w.rank]} You placed ${PLACE[w.rank]} in ${gameName}!`,
      html: template(w, total, gameName),
      text: `Congratulations ${w.name}! You finished ${PLACE[w.rank]} in ${gameName} with ${w.score} points (${w.correct}/${total} words, ${(w.totalMs / 1000).toFixed(1)}s).`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

module.exports = { configured, sendWinnerEmail };
