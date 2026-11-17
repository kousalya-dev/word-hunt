// Helpers shared by the player, host and admin pages.
window.WH = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function logoTiles(text, blanks = []) {
    let i = 0;
    return `<span class="logo-tiles">${[...text].map((c) => {
      if (c === ' ') return '<span class="gap"></span>';
      const k = i++;
      return `<span class="lt ${blanks.includes(k) ? 'blank' : ''}" style="animation-delay:${k * 60}ms">${c}</span>`;
    }).join('')}</span>`;
  }

  function scoreChart(s) {
    const max = s.base + s.speed;
    const rows = [0, 1, 2, 3].slice(0, s.maxHints + 1).map((h) => ({
      label: h === 0 ? 'No hints' : `${h} hint${h > 1 ? 's' : ''}`,
      val: max - h * s.hintPenalty,
      color: ['var(--teal)', 'var(--blue)', 'var(--purple)', 'var(--pink)'][h],
    }));
    rows.push({ label: 'Wrong / skip', val: 0, color: 'var(--bad)' });
    return `<div class="chart">${rows.map((r) => `
      <div class="row"><span class="label">${r.label}</span>
        <span class="bar"><i style="width:${(100 * r.val / max).toFixed(0)}%;background:${r.color}"></i></span>
        <span class="val">${r.val ? 'up to ' : ''}${r.val}</span></div>`).join('')}
      <div class="formula"><b>${s.base}</b> for a correct word + up to <b>${s.speed}</b> speed bonus − <b>${s.hintPenalty}</b> per hint used.<br>Ties are broken by total time.</div>
    </div>`;
  }

  function toast(msg, ok) {
    const t = document.createElement('div');
    t.className = 'toast' + (ok ? ' ok' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function confetti(n = 140) {
    const colors = ['#ffd23f', '#ff4f8b', '#2ee6c5', '#5b8cff', '#ff8a3d', '#a77bff'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      c.style.animationDelay = Math.random() * 1.2 + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 6500);
    }
  }

  function ask(title, text, yes = 'Yes') {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><div class="muted">${esc(text)}</div>
        <div class="row"><button class="btn ghost small" data-v="0">Cancel</button><button class="btn pink small" data-v="1">${esc(yes)}</button></div></div>`;
      back.addEventListener('click', (e) => {
        const v = e.target.dataset.v;
        if (v === undefined && e.target !== back) return;
        back.remove();
        resolve(v === '1');
      });
      document.body.appendChild(back);
    });
  }

  const secs = (ms) => (ms / 1000).toFixed(1) + 's';

  return { esc, logoTiles, scoreChart, toast, confetti, ask, secs };
})();
