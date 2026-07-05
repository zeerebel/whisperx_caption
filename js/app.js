/* app.js — UI, live preview and export wiring for WhisperX Caption Studio. */
(function () {
  const WXC = window.WXC;
  const $ = (id) => document.getElementById(id);

  // Curated caption-friendly Google fonts + system fallbacks.
  const GFONTS = [
    "Inter", "Roboto", "Roboto Condensed", "Open Sans", "Lato", "Montserrat",
    "Poppins", "Raleway", "Nunito", "Rubik", "Barlow", "Barlow Condensed",
    "Oswald", "Bebas Neue", "Anton", "Archivo Black", "Fjalla One", "Kanit",
    "Teko", "Titan One", "Luckiest Guy", "Bungee", "Permanent Marker",
    "Caveat", "Pacifico",
  ];
  const SYSFONTS = {
    "System Sans": "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif",
    "Arial": "Arial,Helvetica,sans-serif",
    "Impact": "Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif",
    "Georgia (serif)": "Georgia,'Times New Roman',serif",
    "Courier (mono)": "'Courier New',ui-monospace,monospace",
  };

  const state = {
    model: null, // { words, segments }
    cues: [],
    duration: 0,
    playing: false,
    t: 0,
    rafClock: null, // fallback clock start
    activeCue: -1,
  };

  const audio = $("audio");
  const stage = $("stage");
  const capBox = $("capBox");
  const capLayer = $("capLayer");

  // ---------- style + timing read from controls ----------
  function readStyle() {
    return {
      font: fontValue($("optFont").value),
      fontName: $("optFont").value,
      size: +$("optSize").value,
      weight: +$("optWeight").value,
      tracking: +$("optTracking").value,
      lineH: +$("optLineH").value,
      transform: $("optTransform").value,
      color: $("optColor").value,
      active: $("optActive").value,
      strokeColor: $("optStrokeColor").value,
      stroke: +$("optStroke").value,
      karaoke: $("optKaraoke").checked,
      box: $("optBox").value,
      boxOpacity: +$("optBoxOpacity").value,
      boxPad: +$("optBoxPad").value,
      boxRadius: +$("optBoxRadius").value,
      shadow: +$("optShadow").value,
      shadowColor: $("optShadowColor").value,
      vAlign: $("optVAlign").value,
      hAlign: $("optHAlign").value,
      marginX: +$("optMarginX").value,
      marginY: +$("optMarginY").value,
      maxWidth: +$("optMaxWidth").value,
    };
  }
  function readTiming() {
    return {
      maxWords: +$("optMaxWords").value,
      maxChars: +$("optMaxChars").value,
      maxDur: +$("optMaxDur").value,
      maxGap: +$("optMaxGap").value,
      punct: $("optPunct").checked,
    };
  }

  const loadedGFonts = new Set();
  const customFonts = new Set(); // user-uploaded typefaces
  function fontValue(name) {
    if (name === "__upload" || !name) return "sans-serif";
    if (SYSFONTS[name]) return SYSFONTS[name];
    if (customFonts.has(name)) return `'${name}', sans-serif`;
    ensureGFont(name);
    return `'${name}', sans-serif`;
  }
  function ensureGFont(name) {
    if (loadedGFonts.has(name)) return;
    loadedGFonts.add(name);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=" +
      encodeURIComponent(name).replace(/%20/g, "+") +
      ":wght@400;500;600;700;800;900&display=swap";
    document.head.appendChild(link);
  }

  function buildFontList() {
    const sel = $("optFont");
    const og1 = document.createElement("optgroup");
    og1.label = "Google Fonts";
    GFONTS.forEach((f) => og1.appendChild(new Option(f, f)));
    const og2 = document.createElement("optgroup");
    og2.label = "System";
    Object.keys(SYSFONTS).forEach((f) => og2.appendChild(new Option(f, f)));
    const ogU = document.createElement("optgroup");
    ogU.label = "Custom";
    ogU.id = "customFontGroup";
    ogU.appendChild(new Option("Upload font…", "__upload"));
    sel.appendChild(og1);
    sel.appendChild(og2);
    sel.appendChild(ogU);
    sel.value = "Inter";
  }

  // Load a user font file, register it, and add it to the picker.
  function loadFontFile(file) {
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Custom Font";
    const fr = new FileReader();
    fr.onload = () => {
      const face = new FontFace(name, fr.result);
      face
        .load()
        .then((f) => {
          document.fonts.add(f);
          customFonts.add(name);
          const grp = document.getElementById("customFontGroup");
          if (![...grp.children].some((o) => o.value === name))
            grp.insertBefore(new Option(name, name), grp.firstChild);
          $("optFont").value = name;
          applyStyle();
          saveStyle();
          toast("✓ Font “" + name + "” added");
        })
        .catch(() => toast("⚠️ Could not read that font file"));
    };
    fr.readAsArrayBuffer(file);
  }

  // ---------- apply visual style to the preview caption ----------
  function applyStyle() {
    const s = readStyle();
    // preview font scales relative to the 1080p reference the size is authored at
    const scale = stage.clientHeight / 1080;
    capBox.style.fontFamily = s.font;
    capBox.style.fontSize = s.size * scale + "px";
    capBox.style.fontWeight = s.weight;
    capBox.style.letterSpacing = s.tracking * scale + "px";
    capBox.style.lineHeight = s.lineH;
    capBox.style.textTransform = s.transform;
    capBox.style.maxWidth = s.maxWidth + "%";
    capBox.style.color = s.color;
    capBox.style.textAlign = s.hAlign;
    capBox.style.setProperty("--ink-c", s.color);
    capBox.style.setProperty("--active", s.active);

    // outline via layered text-shadow + optional drop shadow
    const shadows = [];
    const w = Math.max(0, s.stroke * scale);
    if (w > 0) {
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        shadows.push(`${Math.cos(a) * w}px ${Math.sin(a) * w}px 0 ${s.strokeColor}`);
      }
    }
    if (s.shadow > 0)
      shadows.push(`${s.shadow * scale}px ${s.shadow * scale}px ${s.shadow * scale}px ${s.shadowColor}`);
    capBox.style.textShadow = shadows.join(",");

    // box
    if (s.boxOpacity > 0.02) {
      capBox.style.background = hexA(s.box, s.boxOpacity);
      capBox.style.padding = s.boxPad * scale + "px " + s.boxPad * 1.4 * scale + "px";
      capBox.style.borderRadius = s.boxRadius * scale + "px";
    } else {
      capBox.style.background = "transparent";
      capBox.style.padding = "0";
    }

    // layer alignment
    capLayer.style.alignItems =
      s.vAlign === "top" ? "flex-start" : s.vAlign === "middle" ? "center" : "flex-end";
    capLayer.style.justifyContent =
      s.hAlign === "left" ? "flex-start" : s.hAlign === "right" ? "flex-end" : "center";
    const px = (s.marginX / 100) * stage.clientWidth;
    const py = (s.marginY / 100) * stage.clientHeight;
    capLayer.style.padding = `${py}px ${px}px`;

    renderCaption(true);
  }

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }

  // ---------- rebuild cues from current timing options ----------
  function rebuildCues() {
    if (!state.model) return;
    state.cues = WXC.buildCues(state.model, readTiming());
    state.duration =
      (state.cues.length ? state.cues[state.cues.length - 1].end : 0) + 1.5;
    if (audio.src && audio.duration) state.duration = Math.max(state.duration, audio.duration);
    renderCueStrip();
    renderCaption(true);
    updateTimeUI();
    setExportEnabled(state.cues.length > 0);
  }

  // ---------- caption rendering ----------
  let lastCueIdx = -2;
  let lastCueRef = null;
  function renderCaption(force) {
    const t = state.t;
    let idx = -1;
    for (let i = 0; i < state.cues.length; i++) {
      if (t >= state.cues[i].start && t <= state.cues[i].end) { idx = i; break; }
    }
    const s = readStyle();
    const cue = idx >= 0 ? state.cues[idx] : null;

    if (idx !== lastCueIdx || cue !== lastCueRef || force) {
      lastCueIdx = idx;
      lastCueRef = cue;
      capBox.innerHTML = "";
      stage.classList.toggle("has-cap", !!state.model);
      if (!cue) {
        capBox.style.visibility = "hidden";
      } else {
        capBox.style.visibility = "visible";
        if (s.karaoke && cue.words) {
          cue.words.forEach((w, j) => {
            const span = document.createElement("span");
            span.className = "w";
            span.textContent = w.word + (j < cue.words.length - 1 ? " " : "");
            capBox.appendChild(span);
          });
        } else {
          capBox.textContent = cue.text;
        }
      }
      highlightCueRow(idx);
    }
    // sweep the highlight word-by-word: each word turns to the active color as
    // it's spoken and stays (cumulative karaoke fill, matching the ASS \kf export)
    if (cue && s.karaoke && cue.words) {
      const spans = capBox.children;
      for (let j = 0; j < cue.words.length; j++) {
        if (spans[j]) spans[j].classList.toggle("on", t >= cue.words[j].start);
      }
    }
  }

  // ---------- cue strip ----------
  function renderCueStrip() {
    const strip = $("cueStrip");
    strip.innerHTML = "";
    state.cues.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "cue-row";
      row.dataset.i = i;
      row.innerHTML = `<span class="t">${fmt(c.start)}</span><span class="x"></span>`;
      row.querySelector(".x").textContent = c.text;
      row.addEventListener("click", () => seek(c.start + 0.01));
      strip.appendChild(row);
    });
  }
  function highlightCueRow(idx) {
    const rows = $("cueStrip").children;
    for (let i = 0; i < rows.length; i++) rows[i].classList.toggle("active", i === idx);
    if (idx >= 0 && rows[idx]) {
      const r = rows[idx];
      const strip = $("cueStrip");
      if (r.offsetTop < strip.scrollTop || r.offsetTop > strip.scrollTop + strip.clientHeight - 30)
        strip.scrollTop = r.offsetTop - strip.clientHeight / 2;
    }
  }

  // ---------- clock ----------
  function tick() {
    if (audio.src) state.t = audio.currentTime;
    else if (state.playing) {
      state.t = (performance.now() - state.rafClock) / 1000;
      if (state.t >= state.duration) { state.t = state.duration; pause(); }
    }
    renderCaption(false);
    updateTimeUI();
    if (state.playing) requestAnimationFrame(tick);
  }
  function play() {
    if (!state.cues.length) return;
    state.playing = true;
    $("playBtn").textContent = "⏸";
    if (audio.src) audio.play();
    else state.rafClock = performance.now() - state.t * 1000;
    requestAnimationFrame(tick);
  }
  function pause() {
    state.playing = false;
    $("playBtn").textContent = "▶";
    if (audio.src) audio.pause();
  }
  function seek(t) {
    state.t = Math.max(0, Math.min(t, state.duration));
    if (audio.src) audio.currentTime = state.t;
    else if (state.playing) state.rafClock = performance.now() - state.t * 1000;
    renderCaption(true);
    updateTimeUI();
  }
  function updateTimeUI() {
    $("timeNow").textContent = fmt(state.t);
    $("timeTotal").textContent = fmt(state.duration);
    const sc = $("scrubber");
    if (!sc.matches(":active")) sc.value = state.duration ? (state.t / state.duration) * 1000 : 0;
  }
  function fmt(t) {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1).padStart(4, "0");
    return `${m}:${s}`;
  }

  // ---------- file loading ----------
  function loadTranscriptText(name, text) {
    try {
      state.model = WXC.parse(name, text);
    } catch (e) {
      return toast("⚠️ " + e.message);
    }
    const nw = state.model.words ? state.model.words.length : 0;
    const ns = state.model.segments ? state.model.segments.length : 0;
    $("srcInfo").textContent = nw
      ? `Loaded ${nw} timed words → grouping into caption lines.`
      : ns
      ? `Loaded ${ns} caption blocks (no per-word timing → karaoke off).`
      : "No usable captions found in that file.";
    seek(0);
    rebuildCues();
    toast("✓ Transcript loaded");
  }
  function readFile(file, cb) {
    const fr = new FileReader();
    fr.onload = () => cb(fr.result);
    fr.readAsText(file);
  }

  // ---------- export ----------
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function baseName() {
    return (state.baseName || "captions").replace(/\.[^.]+$/, "");
  }
  function setExportEnabled(on) {
    ["dlSrt", "dlVtt", "dlAss", "dlJson", "copyFfmpeg", "playBtn", "scrubber"].forEach(
      (id) => ($(id).disabled = !on)
    );
  }

  // ---------- presets ----------
  const STYLE_KEYS = [
    "optFont", "optSize", "optWeight", "optTracking", "optLineH", "optTransform",
    "optColor", "optActive", "optStrokeColor", "optStroke", "optKaraoke",
    "optBox", "optBoxOpacity", "optBoxPad", "optBoxRadius", "optShadow", "optShadowColor",
    "optVAlign", "optHAlign", "optMarginX", "optMarginY", "optMaxWidth",
    "optMaxWords", "optMaxChars", "optMaxDur", "optMaxGap", "optPunct",
    "optExportKaraoke", "optBackdrop",
  ];
  function saveStyle() {
    const o = {};
    STYLE_KEYS.forEach((id) => {
      const el = $(id);
      o[id] = el.type === "checkbox" ? el.checked : el.value;
    });
    try { localStorage.setItem("wxc.style", JSON.stringify(o)); } catch (e) {}
  }
  function loadStyle() {
    let o;
    try { o = JSON.parse(localStorage.getItem("wxc.style")); } catch (e) {}
    if (!o) return;
    STYLE_KEYS.forEach((id) => {
      if (o[id] === undefined) return;
      const el = $(id);
      if (el.type === "checkbox") el.checked = o[id];
      else el.value = o[id];
    });
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- wiring ----------
  function wire() {
    buildFontList();
    loadStyle();

    // any control change re-applies style; timing controls also rebuild cues
    document.querySelectorAll(".panel input, .panel select").forEach((el) => {
      el.addEventListener("input", () => {
        const timing = ["optMaxWords", "optMaxChars", "optMaxDur", "optMaxGap", "optPunct"].includes(el.id);
        if (timing) rebuildCues();
        applyStyle();
        saveStyle();
      });
    });

    $("fileJson").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      state.baseName = f.name;
      readFile(f, (txt) => loadTranscriptText(f.name, txt));
    });
    $("fileAudio").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      audio.src = URL.createObjectURL(f);
      audio.onloadedmetadata = () => { rebuildCues(); toast("✓ Audio synced"); };
    });
    $("fileBg").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      $("stageBg").style.background = `url(${URL.createObjectURL(f)}) center/cover no-repeat`;
    });
    $("optBackdrop").addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "custom") { $("fileBg").click(); return; }
      $("stageBg").style.background = v;
    });

    // custom font upload via the "Upload font…" menu entry
    let lastFont = $("optFont").value;
    $("optFont").addEventListener("change", (e) => {
      if (e.target.value === "__upload") {
        e.target.value = lastFont;
        applyStyle();
        $("fileFont").click();
      } else lastFont = e.target.value;
    });
    $("fileFont").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) loadFontFile(f);
      e.target.value = "";
    });

    $("playBtn").addEventListener("click", () => (state.playing ? pause() : play()));
    $("scrubber").addEventListener("input", (e) => seek((e.target.value / 1000) * state.duration));

    $("dlSrt").addEventListener("click", () => download(baseName() + ".srt", WXC.formats.toSRT(state.cues)));
    $("dlVtt").addEventListener("click", () =>
      download(baseName() + ".vtt", WXC.formats.toVTT(state.cues, $("optExportKaraoke").checked), "text/vtt"));
    $("dlAss").addEventListener("click", () =>
      download(baseName() + ".ass", WXC.formats.toASS(state.cues, readStyle(), { karaoke: $("optExportKaraoke").checked })));
    $("dlJson").addEventListener("click", () =>
      download(baseName() + ".captions.json", WXC.formats.toJSON(state.cues, readStyle())));
    $("copyFfmpeg").addEventListener("click", copyFfmpeg);

    $("savePreset").addEventListener("click", () => { saveStyle(); toast("✓ Style saved"); });
    $("resetPreset").addEventListener("click", () => {
      try { localStorage.removeItem("wxc.style"); } catch (e) {}
      location.reload();
    });
    $("loadSample").addEventListener("click", loadSample);

    // drag & drop anywhere on the stage
    const dz = $("dropzone");
    ["dragenter", "dragover"].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (e) => {
      for (const f of e.dataTransfer.files) {
        if (/\.(json|srt|vtt|txt)$/i.test(f.name)) { state.baseName = f.name; readFile(f, (t) => loadTranscriptText(f.name, t)); }
        else if (/\.(ttf|otf|woff2?)$/i.test(f.name) || /^font\//.test(f.type)) { loadFontFile(f); }
        else if (/^(audio|video)\//.test(f.type)) { audio.src = URL.createObjectURL(f); audio.onloadedmetadata = () => rebuildCues(); }
        else if (/^image\//.test(f.type)) { $("stageBg").style.background = `url(${URL.createObjectURL(f)}) center/cover no-repeat`; }
      }
    });

    audio.addEventListener("play", () => { if (!state.playing) play(); });
    audio.addEventListener("pause", () => { if (state.playing && audio.currentTime < audio.duration) pause(); });
    window.addEventListener("resize", applyStyle);
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); state.playing ? pause() : play();
      }
    });

    applyStyle();
  }

  function copyFfmpeg() {
    const name = baseName();
    const cmd =
      `# Burn styled captions into a video (needs ffmpeg built with libass):\n` +
      `ffmpeg -i input.mp4 -vf "ass=${name}.ass" -c:a copy output.mp4\n\n` +
      `# Caption a still image + your audio into a video:\n` +
      `ffmpeg -loop 1 -i background.jpg -i input.mp3 -vf "ass=${name}.ass" -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac output.mp4`;
    navigator.clipboard.writeText(cmd).then(
      () => toast("✓ ffmpeg command copied"),
      () => toast(cmd)
    );
  }

  // A tiny built-in WhisperX-shaped sample so the tool is usable with zero setup.
  function loadSample() {
    fetch("sample/sample.whisperx.json")
      .then((r) => r.json())
      .then((d) => { state.baseName = "sample.json"; loadTranscriptText("sample.whisperx.json", JSON.stringify(d)); })
      .catch(() => toast("⚠️ Could not load sample"));
  }

  wire();
})();
