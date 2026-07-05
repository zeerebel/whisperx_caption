/* render.js — ONE canvas caption renderer shared by the live preview and every
 * exporter, so preview == export. Also holds the easing library and the
 * animation engine.
 *
 *   WXC.render.drawCaption(ctx, cue, style, t, W, H, anim)
 *
 *  - ctx  : a 2D context created with { alpha:true }
 *  - cue  : { start, end, words:[{start,end,word}]|null, text }
 *  - style: normalized style object (see app.js buildRenderStyle)
 *  - t    : playhead seconds
 *  - W,H  : target pixel size (preview = css*dpr, export = exact resolution)
 *  - anim : { id, speed, intensity }
 *
 * The caption canvas is ALWAYS cleared to full transparency — the background
 * (checkerboard / chroma / image) lives on a separate layer so alpha survives.
 */
(function () {
  const WXC = (window.WXC = window.WXC || {});

  // ---------------- easing ----------------
  const EASE = {
    linear: (t) => t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outBack: (t) => {
      const s = 1.70158, c3 = s + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    },
    outElastic: (t) => {
      if (t === 0) return 0;
      if (t === 1) return 1;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    outBounce: (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
      if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
      t -= 2.625 / d1; return n1 * t * t + 0.984375;
    },
    pulse: (t) => Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)),
  };

  // ---------------- animation catalog ----------------
  // scope 'line' = whole caption block; 'word' = per-word reveal.
  const ANIMATIONS = [
    { id: "none", label: "None", scope: "line" },
    { id: "fade-in", label: "Fade In", scope: "line" },
    { id: "slide-up", label: "Slide Up", scope: "line" },
    { id: "slide-down", label: "Slide Down", scope: "line" },
    { id: "pop-scale-in", label: "Pop (Overshoot)", scope: "line" },
    { id: "bounce-in", label: "Bounce In", scope: "line" },
    { id: "zoom-in", label: "Zoom In", scope: "line" },
    { id: "blur-in", label: "Blur In", scope: "line" },
    { id: "rise-float", label: "Rise / Float", scope: "line" },
    { id: "wipe-reveal", label: "Wipe Reveal", scope: "line" },
    { id: "typewriter", label: "Typewriter", scope: "line" },
    { id: "shake", label: "Shake", scope: "line" },
    { id: "color-flash", label: "Color Flash", scope: "line" },
    { id: "drop-in-gravity", label: "Drop In (Gravity)", scope: "line" },
    { id: "word-pop-in", label: "Word Pop In", scope: "word" },
    { id: "word-fade-cascade", label: "Word Fade Cascade", scope: "word" },
    { id: "wave", label: "Wave", scope: "word" },
  ];
  const SCOPE = {};
  ANIMATIONS.forEach((a) => (SCOPE[a.id] = a.scope));

  // Whole-block transform for line-scope animations.
  // tr = seconds since the cue appeared; k = intensity; sp = speed; fontPx for scale-relative moves.
  function lineTransform(id, tr, k, sp, fontPx) {
    const T = (d) => Math.min(Math.max(tr / (d / sp), 0), 1);
    const I = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, blur: 0, clip: 1, flash: 0, chars: null };
    switch (id) {
      case "fade-in": I.alpha = EASE.outCubic(T(0.25)); break;
      case "slide-up": { const e = EASE.outCubic(T(0.3)); I.dy = (1 - e) * fontPx * 1.1 * k; I.alpha = e; break; }
      case "slide-down": { const e = EASE.outCubic(T(0.3)); I.dy = -(1 - e) * fontPx * 1.1 * k; I.alpha = e; break; }
      case "pop-scale-in": { const p = T(0.35); const e = EASE.outBack(p); I.sx = I.sy = 0.6 + 0.4 * e; I.alpha = EASE.outCubic(p); break; }
      case "bounce-in": { const p = T(0.6); const s = p <= 0 ? 0 : EASE.outElastic(p); I.sx = I.sy = s; I.alpha = Math.min(1, p * 3); break; }
      case "zoom-in": { const e = EASE.outCubic(T(0.4)); I.sx = I.sy = 1 + 0.6 * k * (1 - e); I.alpha = e; break; }
      case "blur-in": { const e = EASE.outCubic(T(0.35)); I.alpha = e; I.blur = (1 - e) * 10 * k; break; }
      case "rise-float": { const e = EASE.outCubic(T(0.5)); I.dy = (1 - e) * 26 * k + Math.sin(tr * 2 * Math.PI / 3) * 4 * k; I.alpha = e; break; }
      case "wipe-reveal": I.clip = EASE.inOutQuad(T(0.35)); break;
      case "typewriter": I.chars = T(Math.max(0.4, 0.05 * 24)); break; // reveal fraction 0..1 over ~1.2s
      case "shake": { const amp = EASE.pulse(T(0.3)) * 7 * k; I.dx = Math.sin(tr * 42) * amp; I.dy = Math.cos(tr * 55) * amp * 0.6; break; }
      case "color-flash": I.flash = EASE.pulse(T(0.4)); break;
      case "drop-in-gravity": { const p = T(0.6); const e = EASE.outBounce(p); I.dy = (1 - e) * -90 * k; I.alpha = p > 0 ? 1 : 0; break; }
      default: break;
    }
    return I;
  }

  // Per-word transform for word-scope animations.
  function wordTransform(id, i, tr, k, sp) {
    const W = { dx: 0, dy: 0, sx: 1, sy: 1, alpha: 1 };
    switch (id) {
      case "word-pop-in": {
        const stag = 0.08 / sp;
        const p = Math.min(Math.max((tr - i * stag) / (0.3 / sp), 0), 1);
        const e = EASE.outBack(p);
        W.sx = W.sy = 0.5 + 0.5 * e; W.alpha = EASE.outCubic(p);
        break;
      }
      case "word-fade-cascade": {
        const stag = 0.1 / sp;
        const p = Math.min(Math.max((tr - i * stag) / (0.25 / sp), 0), 1);
        const e = EASE.outCubic(p);
        W.alpha = e; W.dy = (1 - e) * 9 * k;
        break;
      }
      case "wave": {
        const env = Math.min(Math.max(tr / 0.4, 0), 1);
        W.dy = Math.sin(tr * 2 * Math.PI * 0.8 + i * 0.6) * 8 * k * env;
        break;
      }
      default: break;
    }
    return W;
  }

  // ---------------- color helpers ----------------
  function lerpHex(a, b, t) {
    const pa = hexRgb(a), pb = hexRgb(b);
    const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
    const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
    const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }
  function hexRgb(h) {
    h = h.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function applyTransform(text, mode) {
    switch (mode) {
      case "uppercase": return text.toUpperCase();
      case "lowercase": return text.toLowerCase();
      case "capitalize": return text.replace(/\b\w/g, (c) => c.toUpperCase());
      default: return text;
    }
  }

  // ---------------- layout ----------------
  function layout(ctx, cue, style, W, H, scale) {
    const fontPx = style.size * scale;
    const tracking = style.tracking * scale;
    const lineHeightPx = fontPx * style.lineHeight;
    ctx.font = `${style.weight} ${fontPx}px ${style.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    try { ctx.letterSpacing = tracking + "px"; } catch (e) {}

    // tokens in spoken order
    let tokens;
    if (cue.words && cue.words.length) {
      tokens = cue.words.map((w, i) => ({ text: applyTransform(w.word, style.transform), start: w.start, end: w.end, i }));
    } else {
      tokens = applyTransform(cue.text || "", style.transform)
        .split(/\s+/).filter(Boolean)
        .map((tx, i) => ({ text: tx, start: cue.start, end: cue.end, i }));
    }

    const spaceW = ctx.measureText(" ").width;
    const marginXpx = (style.marginX / 100) * W;
    const wrapWidth = Math.min((style.maxWidth / 100) * W, W - 2 * marginXpx);

    const lines = [];
    let cur = [];
    let curW = 0;
    for (const tk of tokens) {
      tk.w = ctx.measureText(tk.text).width;
      const add = (cur.length ? spaceW : 0) + tk.w;
      if (cur.length && curW + add > wrapWidth) {
        lines.push({ tokens: cur, width: curW });
        cur = []; curW = 0;
      }
      curW += (cur.length ? spaceW : 0) + tk.w;
      cur.push(tk);
    }
    if (cur.length) lines.push({ tokens: cur, width: curW });

    const blockHeight = lines.length * lineHeightPx;
    const marginYpx = (style.marginY / 100) * H;
    let blockTop;
    if (style.vAlign === "top") blockTop = marginYpx;
    else if (style.vAlign === "middle") blockTop = (H - blockHeight) / 2;
    else blockTop = H - marginYpx - blockHeight;

    let boxLeft = Infinity, boxRight = -Infinity;
    lines.forEach((ln, li) => {
      let startX;
      if (style.hAlign === "left") startX = marginXpx;
      else if (style.hAlign === "right") startX = W - marginXpx - ln.width;
      else startX = (W - ln.width) / 2;
      ln.baselineY = blockTop + li * lineHeightPx + fontPx * 0.8;
      let x = startX;
      for (const tk of ln.tokens) {
        tk.x = x;
        x += tk.w + spaceW;
      }
      boxLeft = Math.min(boxLeft, startX);
      boxRight = Math.max(boxRight, startX + ln.width);
    });

    return { lines, fontPx, tracking, lineHeightPx, blockTop, blockHeight, boxLeft, boxRight, spaceW };
  }

  // ---------------- main draw ----------------
  function drawCaption(ctx, cue, style, t, W, H, anim) {
    ctx.clearRect(0, 0, W, H);
    if (!cue) return;
    if (t < cue.start || t > cue.end) return;

    anim = anim || { id: "none", speed: 1, intensity: 1 };
    const sp = anim.speed || 1;
    const k = anim.intensity == null ? 1 : anim.intensity;
    const scale = H / 1080;
    const strokePx = style.outline * scale;
    const shadowPx = style.shadow * scale;
    const padPx = style.boxPad * scale;
    const radiusPx = style.boxRadius * scale;

    const L = layout(ctx, cue, style, W, H, scale);
    if (!L.lines.length) return;

    const tr = t - cue.start;
    const scope = SCOPE[anim.id] || "line";
    const line = scope === "line" ? lineTransform(anim.id, tr, k, sp, L.fontPx) : { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, blur: 0, clip: 1, flash: 0, chars: null };

    const cx = (L.boxLeft + L.boxRight) / 2;
    const cy = L.blockTop + L.blockHeight / 2;

    ctx.save();
    // line-level transform around block center
    ctx.translate(cx, cy);
    if (line.rot) ctx.rotate(line.rot);
    ctx.scale(line.sx, line.sy);
    ctx.translate(-cx + line.dx, -cy + line.dy);
    ctx.globalAlpha = line.alpha;
    if (line.blur > 0.1 && "filter" in ctx) ctx.filter = `blur(${line.blur}px)`;

    // box
    if (style.boxOpacity > 0.02) {
      ctx.save();
      ctx.globalAlpha = line.alpha * style.boxOpacity;
      ctx.fillStyle = style.boxColor;
      roundRectPath(ctx, L.boxLeft - padPx, L.blockTop - padPx, L.boxRight - L.boxLeft + 2 * padPx, L.blockHeight + 2 * padPx, radiusPx);
      ctx.fill();
      ctx.restore();
    }

    // optional wipe clip (text only, box already drawn)
    ctx.save();
    if (anim.id === "wipe-reveal" && line.clip < 1) {
      const w = (L.boxRight - L.boxLeft) * line.clip;
      ctx.beginPath();
      ctx.rect(L.boxLeft - padPx, L.blockTop - padPx, w + padPx, L.blockHeight + 2 * padPx);
      ctx.clip();
    }
    if ("filter" in ctx && line.blur > 0.1) ctx.filter = `blur(${line.blur}px)`;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // typewriter: how many characters to reveal across the whole cue
    let charsLeft = Infinity;
    if (anim.id === "typewriter" && line.chars != null) {
      const total = L.lines.reduce((s, ln) => s + ln.tokens.reduce((a, tk) => a + tk.text.length + 1, 0), 0);
      charsLeft = Math.floor(line.chars * total);
    }

    for (const ln of L.lines) {
      for (const tk of ln.tokens) {
        let text = tk.text;
        if (charsLeft !== Infinity) {
          if (charsLeft <= 0) { charsLeft -= text.length + 1; continue; }
          if (charsLeft < text.length) text = text.slice(0, charsLeft);
          charsLeft -= tk.text.length + 1;
        }
        // fill color (karaoke + color-flash)
        let fill = style.textColor;
        if (style.karaoke && cue.words && t >= tk.start) fill = style.activeColor;
        if (line.flash > 0) fill = lerpHex(fill, style.activeColor, line.flash);

        const wt = scope === "word" ? wordTransform(anim.id, tk.i, tr, k, sp) : null;
        ctx.save();
        if (wt) {
          const wcx = tk.x + tk.w / 2, wcy = ln.baselineY - L.fontPx * 0.35;
          ctx.translate(wcx, wcy);
          ctx.scale(wt.sx, wt.sy);
          ctx.translate(-wcx + wt.dx, -wcy + wt.dy);
          ctx.globalAlpha *= wt.alpha;
        }
        if (ctx.globalAlpha <= 0.003) { ctx.restore(); continue; }

        // shadow pass (silhouette of the outlined glyph), then crisp passes
        if (shadowPx > 0) {
          ctx.save();
          ctx.shadowColor = style.shadowColor;
          ctx.shadowBlur = shadowPx;
          ctx.shadowOffsetX = shadowPx * 0.35;
          ctx.shadowOffsetY = shadowPx * 0.5;
          if (strokePx > 0) {
            ctx.lineWidth = 2 * strokePx;
            ctx.strokeStyle = style.outlineColor;
            ctx.strokeText(text, tk.x, ln.baselineY);
          } else {
            ctx.fillStyle = fill;
            ctx.fillText(text, tk.x, ln.baselineY);
          }
          ctx.restore();
        }
        if (strokePx > 0) {
          ctx.lineWidth = 2 * strokePx;
          ctx.strokeStyle = style.outlineColor;
          ctx.strokeText(text, tk.x, ln.baselineY);
        }
        ctx.fillStyle = fill;
        ctx.fillText(text, tk.x, ln.baselineY);
        ctx.restore();
      }
    }

    ctx.restore(); // clip/blur wrapper
    ctx.restore(); // line transform
    if ("filter" in ctx) ctx.filter = "none";
    ctx.globalAlpha = 1;
  }

  WXC.render = { drawCaption, ANIMATIONS, EASE, layout };
})();
