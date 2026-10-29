// Home page background: particles carried by a slowly evolving incompressible flow.
// Velocity is the curl of a stream function psi, so the field is divergence-free and
// particles neither bunch up nor thin out. The mouse adds a vortex, and elements marked
// [data-avoid] act as obstacles the flow keeps clear of.
(() => {
  const canvas = document.getElementById('flow');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const SCALE = 260;   // px per unit length of psi
  const SPEED = 0.9;   // px per frame at unit velocity
  const TRAIL = 16;    // points remembered per particle
  const PAD = 30;      // clearance kept around text blocks
  const VORTEX = 90;   // radius of the mouse vortex, px

  let w = 0, h = 0, t = Math.random() * 100;
  let particles = [], obstacles = [];
  let color = '#000', alpha = 0.3;
  let vx = 0, vy = 0;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, on: false };

  // psi = sin(a)cos(b) + 0.6 sin(c) + 0.35 cos(d)sin(e) + 0.35 Y; velocity = (dpsi/dY, -dpsi/dX).
  function velocity(x, y) {
    const X = x / SCALE, Y = y / SCALE;
    const a = X + 0.13 * t, b = 0.8 * Y - 0.07 * t;
    const c = 1.7 * (0.6 * X + 0.8 * Y) - 0.11 * t;
    const d = 2.9 * X - 0.05 * t, e = 2.3 * Y + 0.09 * t;
    const cc = Math.cos(c), sd = Math.sin(d), se = Math.sin(e);
    const dPsiDx = Math.cos(a) * Math.cos(b) + 0.612 * cc - 1.015 * sd * se;
    const dPsiDy = -0.8 * Math.sin(a) * Math.sin(b) + 0.816 * cc + 0.805 * Math.cos(d) * Math.cos(e) + 0.35;
    vx = SPEED * dPsiDy;
    vy = -SPEED * dPsiDx;
    if (mouse.on) {
      // Gaussian vortex: a purely rotational term, so still divergence-free.
      const dx = x - mouse.x, dy = y - mouse.y;
      const g = 3.2 * Math.exp(-(dx * dx + dy * dy) / (2 * VORTEX * VORTEX)) / VORTEX;
      vx -= dy * g;
      vy += dx * g;
    }
  }

  function inside(x, y, pad) {
    return obstacles.some((r) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
  }

  function spawn(p) {
    for (let i = 0; i < 10; i++) {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      if (!inside(p.x, p.y, PAD)) break;
    }
    p.xs = [p.x];
    p.ys = [p.y];
    p.life = 120 + Math.random() * 480;
  }

  // Push particles out of the padded zone around each obstacle, harder the deeper they are.
  // Those that get close start fading out, so they never pile up into a visible wall.
  function repel(p) {
    for (const r of obstacles) {
      const dx = p.x - Math.max(r.left, Math.min(p.x, r.right));
      const dy = p.y - Math.max(r.top, Math.min(p.y, r.bottom));
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return spawn(p);
      if (dist < PAD) {
        const f = 3 * (1 - dist / PAD) ** 2 / dist;
        p.x += dx * f;
        p.y += dy * f;
        if (dist < PAD * 0.6) p.life = Math.min(p.life, 0);
      }
    }
  }

  function step(dt) {
    t += dt / 60;
    if (mouse.on) {
      mouse.x += (mouse.tx - mouse.x) * 0.15;
      mouse.y += (mouse.ty - mouse.y) * 0.15;
    }
    for (const p of particles) {
      velocity(p.x, p.y);
      p.x += vx * dt;
      p.y += vy * dt;
      repel(p);
      p.life -= dt;
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) p.life = Math.min(p.life, 0);
      p.xs.push(p.x);
      p.ys.push(p.y);
      // Dying particles keep moving while their tail shortens, then respawn elsewhere.
      const keep = p.life > 0 ? TRAIL : p.xs.length - 2;
      while (p.xs.length > keep) { p.xs.shift(); p.ys.shift(); }
      if (p.xs.length < 2 && p.life <= 0) spawn(p);
    }
  }

  // One stroke per trail segment index, so each tail fades out with age.
  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (let k = 1; k < TRAIL; k++) {
      ctx.beginPath();
      for (const p of particles) {
        const i = p.xs.length - k;
        if (i < 1) continue;
        ctx.moveTo(p.xs[i - 1], p.ys[i - 1]);
        ctx.lineTo(p.xs[i], p.ys[i]);
      }
      ctx.globalAlpha = alpha * (1 - (k - 1) / (TRAIL - 1));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function measure() {
    obstacles = [...document.querySelectorAll('[data-avoid]')].map((el) => el.getBoundingClientRect());
  }

  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    color = style.getPropertyValue('--fg').trim() || color;
    alpha = parseFloat(style.getPropertyValue('--flow-alpha')) || alpha;
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measure();
    const count = Math.round(Math.min(650, Math.max(180, (w * h) / 2000)));
    while (particles.length < count) {
      const p = {};
      spawn(p);
      particles.push(p);
    }
    particles.length = count;
    if (reduceMotion.matches) still();
  }

  // Reduced motion: let the flow run briefly off-screen, then show a single frame.
  function still() {
    for (let i = 0; i < TRAIL * 3; i++) step(1);
    draw();
  }

  let raf = 0, last = 0;
  function frame(now) {
    const dt = last ? Math.min((now - last) / (1000 / 60), 3) : 1;
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf || reduceMotion.matches || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  addEventListener('resize', resize);
  addEventListener('scroll', measure, { passive: true });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse.tx = e.clientX;
    mouse.ty = e.clientY;
    if (!mouse.on) {
      mouse.x = mouse.tx;
      mouse.y = mouse.ty;
      mouse.on = true;
    }
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { mouse.on = false; });
  document.addEventListener('themechange', () => {
    readTheme();
    if (reduceMotion.matches) draw();
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduceMotion.addEventListener('change', () => (reduceMotion.matches ? (stop(), still()) : start()));
  // Text blocks settle after web fonts load and the entrance animation ends.
  document.fonts?.ready.then(measure);
  setTimeout(measure, 1600);

  readTheme();
  resize();
  start();
})();
