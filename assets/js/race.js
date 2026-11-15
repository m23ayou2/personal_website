// Home page background: a superbike race drawn in ASCII, after the racing header on General
// Intuition's site (credited on the page). This is an independent WebGL implementation of
// the same idea:
//
// - Short clips (a space-separated list in data-src) play in turn in hidden <video>s, and
//   each frame is sampled once per character cell.
// - Each cell is a tile of the frame's colour, etched with a glyph of that same colour picked
//   from a sparse-to-dense ramp by brightness (on the light theme by darkness, like ink).
// - The pointer leaves a fading trail that lights up the cells it passes over.
// - Cells fade out around text marked [data-avoid] and the nav text ([data-dim]).
// - Each clip's last moments dissolve into the first frame of the next one (or of itself,
//   when there is only one), so the sequence and its loop have no visible cuts.
(() => {
  const canvas = document.getElementById('race');
  if (!canvas || !canvas.dataset.src) return;
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const ATLAS_COLS = 10;
  const STILL_AT = 3.75;       // s into the first clip; the frame held when motion is reduced
  const SEAM = 0.45;           // s; how long the end of a clip dissolves into the next start
  const TRAIL = 12;            // trail points the shader reads
  const TRAIL_LIFE = 900;      // ms
  const TRAIL_EVERY = 28;      // ms between trail points
  const RECTS = 6;             // text blocks the shader reads
  const MERGE_GAP = 24;        // px; text blocks closer than this are cleared as one
  const FOCUS = [0.45, 0.5];   // point of the clip kept in view when it is cropped

  // Per theme: how strongly tiles and glyphs carry the clip's colour, a curve on that colour,
  // a curve on the brightness that picks glyphs, how much the trail lights cells, and how
  // visible the clip stays beneath text. The clip is a sunny afternoon, so the dark theme
  // pushes its midtones down to let kerbs and bikes stand out, and the light theme lifts the
  // asphalt so it takes little ink.
  const LOOKS = {
    dark: { tile: 0.42, glyph: 0.95, color: 1.7, tone: 1.35, trail: 1.0, under: 0.05 },
    light: { tile: 0.34, glyph: 0.9, color: 0.75, tone: 1.4, trail: 1.0, under: 0.03 },
  };

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    #define TRAIL ${TRAIL}
    #define RECTS ${RECTS}
    uniform sampler2D uVideo, uFirst, uAtlas;
    uniform vec2 uView;         // canvas size, device px
    uniform vec2 uCell;         // cell size, device px
    uniform vec2 uAtlasSize;
    uniform vec4 uCrop;         // clip uv at the origin (xy) and per device px (zw)
    uniform float uFit;         // height of the area the clip covers, device px
    uniform float uSeam;        // 0..1, dissolve toward the first frame
    uniform float uGlyphs;
    uniform vec3 uBg;
    uniform float uDark;
    uniform vec4 uLook;         // tile, glyph, colour curve, trail
    uniform float uTone;        // brightness curve for picking glyphs
    uniform float uPad;         // device px over which cells fade back in beside text
    uniform float uUnder;       // how visible the clip stays beneath text
    uniform float uRadius;      // trail radius, device px
    uniform vec4 uRects[RECTS]; // left, top, right, bottom, device px
    uniform vec3 uTrail[TRAIL]; // x, y, strength

    void main() {
      vec2 px = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
      vec2 cell = floor(px / uCell);
      vec2 local = px - cell * uCell;
      vec2 center = (cell + 0.5) * uCell;
      vec2 uv = uCrop.xy + center * uCrop.zw;
      vec3 c = mix(texture2D(uVideo, uv).rgb, texture2D(uFirst, uv).rgb, uSeam);
      c = pow(c, vec3(uLook.z));

      float glow = 0.0;
      for (int i = 0; i < TRAIL; i++) {
        vec3 p = uTrail[i];
        if (p.z > 0.0) {
          float r = uRadius * (0.35 + 0.65 * p.z);
          glow = max(glow, p.z * (1.0 - smoothstep(0.0, r, distance(center, p.xy))));
        }
      }
      glow *= uLook.w;
      // On the dark theme the trail lights the clip up; on the light theme it deepens the
      // colour of the tiles instead (below).
      if (uDark > 0.5) c = min(c * (1.0 + 1.6 * glow), 1.0);

      // Fade in from the top edge, beneath the nav, and out at the bottom of the clip's area.
      float vis = smoothstep(0.0, 0.25 * uFit, center.y);
      if (uFit < uView.y) vis *= 1.0 - smoothstep(uFit - 4.0 * uCell.y, uFit, center.y);
      for (int i = 0; i < RECTS; i++) {
        vec4 b = uRects[i];
        if (b.z > b.x) {
          vec2 d = max(b.xy - center, center - b.zw);
          vis = min(vis, mix(uUnder, 1.0, smoothstep(0.35 * uPad, uPad, length(max(d, 0.0)))));
        }
      }

      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      float tone = clamp(pow(mix(1.0 - lum, lum, uDark), uTone) + glow * 0.25, 0.0, 1.0);
      float idx = floor(tone * (uGlyphs - 1.0) + 0.5);
      vec2 slot = vec2(mod(idx, ${ATLAS_COLS}.0), floor(idx / ${ATLAS_COLS}.0));
      float ink = texture2D(uAtlas, (slot * uCell + local) / uAtlasSize).r;

      float tile = uLook.x + glow * 0.5;
      vec3 col = uDark > 0.5
        ? uBg + c * (tile + ink * uLook.y)
        : mix(mix(uBg, c, tile), c * 0.5, ink * uLook.y);
      gl_FragColor = vec4(clamp(mix(uBg, col, vis), 0.0, 1.0), 1.0);
    }`;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  let program, loc = {}, videoTex, atlasTex, firstTex = [], hasFirst = [];
  let W = 0, H = 0, dpr = 1, cw = 0, ch = 0, atlasW = 0, atlasH = 0, textTop = 0;
  let bg = [24, 23, 21], dark = true;
  let hasFrame = false, fresh = false, lastTime = -1, dirty = true, raf = 0;
  const rects = new Float32Array(RECTS * 4);
  const trail = [];
  const trailData = new Float32Array(TRAIL * 3);

  // Safari wants the muted and playsinline attributes, not just the properties. The videos
  // are kept in the document at a real size (mobile browsers may not decode detached or
  // zero-sized videos) but invisible. Only the first loads up front; each next one loads
  // while the one before it plays.
  const sources = canvas.dataset.src.split(/\s+/).filter(Boolean);
  const clips = sources.map((src, i) => {
    const v = document.createElement('video');
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.muted = true;
    v.playsInline = true;
    v.loop = sources.length === 1;
    v.preload = i === 0 ? 'auto' : 'none';
    v.tabIndex = -1;
    v.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:36px;opacity:0;pointer-events:none;z-index:-1';
    v.src = src;
    document.body.append(v);
    return v;
  });
  let cur = 0, video = clips[0];
  const nextIndex = () => (cur + 1) % clips.length;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function texture(filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  }

  function setup() {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const name of ['uVideo', 'uFirst', 'uAtlas', 'uView', 'uCell', 'uAtlasSize', 'uCrop', 'uFit', 'uSeam', 'uGlyphs',
      'uBg', 'uDark', 'uLook', 'uTone', 'uPad', 'uUnder', 'uRadius', 'uRects', 'uTrail']) {
      loc[name] = gl.getUniformLocation(program, name);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE1);
    firstTex = clips.map(() => texture(gl.LINEAR));
    hasFirst = clips.map(() => false);
    gl.activeTexture(gl.TEXTURE2);
    atlasTex = texture(gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    videoTex = texture(gl.LINEAR);
    gl.uniform1i(loc.uVideo, 0);
    gl.uniform1i(loc.uFirst, 1);
    gl.uniform1i(loc.uAtlas, 2);
    gl.uniform1f(loc.uGlyphs, RAMP.length);
    hasFrame = fresh = false;
    lastTime = -1;
  }

  // One glyph per slot, drawn at the exact device-pixel size of a cell so it maps 1:1.
  function buildAtlas() {
    if (!cw) return;
    const rows = Math.ceil(RAMP.length / ATLAS_COLS);
    const c = document.createElement('canvas');
    c.width = atlasW = ATLAS_COLS * cw;
    c.height = atlasH = rows * ch;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `400 ${cw * 1.02}px "Geist Mono", ui-monospace, Menlo, Consolas, monospace`;
    [...RAMP].forEach((glyph, i) => {
      g.fillText(glyph, (i % ATLAS_COLS + 0.5) * cw, (Math.floor(i / ATLAS_COLS) + 0.5) * ch + ch * 0.04);
    });
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    dirty = true;
  }

  function upload(tex, unit, source) {
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  // Text blocks, merged when close so the cleared areas don't leave thin slivers between
  // them, plus the nav text. Stored in device px.
  function measure() {
    const boxes = [];
    const found = [...document.querySelectorAll('[data-avoid]')].map((el) => el.getBoundingClientRect()).filter((b) => b.width && b.height);
    for (const b of found.sort((p, q) => p.top - q.top)) {
      const m = boxes.find((o) => b.top - o.bottom < MERGE_GAP && b.left - o.right < MERGE_GAP && o.left - b.right < MERGE_GAP);
      if (m) {
        m.left = Math.min(m.left, b.left);
        m.right = Math.max(m.right, b.right);
        m.bottom = Math.max(m.bottom, b.bottom);
      } else {
        boxes.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
      }
    }
    for (const el of document.querySelectorAll('[data-dim]')) {
      const kids = [...el.children].map((k) => k.getBoundingClientRect()).filter((b) => b.width && b.height);
      if (!kids.length) continue;
      boxes.push({
        left: Math.min(...kids.map((b) => b.left)), top: Math.min(...kids.map((b) => b.top)),
        right: Math.max(...kids.map((b) => b.right)), bottom: Math.max(...kids.map((b) => b.bottom)),
      });
    }
    rects.fill(0);
    boxes.slice(0, RECTS).forEach((b, i) => rects.set([b.left * dpr, b.top * dpr, b.right * dpr, b.bottom * dpr], i * 4));
    // On narrow screens the text spans the page and covers the lower half, where the bikes
    // ride, so the clip is fitted into the space above the text instead of the whole screen.
    const span = found.length ? Math.max(...found.map((b) => b.right)) - Math.min(...found.map((b) => b.left)) : 0;
    textTop = span > 0.6 * W ? Math.min(...found.map((b) => b.top)) * dpr : 0;
    dirty = true;
    schedule();
  }

  function readTheme() {
    const m = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().match(/^#(\w\w)(\w\w)(\w\w)$/);
    if (m) bg = m.slice(1).map((x) => parseInt(x, 16));
    dark = bg[0] + bg[1] + bg[2] < 384;
    dirty = true;
    schedule();
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Fine cells, each glyph about 60% of its width; whole device pixels keep them crisp.
    const css = clamp(Math.round(W / 240), 4, 7);
    cw = Math.max(4, Math.round(css * dpr));
    ch = Math.round(cw * 1.45);
    buildAtlas();
    measure();
  }

  // Height of the area the clip covers: the whole canvas, or the space above the text.
  function fitHeight() {
    return textTop ? clamp(textTop + 2 * ch, 0.45 * canvas.height, canvas.height) : canvas.height;
  }

  // Cover fit: crop the clip to the shape of its area around FOCUS.
  function crop(fit) {
    const va = (video.videoWidth || 16) / (video.videoHeight || 9);
    const fa = canvas.width / fit;
    let ox = 0, oy = 0, sx = 1, sy = 1;
    if (fa > va) {
      sy = va / fa;
      oy = (1 - sy) * FOCUS[1];
    } else {
      sx = fa / va;
      ox = (1 - sx) * FOCUS[0];
    }
    return [ox, oy, sx / canvas.width, sy / fit];
  }

  // Strength of each trail point, newest first; true while any is still visible.
  function updateTrail(now) {
    while (trail.length && now - trail[0].t > TRAIL_LIFE) trail.shift();
    trailData.fill(0);
    trail.slice(-TRAIL).reverse().forEach((p, i) => {
      trailData.set([p.x * dpr, p.y * dpr, 1 - smooth(0, TRAIL_LIFE, now - p.t)], i * 3);
    });
    return trail.length > 0;
  }

  function draw(now) {
    if (!hasFrame || !W) return;
    const look = dark ? LOOKS.dark : LOOKS.light;
    // Toward the end of a clip, dissolve into the next clip's first frame. Just after a
    // switch, hold that frame until the new clip shows its own.
    const next = nextIndex(), dur = video.duration;
    const first = fresh ? next : cur;
    const seam = !fresh ? (hasFirst[cur] ? 1 : 0)
      : hasFirst[next] && dur > SEAM * 2 ? smooth(dur - SEAM, dur - 0.03, video.currentTime) : 0;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, firstTex[first]);
    gl.uniform2f(loc.uView, canvas.width, canvas.height);
    gl.uniform2f(loc.uCell, cw, ch);
    gl.uniform2f(loc.uAtlasSize, atlasW, atlasH);
    const fit = fitHeight();
    gl.uniform4fv(loc.uCrop, crop(fit));
    gl.uniform1f(loc.uFit, fit);
    gl.uniform1f(loc.uSeam, seam);
    gl.uniform3f(loc.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    gl.uniform1f(loc.uDark, dark ? 1 : 0);
    gl.uniform4f(loc.uLook, look.tile, look.glyph, look.color, look.trail);
    gl.uniform1f(loc.uTone, look.tone);
    gl.uniform1f(loc.uPad, Math.max(3 * ch, 36 * dpr));
    gl.uniform1f(loc.uUnder, look.under);
    gl.uniform1f(loc.uRadius, 64 * dpr);
    gl.uniform4fv(loc.uRects, rects);
    updateTrail(now);
    gl.uniform3fv(loc.uTrail, trailData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = false;
    if (!canvas.classList.contains('ready')) canvas.classList.add('ready');
  }

  function frame(now) {
    raf = 0;
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      upload(videoTex, gl.TEXTURE0, video);
      lastTime = video.currentTime;
      hasFrame = fresh = true;
      dirty = true;
    }
    const trailLive = updateTrail(now);
    if (dirty || trailLive) draw(now);
    if (!video.paused || trailLive) schedule();
  }

  function schedule() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function play() {
    if (reduceMotion.matches || document.hidden) return;
    video.play().then(schedule, () => {
      // Autoplay was refused (e.g. low-power mode): start on the first interaction instead.
      const retry = () => {
        removeEventListener('pointerdown', retry);
        removeEventListener('keydown', retry);
        play();
      };
      addEventListener('pointerdown', retry, { once: true });
      addEventListener('keydown', retry, { once: true });
    });
  }

  // Reduced motion: hold one frame (in the first clip, bikes leaning into the corner).
  function still() {
    video.pause();
    if (video.readyState >= 1) video.currentTime = Math.min(STILL_AT, (video.duration || STILL_AT) - 0.1);
  }

  function preloadNext() {
    const v = clips[nextIndex()];
    if (v.preload === 'auto') return;
    v.preload = 'auto';
    if (v.readyState === 0) v.load();
  }

  // Move on to the next clip; the one that ended is rewound, ready for its next turn.
  function advance() {
    const done = video;
    cur = nextIndex();
    video = clips[cur];
    fresh = false;
    lastTime = -1;
    done.currentTime = 0;
    play();
    preloadNext();
    schedule();
  }

  clips.forEach((v, i) => {
    v.addEventListener('loadeddata', () => {
      // Each clip's first decoded frame is kept for the dissolve into it.
      if (!hasFirst[i] && v.currentTime < 0.05) {
        upload(firstTex[i], gl.TEXTURE1, v);
        hasFirst[i] = true;
      }
      if (v !== video) return;
      if (reduceMotion.matches) still();
      else play();
      schedule();
    });
    v.addEventListener('seeked', schedule);
    v.addEventListener('playing', () => {
      if (v !== video) return;
      preloadNext();
      schedule();
    });
    v.addEventListener('ended', () => {
      if (v === video && clips.length > 1) advance();
    });
  });

  // The newest trail point follows the pointer; a new one is dropped every TRAIL_EVERY ms.
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || reduceMotion.matches) return;
    const now = performance.now();
    const head = trail[trail.length - 1];
    if (head && now - head.t < TRAIL_EVERY) {
      head.x = e.clientX;
      head.y = e.clientY;
    } else {
      trail.push({ x: e.clientX, y: e.clientY, t: now });
      if (trail.length > TRAIL) trail.shift();
    }
    schedule();
  }, { passive: true });
  addEventListener('resize', resize);
  addEventListener('scroll', measure, { passive: true });
  // Text blocks settle once their entrance animations end.
  document.addEventListener('animationend', (e) => {
    if (e.target instanceof Element && e.target.matches('[data-avoid]')) measure();
  });
  document.addEventListener('themechange', readTheme);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
    else play();
    schedule();
  });
  reduceMotion.addEventListener('change', () => {
    trail.length = 0;
    if (reduceMotion.matches) still();
    else play();
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    setup();
    resize();
    schedule();
  });
  // Glyphs need the web font.
  document.fonts?.load('400 16px "Geist Mono"').then(buildAtlas, () => {});

  setup();
  readTheme();
  resize();
})();
