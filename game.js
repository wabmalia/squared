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
    comboWindow: 1.0,       // seconds after a landing to START pressing the next square and keep the chain

    points: { land: 10, perfect: 50 },
    perfectWindow: 0.035,   // seconds (at x1) the square spends in the "perfect" band just under the top gap

    square: {
      y: 640 / 3,           // center of the square, 1/3 from the top
      startSize: 16,
      maxSize: 330,         // pulses back down after reaching this
      // Growth speed (units/s) = growBase + growRate * size, so the square
      // speeds up as it gets bigger (~170 u/s at the start, ~470 u/s at a 290
      // gap). Takes ~0.28s to reach a 70 gap and ~0.94s to reach a 290 gap.
      growBase: 150,
      growRate: 1.1,
      growBoostPerMult: 0.05, // +5% growth rate per multiplier step
    },

    platforms: {
      topY: 430,
      bottomY: 520,
      minTopGap: 70,
      maxTopGap: 290,
      minBottomGap: 28,
      // Seconds (at x1) the square spends between the bottom and top gap sizes,
      // i.e. how much reaction time a round gives. Because growth is
      // proportional, this is the same for big and small gaps.
      startWindow: 0.35,
      endWindow: 0.08,      // ...at full difficulty
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
  // With speed = growBase + growRate * size, (size + GROW_OFFSET) grows
  // exponentially at growRate, which makes timing math simple.
  const GROW_OFFSET = SQ.growBase / SQ.growRate;
  // Size that is `seconds` of growth (at x1) smaller than `size`.
  const sizeBefore = (size, seconds) => (size + GROW_OFFSET) * Math.exp(-seconds * SQ.growRate) - GROW_OFFSET;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  const TOUCH = window.matchMedia && window.matchMedia('(hover: none)').matches;

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

  let time = 0, score = 0, combo = 0, landings = 0, misses = 0, perfects = 0, maxCombo = 0;
  let landedAt = 0, resultT = 0, lastOutcome = null;
  let armed = true, armAt = 0, newBest = false; // armed: a press now starts a game (menu/over)
  let sq = null;
  let plat = { top: 200, bottom: 120, fromTop: 200, fromBottom: 120, topTarget: 200, bottomTarget: 120, anim: 1 };
  let popups = [];
  let flash = 0, shake = 0;
  let colors = PALETTES[0];

  function difficulty() {
    return clamp(landings / PL.rampLandings, 0, 1);
  }

  function rollPlatforms(level = difficulty()) {
    const window = lerp(PL.startWindow, PL.endWindow, level);
    // smallest top gap whose bottom gap still respects minBottomGap
    const lo = Math.max(PL.minTopGap, sizeBefore(PL.minBottomGap, -window));
    let top, tries = 0;
    do {
      top = rand(lo, PL.maxTopGap);
    } while (Math.abs(top - plat.topTarget) < PL.minChange && ++tries < 30);
    plat.fromTop = plat.top;
    plat.fromBottom = plat.bottom;
    plat.topTarget = top;
    plat.bottomTarget = sizeBefore(top, window);
    plat.anim = 0;
  }

  function makeSquare() {
    return { size: SQ.startSize, y: SQ.y, vy: 0, dir: 1, alpha: 1, appear: 0, squash: 0 };
  }

  function newSquare() {
    sq = makeSquare();
    state = 'ready';
  }

  // The game starts on the same screen: the square and platforms are already
  // there, so the press that starts the game also starts growing the square.
  function startGame() {
    time = CONFIG.startTime;
    score = 0;
    combo = 0;
    landings = 0;
    misses = 0;
    perfects = 0;
    maxCombo = 0;
    popups = [];
    newBest = false;
    state = 'ready';
  }

  function gameOver() {
    state = 'over';
    newBest = score > best;
    if (newBest) {
      best = score;
      storage.set('squared.best', best);
    }
    armed = false;
    armAt = clock + 0.8; // a beat before a new game can start, so a late press doesn't restart by accident
    rollPlatforms(0);
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
      landedAt = clock;
      landings++;
      combo++; // combo is still > 0 only if this square was pressed within the window
      maxCombo = Math.max(maxCombo, combo);
      const mult = combo;
      const perfect = sq.size >= sizeBefore(plat.topTarget, CONFIG.perfectWindow);
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
        popup(`+${fmtSec(bonus)}s`, W / 2, 140, 'accent', 18);
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
    if (state === 'menu' || state === 'over') {
      if (!armed) return;
      startGame();
    }
    // Pressing during the pause after a drop skips straight to the next round,
    // so fast players aren't held back. Presses mid-fall are ignored.
    if (state === 'result') nextRound();
    if (state !== 'ready') return;
    state = 'growing';
  }

  function nextRound() {
    if (lastOutcome === 'land') rollPlatforms();
    newSquare();
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
    press();
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') release();
  });

  // --- update ----------------------------------------------------------------

  function updateColors() {
    const t = clock / CONFIG.paletteSeconds;
    const i = ((Math.floor(t) % PALETTES.length) + PALETTES.length) % PALETTES.length;
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

    if (sq) {
      sq.appear = Math.min(1, sq.appear + dt * 6);
      sq.squash *= Math.exp(-dt * 10);
    }

    if (state === 'over' && !armed) {
      sq.alpha = Math.max(0, sq.alpha - dt * 4);
      if (clock >= armAt) {
        armed = true;
        sq = makeSquare();
      }
    }
    if (state === 'menu' || state === 'over') return;

    time -= dt;
    if (time <= 0) {
      time = 0;
      gameOver();
      return;
    }

    // The chain breaks if the next press doesn't start within the window
    // after a landing (the pause after the landing counts).
    if ((state === 'ready' || state === 'result') && combo > 0 && clock - landedAt > CONFIG.comboWindow) combo = 0;

    switch (state) {

      case 'growing': {
        const rate = SQ.growRate * (1 + SQ.growBoostPerMult * (multiplier() - 1));
        // Grow in "offset" space, where growth is exponential, and bounce off
        // the limits there so the pulse runs at the same speed both ways.
        let u = (sq.size + GROW_OFFSET) * Math.exp(sq.dir * rate * dt);
        const uMax = SQ.maxSize + GROW_OFFSET;
        const uMin = SQ.startSize + GROW_OFFSET;
        if (u >= uMax) { u = uMax * uMax / u; sq.dir = -1; }
        else if (u <= uMin) { u = uMin * uMin / u; sq.dir = 1; }
        sq.size = u - GROW_OFFSET;
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
        if (resultT <= 0) nextRound();
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

  // One stepped shape per side: the outer wall at topY (the "top platform") and
  // a ledge at bottomY inside the wide gap (the "bottom platform"), leaving the
  // narrow hole as a shaft. It runs to the screen edges and the bottom of the
  // screen; only the centered gaps matter for play.
  function drawSide(edge, wall, ledge, floor, r) {
    const d = Math.sign(edge - wall); // +1 on the right side, -1 on the left
    ctx.beginPath();
    ctx.moveTo(edge, floor);
    ctx.lineTo(edge, PL.topY);
    ctx.lineTo(wall + d * r, PL.topY);
    ctx.arcTo(wall, PL.topY, wall, PL.topY + r, r);
    ctx.lineTo(wall, PL.bottomY);
    ctx.lineTo(ledge + d * r, PL.bottomY);
    ctx.arcTo(ledge, PL.bottomY, ledge, PL.bottomY + r, r);
    ctx.lineTo(ledge, floor);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlatforms() {
    const left = -offX / scale - 10;
    const right = W + offX / scale + 10;
    const floor = (ch - offY) / scale + 10;
    const cx = W / 2;
    const top = plat.top / 2;
    const bottom = Math.min(plat.bottom, plat.top) / 2;
    const r = Math.min(6, (top - bottom) / 2);

    ctx.fillStyle = rgb(colors.platform);
    drawSide(left, cx - top, cx - bottom, floor, r);
    drawSide(right, cx + top, cx + bottom, floor, r);

    // light catching the top edges
    ctx.fillStyle = rgb([255, 255, 255], 0.2);
    ctx.fillRect(left, PL.topY, cx - top - left - r, 2);
    ctx.fillRect(cx + top + r, PL.topY, right - cx - top - r, 2);
    if (top - bottom > 2 * r) {
      ctx.fillRect(cx - top, PL.bottomY, top - bottom - r, 2);
      ctx.fillRect(cx + bottom + r, PL.bottomY, top - bottom - r, 2);
    }
  }

  function drawSquare() {
    if (!sq) return;
    const s = sq.size; // always the real size, so growth on screen is exactly the speed curve
    const sx = 1 + 0.14 * sq.squash;
    const sy = 1 - 0.2 * sq.squash;
    const w = s * sx;
    const h = s * sy;
    const bottom = sq.y + s / 2;
    ctx.save();
    ctx.globalAlpha = sq.alpha * easeOut(sq.appear); // new squares fade in
    ctx.shadowColor = rgb(colors.square, 0.25);
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = rgb(colors.square);
    roundRect(W / 2 - w / 2, bottom - h, w, h, Math.min(4, s * 0.15));
    ctx.fill();
    ctx.restore();
  }

  function text(str, x, y, size, color, alpha = 1, weight = 800) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = rgb(color, alpha);
    ctx.fillText(str, x, y);
  }

  function drawHud() {
    // Timer bar across the top of the screen. Full before the first game.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const shown = state === 'menu' ? CONFIG.startTime : time;
    const barH = Math.max(6, 8 * scale);
    const frac = clamp(shown / CONFIG.startTime, 0, 1);
    const low = state !== 'menu' && state !== 'over' && time < 5;
    const pulse = low ? 0.55 + 0.45 * Math.abs(Math.sin(clock * 6)) : 1;
    ctx.fillStyle = rgb(colors.fg, 0.08);
    ctx.fillRect(0, 0, cw, barH);
    ctx.fillStyle = rgb(low ? colors.accent : colors.fg, 0.85 * pulse);
    ctx.fillRect(0, 0, cw * frac, barH);
    if (shown > CONFIG.startTime) {
      // Banked overtime shows as a second band on top.
      const over = clamp((shown - CONFIG.startTime) / CONFIG.startTime, 0, 1);
      ctx.fillStyle = rgb(colors.accent, 0.9);
      ctx.fillRect(0, 0, cw * over, barH * 0.45);
    }

    toWorld();
    const cx = W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (state === 'menu') {
      text('squared', cx, 70, 40, colors.fg);
      if (best > 0) text(`best ${best}`, cx, 96, 16, colors.fg, 0.6, 700);
    } else {
      text(String(score), cx, 70, 44, colors.fg);
      if (state === 'over') {
        if (newBest) text('new best!', cx, 96, 16, colors.accent, 1, 700);
        else text(`best ${best}`, cx, 96, 16, colors.fg, 0.6, 700);
        text(`${landings} squares · ${perfects} perfect · best chain x${Math.max(1, maxCombo)}`,
          cx, 118, 13, colors.fg, 0.5, 600);
      } else if (combo >= 2) {
        text(`x${combo}`, cx, 98, 22, colors.accent);
      }

      // Chain window: drains while waiting for the next press.
      if ((state === 'ready' || state === 'result') && combo >= 1) {
        const left = clamp(1 - (clock - landedAt) / CONFIG.comboWindow, 0, 1);
        ctx.fillStyle = rgb(colors.accent, 0.25);
        roundRect(cx - 30, 108, 60, 4, 2);
        ctx.fill();
        ctx.fillStyle = rgb(colors.accent);
        roundRect(cx - 30, 108, 60 * left, 4, 2);
        ctx.fill();
      }
    }

    let hint = null;
    if (state === 'menu' || (state === 'ready' && landings === 0 && misses === 0)) {
      hint = TOUCH ? 'hold to grow · release to drop' : 'hold space to grow · release to drop';
    } else if (state === 'over' && armed) {
      hint = TOUCH ? 'hold to play again' : 'hold space to play again';
    }
    if (hint) text(hint, cx, SQ.y + 60, 15, colors.fg, 0.55 + 0.25 * Math.sin(clock * 4), 600);

    for (const p of popups) {
      const k = p.t / p.life;
      ctx.globalAlpha = 1 - k * k;
      text(p.text, p.x, p.y - 30 * easeOut(k), p.size, colors[p.color]);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    drawBackground();
    toWorld();
    drawPlatforms();
    drawSquare();
    if (flash > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = rgb(colors.accent, 0.18 * flash);
      ctx.fillRect(0, 0, cw, ch);
    }
    drawHud();
    drawGrain();
  }

  // --- loop ------------------------------------------------------------------

  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05); // the first rAF timestamp can predate `last`; cap so tab switches don't jump
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  rollPlatforms();
  sq = makeSquare();
  requestAnimationFrame(frame);
})();
