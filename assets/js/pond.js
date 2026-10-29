// Home page background: an ASCII koi pond, inspired by Dao Ho's pond on daoho.dev (credited
// on the page). This is an independent implementation of the same ideas:
//
// - Each koi is a chain of spine points pulled along by its head, with a limit on how far
//   any joint may bend, so the body always flows in smooth curves.
// - Koi swim in bursts of tail beats and long glides, turn toward a blend of urges no faster
//   than their length allows, and drift between the surface and deeper water.
// - Every frame the koi are shaded onto a character grid as lit, tinted tiles etched with
//   glyphs, with soft edges, over a floor of shadows, a spreading wake, ripples and food.
//
// Koi steer around text marked [data-avoid] and fade beneath it (and beneath [data-dim]
// text); a click on the water throws a handful of food.
(() => {
  const canvas = document.getElementById('pond');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const TAU = Math.PI * 2;
  const NODES = 18;          // spine points, snout to tail tip
  const BEND = 0.2;          // most one spine joint may bend, rad
  const RIPPLE_SPEED = 48;   // px/s
  const PELLET_LIFE = 15;    // s; uneaten pellets start to sink at PELLET_SINK
  const PELLET_SINK = 10;
  const BITE_LIFE = 0.45;
  const MERGE_GAP = 150;     // text blocks closer than this are treated as one, px
  const DIM_UNDER = 0.15;    // how visible koi stay beneath text
  const RAMP = '+%SX8&@#';   // glyphs etched into skin tiles, from lit to shadowed
  const GLYPHS = RAMP + ".:o-|/\\*'";
  const BLACK = 0, WHITE = 1, FOOD = 2;  // glyph tones: rows of the sprite sheet
  const LIGHT = [-0.5, -0.6, 0.62];      // light from the upper left, above the water
  const INTERACTIVE = 'a, button, input, textarea, select, label, [role="button"]';

  // Skin colours per theme, mixed toward the page background by `tile` (shadowed..lit);
  // red patches run along the `hi` ramp instead. Glyphs on skin are `ink` times the tile.
  const PALETTES = {
    dark: {
      skin: { white: [234, 226, 216], red: [228, 94, 54], black: [88, 86, 104] },
      hi: [[108, 22, 22], [164, 34, 28], [210, 58, 30], [238, 96, 36], [248, 138, 56], [252, 178, 100]],
      fin: [210, 202, 194], eye: [18, 18, 24], pellet: [234, 170, 92],
      tile: [0.66, 0.97], ink: 0.42, alpha: 0.82, floor: 0.4,
      contrast: WHITE, eyeA: 0.85, finDotA: 0.45, shadowA: 0.5, waterA: 0.35,
    },
    light: {
      skin: { white: [112, 108, 104], red: [204, 64, 30], black: [38, 35, 42] },
      hi: [[138, 26, 22], [184, 40, 26], [220, 64, 30], [236, 102, 40], [242, 142, 68], [246, 178, 118]],
      fin: [136, 130, 124], eye: [24, 22, 26], pellet: [176, 108, 40],
      tile: [0.78, 0.55], ink: 0.45, alpha: 0.9, floor: 0.55,
      contrast: BLACK, eyeA: 0.55, finDotA: 0.3, shadowA: 0.16, waterA: 0.3,
    },
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Signed difference between two angles, in (-PI, PI].
  const turnTo = (from, to) => {
    let d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  // Stable pseudo-random value in [0, 1) for a pair of integers and a seed.
  function hash(a, b, seed) {
    let x = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 1440662683);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  // Smooth value noise, so markings and colour grain vary gently across the body.
  function noise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(0, 1, x - xi), v = smooth(0, 1, y - yi);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
    const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // ---------- the pond ----------

  let W = 0, H = 0, time = 0, lastFeed = -Infinity;
  let koi = [], pellets = [], ripples = [], bites = [], boxes = [];
  const pointer = { x: 0, y: 0, speed: 0, active: false, at: 0 };

  // A spot in open water: the best of a few tries, away from text and other koi.
  function openWater() {
    let best = [W / 2, H / 2], bestGap = -1;
    for (let i = 0; i < 40; i++) {
      const x = rand(W * 0.1, W * 0.9), y = rand(H * 0.1, H * 0.9);
      let gap = Infinity;
      for (const k of koi) gap = Math.min(gap, Math.hypot(k.nodes[0] - x, k.nodes[1] - y));
      for (const b of boxes) gap = Math.min(gap, 2 * Math.hypot(x - clamp(x, b.left, b.right), y - clamp(y, b.top, b.bottom)));
      if (gap > bestGap) {
        best = [x, y];
        bestGap = gap;
      }
    }
    return best;
  }

  // Markings in body space (s along the body, v across it, both as fractions of length).
  // Kohaku: red patches walked down a white body, often with a red cap. Sanke: the same with
  // small black spots. Tancho: white with a single red disc on the head.
  function markings(k) {
    const r = (j) => hash(k.id, j, 29);
    const marks = [];
    if (k.kind === 'tancho') return [{ color: 'red', s: 0.1, v: 0, rs: 0.048, rv: 0.052 }];
    if (k.kind === 'sanke') {
      for (let j = 0, n = 3 + Math.floor(r(1) * 4); j < n; j++) {
        marks.push({ color: 'black', s: 0.22 + 0.46 * r(10 + j), v: (r(20 + j) - 0.5) * 0.16, rs: 0.02 + 0.01 * r(30 + j), rv: 0.026 });
      }
    }
    let s = r(2) < 0.7 ? 0.06 : 0.2;
    for (let j = 0; s < 0.66; j++) {
      const length = 0.07 + 0.08 * r(40 + j);
      marks.push({ color: 'red', s: s + length / 2, v: (r(50 + j) - 0.5) * 0.06, rs: length / 2, rv: 0.08 + 0.05 * r(60 + j) });
      s += length + 0.06 + 0.07 * r(70 + j);
    }
    return marks;
  }

  // Grown koi, plus on wide screens two young ones that keep to deeper water.
  function spawn() {
    const base = clamp(Math.min(W, H) * 0.45, 160, 400);
    const adults = clamp(Math.round((W * H) / 250000), 3, 6);
    const young = W >= 1024 ? 2 : 0;
    koi = [];
    for (let i = 0; i < adults + young; i++) {
      const small = i >= adults;
      const L = base * (small ? rand(0.32, 0.45) : rand(0.6, 1));
      const [x, y] = openWater();
      const heading = rand(0, TAU), seg = L / (NODES - 1), nodes = new Float32Array(NODES * 2);
      for (let j = 0; j < NODES; j++) {
        nodes[j * 2] = x - Math.cos(heading) * seg * j;
        nodes[j * 2 + 1] = y - Math.sin(heading) * seg * j;
      }
      const roll = Math.random() * 6, surface = small ? 0.72 : 1;
      const k = {
        id: i + 1, kind: roll < 3 ? 'kohaku' : roll < 5 ? 'sanke' : 'tancho', L, nodes, heading,
        speed: 20, turn: 0, meander: 0, phase: rand(0, TAU), finPhase: rand(0, TAU), beat: 0,
        burstEnd: 0, nextBurst: rand(0, 3), surface, depth: rand(0.5, surface), depthGoal: rand(0.5, surface),
        nextDive: rand(6, 18), nextRing: rand(3, 14), nextWake: rand(0, 2), curiosity: rand(0.35, 1),
        target: null, rush: 0, fright: 0, fleeX: 0, fleeY: 0, gulp: 0,
      };
      k.marks = markings(k);
      koi.push(k);
    }
  }

  // A loose handful of pellets: each lands a moment apart with its own splash, then drifts.
  function feed(x, y) {
    lastFeed = time;
    ripples.push({ x, y, born: time, strength: 0.35 });
    const count = Math.min(4 + Math.floor(Math.random() * 3), 24 - pellets.length);
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 30, drift = rand(2, 6);
      pellets.push({
        x: x + Math.cos(a) * r * 1.25, y: y + Math.sin(a) * r, born: time, landAt: rand(0.12, 0.4),
        landed: false, vx: Math.cos(a) * drift, vy: Math.sin(a) * drift,
      });
    }
  }

  // The nearest floating pellet within range; a koi keeps its pellet unless one at least
  // twice as close turns up, so a burst of clicks doesn't yank it around.
  function chooseFood(k, x, y, range) {
    if (k.target && !pellets.includes(k.target)) k.target = null;
    let nearest = null, nearD = range;
    for (const p of pellets) {
      const d = p.landed ? Math.hypot(p.x - x, p.y - y) : Infinity;
      if (d < nearD) {
        nearD = d;
        nearest = p;
      }
    }
    if (!k.target) return (k.target = nearest);
    const d = Math.hypot(k.target.x - x, k.target.y - y);
    if (d > range * 1.3 || (nearest && nearD < d / 2)) k.target = nearest;
    return k.target;
  }

  // Push away from every text block within `margin`, stronger the closer.
  function repel(x, y, margin) {
    let px = 0, py = 0;
    for (const b of boxes) {
      let ox = x - clamp(x, b.left, b.right), oy = y - clamp(y, b.top, b.bottom);
      const d = Math.hypot(ox, oy);
      if (d > margin) continue;
      if (d === 0) {
        // Inside the block: head out through the nearest side.
        const sides = [x - b.left, b.right - x, y - b.top, b.bottom - y], m = Math.min(...sides);
        ox = m === sides[0] ? -1 : m === sides[1] ? 1 : 0;
        oy = m === sides[2] ? -1 : m === sides[3] ? 1 : 0;
      }
      const len = Math.hypot(ox, oy) || 1, w = 1 - d / margin;
      px += (ox / len) * w;
      py += (oy / len) * w;
    }
    return [px, py];
  }

  function swim(k, dt) {
    const L = k.L, n = k.nodes, hx = n[0], hy = n[1];

    // The direction a koi wants: carry on, meander, and add up its urges.
    k.meander = clamp(k.meander - (k.meander / 3) * dt + (Math.random() + Math.random() - 1) * 1.6 * Math.sqrt(dt), -1, 1);
    let dx = Math.cos(k.heading) + 0.7 * Math.cos(k.heading + k.meander);
    let dy = Math.sin(k.heading) + 0.7 * Math.sin(k.heading + k.meander);

    const food = chooseFood(k, hx, hy, Math.max(1.6 * L + 200, k.rush > 0 ? 650 : 0));
    const toPointer = Math.hypot(pointer.x - hx, pointer.y - hy);
    // A fast swipe close by frightens a koi, unless it is feeding (throwing food is a fast swipe too).
    if (!food && time - lastFeed > 2 && pointer.active && pointer.speed > 1000 && toPointer < 0.85 * L) {
      k.fright = 1;
      k.fleeX = pointer.x;
      k.fleeY = pointer.y;
    }
    k.fright = Math.max(0, k.fright - 0.6 * dt);
    const fleeing = k.fright > 0.3 && !food, chasing = !!food;
    let curious = false, closing = 0;

    if (fleeing) {
      const ox = hx - k.fleeX, oy = hy - k.fleeY, d = Math.hypot(ox, oy) || 1;
      dx += (ox / d) * 4.5 * k.fright;
      dy += (oy / d) * 4.5 * k.fright;
    } else if (chasing) {
      const tx = food.x - hx, ty = food.y - hy, d = Math.hypot(tx, ty) || 1;
      dx += (tx / d) * 3.2;
      dy += (ty / d) * 3.2;
      closing = clamp(1 - d / (1.2 * L), 0, 1);
    } else if (pointer.active && toPointer < 280) {
      // Come over to the cursor, then circle beneath it instead of parking.
      const tx = (pointer.x - hx) / (toPointer || 1), ty = (pointer.y - hy) / (toPointer || 1);
      const pull = k.curiosity * (1 - toPointer / 280) * 2, near = clamp(toPointer / (0.6 * L), 0, 1);
      dx += (tx * near - ty * (1 - near)) * pull;
      dy += (ty * near + tx * (1 - near)) * pull;
      curious = true;
    }

    for (const o of koi) {
      if (o === k) continue;
      const on = o.nodes;
      if (Math.abs(on[0] - hx) > 2 * L || Math.abs(on[1] - hy) > 2 * L) continue;
      // Personal space around the other koi's whole body; feeding koi crowd in closer.
      const room = (L + o.L) * (chasing ? 0.1 : 0.26);
      for (let j = 0; j < NODES; j += 3) {
        const ox = hx - on[j * 2], oy = hy - on[j * 2 + 1], d = Math.hypot(ox, oy);
        if (d > 0.001 && d < room) {
          dx += (ox / d) * 2.2 * (1 - d / room);
          dy += (oy / d) * 2.2 * (1 - d / room);
        }
      }
      // Loose shoaling: drift the way nearby koi are going.
      if (!chasing && Math.hypot(on[0] - hx, on[1] - hy) < 1.5 * L) {
        dx += 0.15 * Math.cos(o.heading);
        dy += 0.15 * Math.sin(o.heading);
      }
    }

    // Keep to open water around the text; food and the cursor can still lure koi across.
    const [px, py] = repel(hx, hy, 0.35 * L + 20);
    const shy = chasing || curious ? 0.5 : 1.6;
    dx += px * shy;
    dy += py * shy;

    // The body may slip off-screen, but the koi always turns back.
    const over = Math.max(-hx, hx - W, -hy, hy - H);
    if (over > -0.2 * L) {
      const w = clamp((over + 0.2 * L) / (0.5 * L), 0, 1) * 3.2;
      const cx = W / 2 - hx, cy = H / 2 - hy, d = Math.hypot(cx, cy) || 1;
      dx += (cx / d) * w;
      dy += (cy / d) * w;
    }

    // Turn no tighter than a few body lengths' circle allows, easing the turn in and out.
    const radius = L * (fleeing ? 0.12 : chasing ? 0.2 - 0.06 * closing : curious ? 0.22 : 0.3);
    const maxTurn = Math.min(2.5, (k.speed / radius) * (1 + 0.6 * k.rush));
    const want = clamp(3 * turnTo(k.heading, Math.atan2(dy, dx)), -maxTurn, maxTurn);
    k.turn += (want - k.turn) * Math.min(1, 5 * dt);
    k.heading += k.turn * dt;

    // Burst and glide: a run of tail beats, then a long coast. Chasing or fleeing koi keep beating.
    if (time > k.nextBurst && time > k.burstEnd) {
      k.burstEnd = time + rand(0.6, 1.4);
      k.nextBurst = k.burstEnd + rand(1.5, 4.5);
    }
    const beating = fleeing || chasing || time < k.burstEnd;
    k.beat += ((beating ? 1 : 0) - k.beat) * Math.min(1, 3 * dt);
    k.rush = Math.max(0, k.rush - 0.7 * dt);
    const cruise = 14 + 0.045 * L;
    const pace = fleeing ? 3.2 : chasing ? 2 + closing : curious ? 1.7 : 1.45;
    const goal = cruise * pace * (1 + 0.8 * k.rush);
    // Beats drive the koi toward its pace; between bursts water drag slows it down.
    k.speed += (2.2 * k.beat * (goal - k.speed) - 0.45 * (1 - k.beat) * (k.speed - 0.3 * cruise)) * dt;
    k.phase += dt * (0.5 + k.beat * (2.4 + k.speed / 12));
    k.finPhase += 2.3 * dt;
    k.gulp += ((chasing && closing > 0.55 ? 1 : 0) - k.gulp) * Math.min(1, 6 * dt);

    // Drift between the surface and deeper water, rising for food.
    if (time > k.nextDive) {
      k.depthGoal = rand(0.5, k.surface);
      k.nextDive = time + rand(7, 18);
    }
    k.depth += ((chasing ? 1 : k.depthGoal) - k.depth) * Math.min(1, dt * (chasing ? 0.9 : 0.12));

    // Tail beats near the surface push small rings out behind the koi.
    if (k.beat > 0.6 && k.depth > 0.68 && time > k.nextWake) {
      const t = (NODES - 3) * 2;
      ripples.push({ x: n[t], y: n[t + 1], born: time, strength: 0.2 + 0.2 * k.depth });
      k.nextWake = time + rand(0.9, 1.8) / k.beat;
    }

    // The head leads; each joint follows the one ahead, bending no more than BEND.
    n[0] += Math.cos(k.heading) * k.speed * dt;
    n[1] += Math.sin(k.heading) * k.speed * dt;
    const seg = L / (NODES - 1);
    let prev = k.heading + Math.PI;
    for (let j = 1; j < NODES; j++) {
      const ax = n[j * 2 - 2], ay = n[j * 2 - 1];
      const angle = prev + clamp(turnTo(prev, Math.atan2(n[j * 2 + 1] - ay, n[j * 2] - ax)), -BEND, BEND);
      n[j * 2] = ax + Math.cos(angle) * seg;
      n[j * 2 + 1] = ay + Math.sin(angle) * seg;
      prev = angle;
    }

    const mouth = 0.075 * L + 7, before = pellets.length;
    pellets = pellets.filter((p) => !p.landed || (p.x - n[0]) ** 2 + (p.y - n[1]) ** 2 > mouth * mouth);
    if (pellets.length < before) {
      ripples.push({ x: n[0], y: n[1], born: time, strength: 0.6 });
      bites.push({ x: n[0], y: n[1], born: time });
      k.nextRing = time + rand(6, 16);
    } else if (time > k.nextRing) {
      // Now and then a koi noses the surface.
      ripples.push({ x: n[0], y: n[1], born: time, strength: 0.3 });
      k.nextRing = time + rand(8, 20);
    }
  }

  function step(dt) {
    time += dt;
    pointer.speed *= Math.exp(-8 * dt);
    for (const k of koi) swim(k, dt);
    pellets = pellets.filter((p) => time - p.born < PELLET_LIFE);
    for (const p of pellets) {
      if (!p.landed) {
        if (time - p.born < p.landAt) continue;
        p.landed = true;
        ripples.push({ x: p.x, y: p.y, born: time, strength: 0.1 });
        // The splash is what koi notice: every koi in range turns and hurries over.
        for (const k of koi) if (Math.hypot(k.nodes[0] - p.x, k.nodes[1] - p.y) < 650) k.rush = 1;
        continue;
      }
      const damp = Math.exp(-0.2 * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    ripples = ripples.filter((r) => time - r.born < rippleLife(r));
    bites = bites.filter((b) => time - b.born < BITE_LIFE);
  }

  const rippleLife = (r) => 2.1 + 1.6 * r.strength;

  // ---------- drawing ----------

  let dpr = 1, cw = 12, ch = 14, cols = 0, rows = 0, cs = 13;
  let palette = PALETTES.light, bg = [244, 242, 238];
  // Tiles are one pixel per cell, scaled up when painted; glyphs are an index into the
  // sprite sheet, a tone and an alpha per cell.
  const tileCanvas = document.createElement('canvas');
  const tileCtx = tileCanvas.getContext('2d');
  let tiles, glyph, tone, glyphA, dim, shadow, energy, energyTmp;
  let sprites, gaps;
  // Scratch space for one koi: per cell, the nearest point on its spine (distance squared,
  // position along it, side and segment) and how far beyond either end the cell lies.
  let near, along, sideOf, segOf, beyond, seen, touched, stamp = 0;
  const spine = new Float32Array(NODES * 2), arc = new Float32Array(NODES);
  const fins = [{}, {}, {}];
  const rgb = [0, 0, 0];

  function mixInto(a, b, t) {
    rgb[0] = a[0] + (b[0] - a[0]) * t;
    rgb[1] = a[1] + (b[1] - a[1]) * t;
    rgb[2] = a[2] + (b[2] - a[2]) * t;
  }

  function rampInto(stops, t) {
    const x = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
    mixInto(stops[i], stops[i + 1], x - i);
  }

  function setTile(i, a) {
    const p = tiles.data, j = i * 4;
    p[j] = rgb[0];
    p[j + 1] = rgb[1];
    p[j + 2] = rgb[2];
    p[j + 3] = a * 255;
  }

  function setGlyph(i, ch, t, a) {
    glyph[i] = GLYPHS.indexOf(ch) + 1;
    tone[i] = t;
    glyphA[i] = a;
  }

  function lineGlyph(dx, dy) {
    const d = Math.hypot(dx, dy) || 1;
    if (Math.abs(dy) < 0.38 * d) return '-';
    if (Math.abs(dx) < 0.38 * d) return '|';
    return dx * dy > 0 ? '\\' : '/';
  }

  function cellAt(x, y) {
    const c = Math.floor(x / cw), r = Math.floor(y / ch);
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  }

  // How much of a cell a shape covers, from its signed distance to the outline (px).
  const coverage = (sd) => clamp(0.5 - sd / cs, 0, 1);

  // Body half-width as a fraction of length at s (0 snout, 1 tail tip): a round head, full
  // shoulders, then a long taper to the tail stalk at 0.75.
  function bodyHalf(s) {
    if (s < 0.09) return 0.12 * Math.sqrt(1 - ((0.09 - s) / 0.09) ** 2);
    if (s < 0.27) return 0.12 + 0.02 * smooth(0.09, 0.27, s);
    return 0.03 + 0.055 * (1 + Math.cos((Math.PI * Math.min(s - 0.27, 0.48)) / 0.48));
  }

  // Tail fin half-width: it fans out from the stalk.
  const tailHalf = (s) => 0.028 + 0.165 * smooth(0.72, 1, s) ** 0.85;

  // How far from the spine any part of the koi reaches near s, as a fraction of length:
  // the pectoral fins, then the pelvic fins, the tail stalk and the tail fin.
  const extent = (s) => (s < 0.4 ? 0.31 : s < 0.57 ? 0.18 : s < 0.68 ? 0.11 : 0.22);

  // A paired fin: an ellipse leaning back (by `angle`) from a root on the body's edge.
  function makeFin(fin, rootS, angle, reach, width) {
    fin.s = rootS;
    fin.a = 0.85 * bodyHalf(rootS);
    fin.cos = Math.cos(angle);
    fin.sin = Math.sin(angle);
    fin.reach = reach;
    fin.width = width;
    return fin;
  }

  function finCoverage(f, s, an, L) {
    const du = s - f.s;
    if (Math.abs(du) > 2.2 * f.reach) return 0;
    const da = an - f.a, along = du * f.cos + da * f.sin - f.reach, across = da * f.cos - du * f.sin;
    return coverage((Math.hypot(along / f.reach, across / f.width) - 1) * f.width * L);
  }

  function skinAt(k, s, vn, across) {
    // The belly edge and tail stalk stay white, which frames the markings.
    if (across > 0.9 || s > 0.74) return 'white';
    let wobble = null;
    for (const m of k.marks) {
      const e = ((s - m.s) / m.rs) ** 2 + ((vn - m.v) / m.rv) ** 2;
      if (e > 1.3) continue;
      // Ragged edges, so patches read as painted markings rather than ellipses.
      if (e > 0.7) {
        if (wobble === null) wobble = (noise(s * 14 + k.id, vn * 30, k.id + 3) - 0.5) * 0.6;
        if (e >= 1 + wobble) continue;
      }
      return m.color;
    }
    return 'white';
  }

  function drawKoi(k) {
    const L = k.L, n = k.nodes;
    // A travelling wave down the body, growing toward the tail; a gliding koi holds almost straight.
    const swimming = 0.25 + 1.05 * k.beat;
    for (let j = 0; j < NODES; j++) {
      const s = j / (NODES - 1), a = Math.max(0, j - 1), b = Math.min(NODES - 1, j + 1);
      const tx = n[a * 2] - n[b * 2], ty = n[a * 2 + 1] - n[b * 2 + 1], tl = Math.hypot(tx, ty) || 1;
      const off = L * 0.045 * (0.06 + 0.94 * s ** 2.1) * swimming * Math.sin(k.phase - 4.4 * s);
      spine[j * 2] = n[j * 2] - (ty / tl) * off;
      spine[j * 2 + 1] = n[j * 2 + 1] + (tx / tl) * off;
    }
    arc[0] = 0;
    for (let j = 1; j < NODES; j++) {
      arc[j] = arc[j - 1] + Math.hypot(spine[j * 2] - spine[j * 2 - 2], spine[j * 2 + 1] - spine[j * 2 - 1]);
    }
    const total = arc[NODES - 1] || 1;

    // Nearest point on the spine for every cell within reach of each segment.
    stamp++;
    let count = 0;
    for (let j = 0; j < NODES - 1; j++) {
      const reach = L * Math.max(extent(arc[j] / total), extent(arc[j + 1] / total)) + cs;
      const x0 = spine[j * 2], y0 = spine[j * 2 + 1], dx = spine[j * 2 + 2] - x0, dy = spine[j * 2 + 3] - y0;
      const len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2);
      const c0 = Math.max(0, Math.floor((Math.min(x0, x0 + dx) - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(x0, x0 + dx) + reach) / cw));
      const r0 = Math.max(0, Math.floor((Math.min(y0, y0 + dy) - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(y0, y0 + dy) + reach) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const px = (c + 0.5) * cw - x0, py = (r + 0.5) * ch - y0;
          const raw = (px * dx + py * dy) / len2, t = clamp(raw, 0, 1);
          const ex = px - dx * t, ey = py - dy * t, d2 = ex * ex + ey * ey, i = r * cols + c;
          if (seen[i] !== stamp) {
            seen[i] = stamp;
            touched[count++] = i;
          } else if (d2 >= near[i]) {
            continue;
          }
          near[i] = d2;
          along[i] = (arc[j] + t * len) / total;
          sideOf[i] = dx * py - dy * px >= 0 ? 1 : -1;
          segOf[i] = j;
          beyond[i] = j === 0 && raw < 0 ? -raw * len : j === NODES - 2 && raw > 1 ? -(raw - 1) * len : 0;
        }
      }
    }

    const fade = palette.alpha * (palette.floor + (1 - palette.floor) * k.depth);
    // Pectoral fins tuck in during a burst, scull while gliding, and the inner one flares into a turn.
    const tuck = 1 - 0.25 * k.beat, scull = 0.17 * (1 - k.beat) * Math.sin(k.finPhase), bank = clamp(0.55 * k.turn, -0.35, 0.35);
    const flares = [tuck - scull + bank, tuck + scull - bank];
    const pectorals = flares.map((f, i) => makeFin(fins[i], 0.2, 0.95 + 0.45 * (f - 1), 0.068 * f, 0.04));
    const pelvic = makeFin(fins[2], 0.47, 0.78, 0.036, 0.019);
    // Near the surface a koi's shadow falls farther away on the floor.
    const shadowC = Math.round((0.065 * L * k.depth) / cw) + 1, shadowR = Math.round((0.065 * L * k.depth) / ch) + 1;
    const lean = (hash(k.id, 5, 17) - 0.5) * 0.3;
    const [lo, hi] = palette.tile;

    for (let q = 0; q < count; q++) {
      const i = touched[q], dist = Math.sqrt(near[i]), s = along[i], side = sideOf[i], an = dist / L;
      const c = i % cols, r = (i - c) / cols, cellFade = fade * dim[i];
      const j = segOf[i], sx = spine[j * 2 + 2] - spine[j * 2], sy = spine[j * 2 + 3] - spine[j * 2 + 1];
      const sl = Math.hypot(sx, sy) || 1, tx = sx / sl, ty = sy / sl;

      if (beyond[i] > 0) {
        // In front of the snout only the barbels reach: a short whisker from each corner of the mouth.
        const ahead = beyond[i] / L, lateral = Math.abs(tx * ((r + 0.5) * ch - spine[1]) - ty * ((c + 0.5) * cw - spine[0])) / L;
        if (ahead < 0.045 && Math.abs(lateral - (0.042 + 0.65 * ahead)) < 0.014) {
          setGlyph(i, lineGlyph(-tx - side * ty * 0.65, -ty + side * tx * 0.65), palette.contrast, 0.5 * cellFade);
        }
        continue;
      }

      const past = beyond[i] < 0 ? -beyond[i] / L : 0, flare = flares[side > 0 ? 0 : 1];
      let body = 0, across = 1;
      if (s <= 0.75 && past === 0) {
        const half = bodyHalf(s);
        body = coverage((an - half) * L);
        across = Math.min(1, an / half);
      }
      let fin = 0;
      if (body < 0.98) {
        const se = s + past;
        if (se > 0.7) {
          // Tail fin, with a V notch in its trailing edge.
          const tw = tailHalf(Math.min(se, 1)) * (0.85 + 0.15 * flare);
          fin = coverage(Math.max(an - tw, se - 0.86 - 0.14 * Math.min(1, an / tw)) * L);
        }
        fin = Math.max(fin, finCoverage(pectorals[side > 0 ? 0 : 1], s, an, L), finCoverage(pelvic, s, an, L));
      }
      if (body < 0.03 && fin < 0.03) continue;

      const key = (hash(Math.round((s * L) / (cw * 0.9)), Math.round((side * dist) / (cw * 0.9)), k.id) * 4294967295) >>> 0;
      if (fin > body) {
        // Fins: a pale veil of tiles flecked with dots, never competing with the body.
        mixInto(bg, palette.fin, 0.55);
        setTile(i, 0.45 * fin * cellFade);
        if (key % 2 === 0) setGlyph(i, '.', palette.contrast, palette.finDotA * fin * cellFade);
        else glyph[i] = 0;
        continue;
      }

      // Skin: tinted by the markings and lit like a rounded back.
      const vn = (side * dist) / L, kind = skinAt(k, s, vn, across);
      const up = Math.sqrt(1 - across * across), ox = -ty * side, oy = tx * side;
      const lum = clamp(0.25 + 0.75 * Math.max(0, across * (ox * LIGHT[0] + oy * LIGHT[1]) + up * LIGHT[2]), 0, 1);
      if (kind === 'red') {
        // Red runs from crimson in shadow to amber in the light, with a little grain and a
        // band of sheen sliding down the body like light over wet scales.
        const grain = (noise(s * 9 + k.id, vn * 18, k.id + 21) - 0.5) * 0.25;
        const sheen = Math.max(0, Math.cos(s * 11 - time * 1.7 + k.id) - 0.75) * 1.2;
        rampInto(palette.hi, 0.12 + 0.8 * lum + lean + grain + sheen);
      } else {
        mixInto(bg, palette.skin[kind], lo + (hi - lo) * lum);
      }

      if (body < 0.85) {
        // Soft edge: a partly covered tile, sometimes with a dot.
        setTile(i, 0.55 * body * cellFade);
        if (key % 3 === 0 && body < 0.7) setGlyph(i, '.', BLACK, (1 - palette.ink) * cellFade);
        else glyph[i] = 0;
        continue;
      }

      // Now and then a scale catches the light for a moment.
      if (hash(key, Math.floor(time * 1.3 + (key % 997) / 91), 7) < 0.03) mixInto(rgb, bg, 0.45);
      setTile(i, cellFade);
      if (s > 0.05 && s < 0.095 && across > 0.5 && across < 0.85) {
        mixInto(bg, palette.eye, 0.85);
        setTile(i, cellFade);
        setGlyph(i, 'o', WHITE, palette.eyeA * cellFade);
      } else if (s < 0.035 && across < 0.6 && k.gulp > 0.5) {
        setGlyph(i, 'o', BLACK, 0.85 * cellFade);
      } else {
        const g = RAMP[clamp(Math.round((1 - lum) * 4) + (key % 3), 0, RAMP.length - 1)];
        // White skin is etched lightly, so the red and black patches carry the pattern.
        setGlyph(i, g, BLACK, (1 - palette.ink) * (kind === 'white' ? 0.6 : 1) * cellFade);
      }
      if (c + shadowC < cols && r + shadowR < rows) shadow[i + shadowR * cols + shadowC] = 1;
    }
  }

  // The wake: energy left behind koi tails (and the cursor) that spreads and fades, on a
  // fixed 60 Hz clock so it behaves the same at any frame rate.
  let wakeClock = 0;
  function stirWater(dt) {
    wakeClock = Math.min(wakeClock + dt, 0.1);
    while (wakeClock >= 1 / 60) {
      wakeClock -= 1 / 60;
      for (const k of koi) {
        for (let j = NODES - 4; j < NODES; j++) {
          const i = cellAt(k.nodes[j * 2], k.nodes[j * 2 + 1]);
          if (i >= 0) energy[i] = Math.min(1.5, energy[i] + 0.035 + 0.0012 * k.speed);
        }
      }
      if (pointer.active) {
        const i = cellAt(pointer.x, pointer.y);
        if (i >= 0) energy[i] = Math.min(1.5, energy[i] + 0.12);
      }
      const decay = Math.exp(-1.1 / 60);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c, e = energy[i];
          const sum = (c > 0 ? energy[i - 1] : e) + (c < cols - 1 ? energy[i + 1] : e) + (r > 0 ? energy[i - cols] : e) + (r < rows - 1 ? energy[i + cols] : e);
          energyTmp[i] = (4 * e + sum) * 0.125 * decay;
        }
      }
      [energy, energyTmp] = [energyTmp, energy];
    }
  }

  // Expanding rings drawn with glyphs that follow the ring, and a fainter dotted echo inside.
  function drawRipple(rp) {
    const age = time - rp.born, fadeOut = (1 - age / rippleLife(rp)) ** 1.5 * rp.strength;
    for (let echo = 0; echo < 2; echo++) {
      const radius = Math.max(0, age - 0.45 * echo) * RIPPLE_SPEED * (0.7 + 0.5 * rp.strength);
      if (radius < 2) continue;
      const c0 = Math.max(0, Math.floor((rp.x - radius - cw) / cw)), c1 = Math.min(cols - 1, Math.floor((rp.x + radius + cw) / cw));
      const r0 = Math.max(0, Math.floor((rp.y - radius - ch) / ch)), r1 = Math.min(rows - 1, Math.floor((rp.y + radius + ch) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (glyph[i]) continue;
          const dx = (c + 0.5) * cw - rp.x, dy = (r + 0.5) * ch - rp.y;
          if (Math.abs(Math.hypot(dx, dy) - radius) > 0.6 * cw) continue;
          setGlyph(i, echo ? '.' : lineGlyph(-dy, dx), palette.contrast, palette.waterA * fadeOut * (echo ? 0.85 : 1.55) * dim[i]);
        }
      }
    }
  }

  function render(dt) {
    tiles.data.fill(0);
    glyph.fill(0);
    shadow.fill(0);
    // Deeper koi first, so the ones near the surface glide over them.
    for (const k of [...koi].sort((a, b) => a.depth - b.depth)) drawKoi(k);
    stirWater(dt);

    for (let i = 0; i < glyph.length; i++) {
      if (glyph[i]) continue;
      if (shadow[i]) setGlyph(i, ':', BLACK, palette.shadowA * dim[i]);
      else if (energy[i] > 0.22) setGlyph(i, energy[i] > 0.5 ? '-' : '.', palette.contrast, Math.min(1, (energy[i] - 0.22) * 1.4) * palette.waterA * dim[i]);
    }
    for (const rp of ripples) drawRipple(rp);
    // Pellets fall in (' then .), land as o, bob while floating, then fade to . as they sink.
    for (const p of pellets) {
      const age = time - p.born;
      if (!p.landed) {
        const fall = age / p.landAt, i = cellAt(p.x, p.y - (1 - fall) * ch * 1.5);
        if (i >= 0 && !glyph[i]) setGlyph(i, fall < 0.5 ? "'" : '.', FOOD, palette.alpha * (0.5 + 0.4 * fall));
        continue;
      }
      const i = cellAt(p.x, p.y);
      if (i < 0 || glyph[i]) continue;
      const sink = smooth(PELLET_SINK, PELLET_LIFE, age), bob = 0.8 + 0.2 * Math.sin(age * 3 + p.x);
      setGlyph(i, sink > 0.55 ? '.' : 'o', FOOD, palette.alpha * bob * (1 - 0.85 * sink));
    }
    // A bite flashes over the koi's mouth: * then + then a dot.
    for (const b of bites) {
      const i = cellAt(b.x, b.y), t = (time - b.born) / BITE_LIFE;
      if (i >= 0) setGlyph(i, t < 0.35 ? '*' : t < 0.7 ? '+' : '.', FOOD, Math.min(1, palette.alpha * 1.6) * (1 - t * t));
    }
    paint();
  }

  // Tiles: the one-pixel-per-cell image scaled up, with the gaps between tiles cut out.
  // Glyphs: copied 1:1 from the sprite sheet, in device pixels.
  function paint() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    tileCtx.putImageData(tiles, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tileCanvas, 0, 0, cols * cw * dpr, rows * ch * dpr);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(gaps, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    const sw = Math.ceil(cw * dpr), sh = Math.ceil(ch * dpr);
    for (let i = 0; i < glyph.length; i++) {
      if (!glyph[i] || glyphA[i] < 0.01) continue;
      const c = i % cols, r = (i - c) / cols;
      ctx.globalAlpha = Math.min(1, glyphA[i]);
      ctx.drawImage(sprites, (glyph[i] - 1) * sw, tone[i] * sh, sw, sh, Math.round(c * cw * dpr), Math.round(r * ch * dpr), sw, sh);
    }
    ctx.globalAlpha = 1;
  }

  // Sprite sheet of every glyph in black, white and the food colour, plus the grid of gaps.
  function buildSprites() {
    const sw = Math.ceil(cw * dpr), sh = Math.ceil(ch * dpr);
    sprites = document.createElement('canvas');
    sprites.width = sw * GLYPHS.length;
    sprites.height = sh * 3;
    const g = sprites.getContext('2d');
    g.font = `600 ${Math.round(ch * 0.72) * dpr}px "Geist Mono", ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    [[0, 0, 0], [255, 255, 255], palette.pellet].forEach((color, row) => {
      g.fillStyle = `rgb(${color})`;
      for (let i = 0; i < GLYPHS.length; i++) g.fillText(GLYPHS[i], (i + 0.5) * sw, (row + 0.5) * sh + dpr);
    });

    gaps = document.createElement('canvas');
    gaps.width = canvas.width;
    gaps.height = canvas.height;
    const gg = gaps.getContext('2d'), line = Math.max(1, Math.round(dpr));
    for (let c = 0; c <= cols; c++) gg.fillRect(Math.round(c * cw * dpr) - (line >> 1), 0, line, gaps.height);
    for (let r = 0; r <= rows; r++) gg.fillRect(0, Math.round(r * ch * dpr) - (line >> 1), gaps.width, line);
  }

  // Text blocks the koi steer around, merged when close so koi aren't squeezed between them,
  // and a per-cell dimming that eases back in over a few cells around them and the nav text.
  function measure() {
    const rects = [...document.querySelectorAll('[data-avoid]')].map((el) => el.getBoundingClientRect()).filter((b) => b.width && b.height);
    boxes = [];
    for (const b of rects.sort((p, q) => p.top - q.top)) {
      const m = boxes.find((o) => b.top - o.bottom < MERGE_GAP && b.left - o.right < MERGE_GAP && o.left - b.right < MERGE_GAP);
      if (m) {
        m.left = Math.min(m.left, b.left);
        m.right = Math.max(m.right, b.right);
        m.bottom = Math.max(m.bottom, b.bottom);
      } else {
        boxes.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
      }
    }
    if (!dim) return;
    const shade = [...boxes];
    const range = document.createRange();
    for (const el of document.querySelectorAll('[data-dim]')) {
      range.selectNodeContents(el);
      for (const b of range.getClientRects()) if (b.width && b.height) shade.push(b);
    }
    dim.fill(1);
    const pad = 4 * cw;
    for (const b of shade) {
      const c0 = Math.max(0, Math.floor((b.left - pad) / cw)), c1 = Math.min(cols - 1, Math.floor((b.right + pad) / cw));
      const r0 = Math.max(0, Math.floor((b.top - pad) / ch)), r1 = Math.min(rows - 1, Math.floor((b.bottom + pad) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = (c + 0.5) * cw, y = (r + 0.5) * ch, i = r * cols + c;
          const d = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
          dim[i] = Math.min(dim[i], DIM_UNDER + (1 - DIM_UNDER) * smooth(0, pad, d));
        }
      }
    }
  }

  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    const m = style.getPropertyValue('--bg').trim().match(/^#(\w\w)(\w\w)(\w\w)$/);
    if (m) bg = m.slice(1).map((x) => parseInt(x, 16));
    palette = bg[0] + bg[1] + bg[2] < 384 ? PALETTES.dark : PALETTES.light;
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const first = W === 0;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // Near-square cells, large enough to read each etched glyph.
    cw = clamp(Math.round(W / 120), 8, 12);
    ch = cw + 2;
    cs = (cw + ch) / 2;
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);
    const n = cols * rows;
    tileCanvas.width = cols;
    tileCanvas.height = rows;
    tiles = tileCtx.createImageData(cols, rows);
    glyph = new Uint8Array(n);
    tone = new Uint8Array(n);
    glyphA = new Float32Array(n);
    dim = new Float32Array(n).fill(1);
    shadow = new Uint8Array(n);
    energy = new Float32Array(n);
    energyTmp = new Float32Array(n);
    near = new Float32Array(n);
    along = new Float32Array(n);
    sideOf = new Int8Array(n);
    segOf = new Uint8Array(n);
    beyond = new Float32Array(n);
    seen = new Uint32Array(n);
    touched = new Int32Array(n);
    stamp = 0;
    buildSprites();
    measure();
    if (first) spawn();
    if (reduceMotion.matches) still();
  }

  // Reduced motion: let the koi settle in for a few seconds, then hold a single frame.
  function still() {
    while (time < 4) step(1 / 60);
    render(1 / 60);
  }

  let raf = 0, last = 0, frames = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Small steps keep fast frames smooth and slow frames stable.
    for (let left = dt; left > 1e-6; left -= 1 / 30) step(Math.min(left, 1 / 30));
    if (++frames % 30 === 0) measure();  // follow layout shifts and entrance animations
    render(dt);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf || reduceMotion.matches || document.hidden || !W) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  addEventListener('pointermove', (e) => {
    const elapsed = Math.max(1, e.timeStamp - pointer.at) / 1000;
    pointer.speed += (Math.min(Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) / elapsed, 5000) - pointer.speed) * 0.5;
    pointer.at = e.timeStamp;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = e.pointerType !== 'touch';
  }, { passive: true });
  const leave = () => {
    pointer.active = false;
    pointer.speed = 0;
  };
  document.documentElement.addEventListener('pointerleave', leave);
  addEventListener('blur', leave);
  // Clicks on open water throw food; links, buttons and text selection are left alone.
  addEventListener('click', (e) => {
    if (reduceMotion.matches || e.composedPath().some((el) => el instanceof Element && el.matches(INTERACTIVE))) return;
    if (getSelection()?.toString()) return;
    feed(e.clientX, e.clientY);
  });
  addEventListener('resize', resize);
  addEventListener('scroll', measure, { passive: true });
  document.addEventListener('themechange', () => {
    readTheme();
    buildSprites();
    if (reduceMotion.matches) render(1 / 60);
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduceMotion.addEventListener('change', () => (reduceMotion.matches ? (stop(), still()) : start()));
  // Glyphs need the web font, and text blocks settle once it has loaded.
  document.fonts?.ready.then(() => {
    buildSprites();
    measure();
  });

  readTheme();
  resize();
  start();
})();
