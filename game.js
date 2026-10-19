(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Tuning. Everything is in "world units": the game is laid out on a fixed
  // 360x640 board that gets scaled to fit the screen, so every device has the
  // same proportions and speeds. A bigger screen only makes things bigger.
  // ---------------------------------------------------------------------------
  const CONFIG = {
    world: { w: 360, h: 640 },

    startTime: 30,          // seconds on the clock at the start
    missPenalty: 5,         // seconds lost on a miss
    timeBonusPerMult: 0.5,  // seconds gained per landing = multiplier * this (from x2 up)
    comboWindow: 1.0,       // seconds you have to START pressing after a new square appears to keep the chain

    points: { land: 10, perfect: 50 },
    perfectLeeway: 7,       // square within this many units under the top gap = perfect

    square: {
      y: 640 / 3,           // center of the square, 1/3 from the top
      startSize: 16,
      maxSize: 330,         // pulses back down after reaching this
      growSpeed: 150,       // units per second at x1
      growBoostPerMult: 0.08, // +8% growth speed per multiplier step
    },

    platforms: {
      topY: 430,
      bottomY: 520,
      thickness: 16,
      minTopGap: 70,
      maxTopGap: 290,
      minBottomGap: 28,
      startDiff: 80,        // top gap minus bottom gap at the start (the "safe" window)
      endDiff: 18,          // ...and at full difficulty
      rampLandings: 40,     // landings needed to reach full difficulty
      minChange: 35,        // new top gap differs from the previous one by at least this
      animTime: 0.28,
    },

    gravity: 3000,
    resultPause: 0.45,
    paletteSeconds: 18,     // seconds per color scheme before blending into the next
  };

  const PALETTES = [
    { bg: '#f3ede2', bg2: '#e6d9c3', square: '#2b2d42', platform: '#c79f7c', accent: '#e07a5f', fg: '#2b2d42' },
    { bg: '#e7efe5', bg2: '#d1e0cd', square: '#264653', platform: '#86a993', accent: '#e76f51', fg: '#264653' },
    { bg: '#e3eef2', bg2: '#cadde6', square: '#1d3557', platform: '#7ca3b5', accent: '#e63946', fg: '#1d3557' },
    { bg: '#ece6f3', bg2: '#d9cdea', square: '#3d348b', platform: '#a497c8', accent: '#f18701', fg: '#3d348b' },
    { bg: '#fbe9e1', bg2: '#f2d2c3', square: '#5c3c4f', platform: '#d49c8b', accent: '#2a9d8f', fg: '#5c3c4f' },
  ].map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, hexToRgb(v)])));

  const W = CONFIG.world.w;
  const H = CONFIG.world.h;
  const SQ = CONFIG.square;
  const PL = CONFIG.platforms;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const ui = {
    menu: document.getElementById('menu'),
    over: document.getElementById('over'),
    play: document.getElementById('play'),
    again: document.getElementById('again'),
    menuBest: document.getElementById('menu-best'),
    overScore: document.getElementById('over-score'),
    overBest: document.getElementById('over-best'),
    overNewBest: document.getElementById('over-newbest'),
    overStats: document.getElementById('over-stats'),
  };

  // --- helpers ---------------------------------------------------------------

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const smooth = t => t * t * (3 - 2 * t);
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const fmtSec = s => (Number.isInteger(s) ? String(s) : s.toFixed(1));

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
    },
  };

  // --- layout ----------------------------------------------------------------

  let dpr = 1, cw = 0, ch = 0, scale = 1, offX = 0, offY = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cw = window.innerWidth;
    ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    scale = Math.min(cw / W, ch / H);
    offX = (cw - W * scale) / 2;
    offY = (ch - H * scale) / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // Film-grain texture, generated once.
  const grain = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 16;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  })();

  // --- game state ------------------------------------------------------------

  let state = 'menu'; // menu | ready | growing | falling | result | over
  let clock = 0;      // seconds since page load, drives colors and animations
  let best = storage.get('squared.best', 0);

  let time, score, combo, landings, misses, perfects, maxCombo;
  let roundReadyAt = 0, resultT = 0, lastOutcome = null, overlayLockUntil = 0;
  let sq = null;
  let plat = { top: 200, bottom: 120, fromTop: 200, fromBottom: 120, topTarget: 200, bottomTarget: 120, anim: 1 };
  let popups = [];
  let flash = 0, shake = 0;
  let colors = PALETTES[0];

  function difficulty() {
    return clamp(landings / PL.rampLandings, 0, 1);
  }

  function rollPlatforms() {
    const diff = lerp(PL.startDiff, PL.endDiff, difficulty());
    const lo = Math.max(PL.minTopGap, PL.minBottomGap + diff);
    let top, tries = 0;
    do {
      top = rand(lo, PL.maxTopGap);
    } while (Math.abs(top - plat.topTarget) < PL.minChange && ++tries < 30);
    plat.fromTop = plat.top;
    plat.fromBottom = plat.bottom;
    plat.topTarget = top;
    plat.bottomTarget = top - diff;
    plat.anim = 0;
  }

  function newSquare() {
    sq = { size: SQ.startSize, y: SQ.y, vy: 0, dir: 1, alpha: 1, appear: 0, squash: 0 };
    state = 'ready';
    roundReadyAt = clock;
  }

  function startGame() {
    if (clock < overlayLockUntil) return;
    time = CONFIG.startTime;
    score = 0;
    combo = 0;
    landings = 0;
    misses = 0;
    perfects = 0;
    maxCombo = 0;
    popups = [];
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    ui.menu.classList.add('hidden');
    ui.over.classList.add('hidden');
    rollPlatforms();
    newSquare();
  }

  function gameOver() {
    state = 'over';
    const isBest = score > best;
    if (isBest) {
      best = score;
      storage.set('squared.best', best);
    }
    ui.overScore.textContent = score;
    ui.overBest.textContent = best;
    ui.menuBest.textContent = best;
    ui.overNewBest.classList.toggle('hidden', !isBest || score === 0);
    ui.overStats.textContent =
      `${landings} squares · ${perfects} perfect · best chain x${Math.max(1, maxCombo)}`;
    overlayLockUntil = clock + 0.7; // avoid restarting by accident
    setTimeout(() => ui.over.classList.remove('hidden'), 450);
  }

  function multiplier() {
    return Math.max(1, combo);
  }

  function popup(text, x, y, color, size = 22) {
    popups.push({ text, x, y, color, size, t: 0, life: 1 });
  }

  function resolve(kind) {
    state = 'result';
    resultT = CONFIG.resultPause;
    lastOutcome = kind;

    if (kind === 'land') {
      sq.squash = 1;
      landings++;
      combo++; // combo is still > 0 only if this square was pressed within the window
      maxCombo = Math.max(maxCombo, combo);
      const mult = combo;
      const perfect = plat.topTarget - sq.size <= CONFIG.perfectLeeway;
      const pts = (perfect ? CONFIG.points.perfect : CONFIG.points.land) * mult;
      score += pts;
      const y = sq.y - sq.size / 2 - 18;
      if (perfect) {
        perfects++;
        flash = 1;
        popup('PERFECT', W / 2, y - 26, 'accent', 26);
      }
      popup(`+${pts}`, W / 2, y, 'fg', 24);
      if (mult >= 2) {
        const bonus = mult * CONFIG.timeBonusPerMult;
        time += bonus;
        popup(`+${fmtSec(bonus)}s`, W - 40, 44, 'accent', 18);
      }
    } else {
      misses++;
      combo = 0;
      time -= CONFIG.missPenalty;
      shake = 1;
      if (kind === 'big') sq.squash = 0.5;
      popup(`-${CONFIG.missPenalty}s`, W / 2, SQ.y - 40, 'accent', 26);
    }
  }

  // --- input -----------------------------------------------------------------

  function press() {
    if (state !== 'ready') return;
    state = 'growing';
  }

  function release() {
    if (state !== 'growing') return;
    state = 'falling';
    sq.vy = 0;
  }

  canvas.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  window.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (e.repeat) return;
    if (state === 'menu' || state === 'over') startGame();
    else press();
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') release();
  });

  ui.play.addEventListener('click', startGame);
  ui.again.addEventListener('click', startGame);
  // Buttons should not swallow the space key as a click after the game starts.
  [ui.play, ui.again].forEach(b => b.addEventListener('keydown', e => { if (e.code === 'Space') e.preventDefault(); }));

  // --- update ----------------------------------------------------------------

  function updateColors() {
    const t = clock / CONFIG.paletteSeconds;
    const i = Math.floor(t) % PALETTES.length;
    const j = (i + 1) % PALETTES.length;
    // Hold each palette for a while, then blend smoothly into the next.
    const f = smooth(clamp(((t % 1) - 0.5) / 0.5, 0, 1));
    const a = PALETTES[i], b = PALETTES[j];
    colors = {};
    for (const k in a) colors[k] = mixRgb(a[k], b[k], f);
  }

  let cssTick = 0;
  function syncCss() {
    if (++cssTick % 15 !== 0) return;
    root.style.setProperty('--bg', rgb(colors.bg));
    root.style.setProperty('--fg', rgb(colors.fg));
    root.style.setProperty('--accent', rgb(colors.accent));
    themeMeta.setAttribute('content', rgb(colors.bg));
  }

  function update(dt) {
    clock += dt;
    updateColors();
    syncCss();

    if (plat.anim < 1) plat.anim = Math.min(1, plat.anim + dt / PL.animTime);
    const e = easeOut(plat.anim);
    plat.top = lerp(plat.fromTop, plat.topTarget, e);
    plat.bottom = lerp(plat.fromBottom, plat.bottomTarget, e);

    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < p.life);
    flash = Math.max(0, flash - dt * 2.5);
    shake = Math.max(0, shake - dt * 4);

    if (state === 'menu' || state === 'over') return;

    time -= dt;
    if (time <= 0) {
      time = 0;
      gameOver();
      return;
    }

    sq.appear = Math.min(1, sq.appear + dt * 6);
    sq.squash *= Math.exp(-dt * 10);

    switch (state) {
      case 'ready':
        if (combo > 0 && clock - roundReadyAt > CONFIG.comboWindow) combo = 0;
        break;

      case 'growing': {
        const speed = SQ.growSpeed * (1 + SQ.growBoostPerMult * (multiplier() - 1));
        sq.size += sq.dir * speed * dt;
        if (sq.size >= SQ.maxSize) {
          sq.size = SQ.maxSize - (sq.size - SQ.maxSize);
          sq.dir = -1;
        } else if (sq.size <= SQ.startSize) {
          sq.size = SQ.startSize + (SQ.startSize - sq.size);
          sq.dir = 1;
        }
        break;
      }

      case 'falling': {
        sq.vy += CONFIG.gravity * dt;
        sq.y += sq.vy * dt;
        const half = sq.size / 2;
        const bottom = sq.y + half;
        if (sq.size > plat.topTarget) {
          if (bottom >= PL.topY) { sq.y = PL.topY - half; resolve('big'); }
        } else if (sq.size > plat.bottomTarget) {
          if (bottom >= PL.bottomY) { sq.y = PL.bottomY - half; resolve('land'); }
        } else if (sq.y - half > H + 20) {
          resolve('small');
        }
        break;
      }

      case 'result':
        resultT -= dt;
        if (resultT < CONFIG.resultPause * 0.5) sq.alpha = Math.max(0, resultT / (CONFIG.resultPause * 0.5));
        if (resultT <= 0) {
          if (lastOutcome === 'land') rollPlatforms();
          newSquare();
        }
        break;
    }
  }

  // --- render ----------------------------------------------------------------

  function drawBackground() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, rgb(colors.bg));
    g.addColorStop(1, rgb(colors.bg2));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    // Two soft drifting blobs for depth.
    const blobs = [
      { x: 0.25 + 0.1 * Math.sin(clock * 0.13), y: 0.2 + 0.08 * Math.cos(clock * 0.11), r: 0.6, c: colors.accent, a: 0.10 },
      { x: 0.8 + 0.1 * Math.cos(clock * 0.09), y: 0.75 + 0.08 * Math.sin(clock * 0.12), r: 0.7, c: colors.platform, a: 0.16 },
    ];
    const big = Math.max(cw, ch);
    for (const b of blobs) {
      const rg = ctx.createRadialGradient(b.x * cw, b.y * ch, 0, b.x * cw, b.y * ch, b.r * big);
      rg.addColorStop(0, rgb(b.c, b.a));
      rg.addColorStop(1, rgb(b.c, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  function drawGrain() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, cw, ch);
  }

  function toWorld() {
    const sx = shake ? (Math.random() - 0.5) * 8 * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * 8 * shake : 0;
    const s = dpr * scale;
    ctx.setTransform(s, 0, 0, s, dpr * offX + sx * s, dpr * offY + sy * s);
  }

  function drawPlatform(y, gap) {
    // Platforms run to the screen edges; only the centered gap matters for play.
    const left = -offX / scale - 10;
    const right = W + offX / scale + 10;
    const cx = W / 2;
    const t = PL.thickness;
    ctx.fillStyle = rgb(colors.platform);
    roundRect(left, y, cx - gap / 2 - left, t, 5);
    ctx.fill();
    roundRect(cx + gap / 2, y, right - (cx + gap / 2), t, 5);
    ctx.fill();
    // subtle top highlight
    ctx.fillStyle = rgb([255, 255, 255], 0.18);
    ctx.fillRect(left, y, cx - gap / 2 - left - 5, 2);
    ctx.fillRect(cx + gap / 2 + 5, y, right - (cx + gap / 2), 2);
  }

  function drawSquare() {
    if (!sq || state === 'menu') return;
    const s = sq.size * easeOut(sq.appear);
    const sx = 1 + 0.14 * sq.squash;
    const sy = 1 - 0.2 * sq.squash;
    const w = s * sx;
    const h = s * sy;
    const bottom = sq.y + s / 2;
    ctx.save();
    ctx.globalAlpha = sq.alpha;
    ctx.shadowColor = rgb(colors.square, 0.25);
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = rgb(colors.square);
    roundRect(W / 2 - w / 2, bottom - h, w, h, Math.min(4, s * 0.15));
    ctx.fill();
    ctx.restore();
  }

  function drawHud() {
    // Timer bar across the top of the screen.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const barH = Math.max(6, 8 * scale);
    const frac = clamp(time / CONFIG.startTime, 0, 1);
    const low = time < 5;
    const pulse = low ? 0.55 + 0.45 * Math.abs(Math.sin(clock * 6)) : 1;
    ctx.fillStyle = rgb(colors.fg, 0.08);
    ctx.fillRect(0, 0, cw, barH);
    ctx.fillStyle = rgb(low ? colors.accent : colors.fg, 0.85 * pulse);
    ctx.fillRect(0, 0, cw * frac, barH);
    if (time > CONFIG.startTime) {
      // Banked overtime shows as a second band on top.
      const over = clamp((time - CONFIG.startTime) / CONFIG.startTime, 0, 1);
      ctx.fillStyle = rgb(colors.accent, 0.9);
      ctx.fillRect(0, 0, cw * over, barH * 0.45);
    }

    toWorld();
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 30px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    ctx.fillStyle = rgb(colors.fg);
    ctx.textAlign = 'left';
    ctx.fillText(score, 18, 52);

    if (combo >= 2) {
      ctx.textAlign = 'right';
      ctx.font = '800 26px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.fillStyle = rgb(colors.accent);
      ctx.fillText(`x${combo}`, W - 18, 50);
    }

    // Chain window: drains while waiting for the next press.
    if (state === 'ready' && combo >= 1) {
      const left = clamp(1 - (clock - roundReadyAt) / CONFIG.comboWindow, 0, 1);
      ctx.fillStyle = rgb(colors.accent, 0.25);
      roundRect(W - 78, 60, 60, 4, 2);
      ctx.fill();
      ctx.fillStyle = rgb(colors.accent);
      roundRect(W - 78, 60, 60 * left, 4, 2);
      ctx.fill();
    }

    if (state === 'ready' && landings === 0 && misses === 0) {
      ctx.textAlign = 'center';
      ctx.font = '600 15px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
      ctx.fillStyle = rgb(colors.fg, 0.55 + 0.25 * Math.sin(clock * 4));
      ctx.fillText('hold to grow · release to drop', W / 2, SQ.y + 60);
    }

    for (const p of popups) {
      const k = p.t / p.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.textAlign = 'center';
      ctx.font = `800 ${p.size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.fillStyle = rgb(colors[p.color]);
      ctx.fillText(p.text, p.x, p.y - 30 * easeOut(k));
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    drawBackground();
    toWorld();
    drawPlatform(PL.topY, plat.top);
    drawPlatform(PL.bottomY, plat.bottom);
    drawSquare();
    if (flash > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = rgb(colors.accent, 0.18 * flash);
      ctx.fillRect(0, 0, cw, ch);
    }
    if (state !== 'menu') drawHud();
    drawGrain();
  }

  // --- loop ------------------------------------------------------------------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); // clamp so tab switches don't jump
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  ui.menuBest.textContent = best;
  rollPlatforms();
  requestAnimationFrame(frame);
})();
