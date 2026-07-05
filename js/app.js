/* app.js — UI, canvas preview and export wiring for WhisperX Caption Studio.
 * Preview and every exporter share WXC.render.drawCaption, so what you see is
 * exactly what you export. */
(function () {
  const WXC = window.WXC;
  const $ = (id) => document.getElementById(id);

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
    model: null,
    cues: [],
    duration: 0,
    playing: false,
    t: 0,
    rafClock: null,
    baseName: null,
    exporting: false,
  };

  const audio = $("audio");
  const stage = $("stage");
  const stageWrap = $("stageWrap");
  const canvas = $("stageCanvas");
  const pctx = canvas.getContext("2d", { alpha: true });

  // ---------- read controls ----------
  function buildRenderStyle() {
    return {
      fontFamily: fontValue($("optFont").value),
      fontName: $("optFont").value,
      size: +$("optSize").value,
      weight: +$("optWeight").value,
      tracking: +$("optTracking").value,
      lineHeight: +$("optLineH").value,
      transform: $("optTransform").value,
      textColor: $("optColor").value,
      activeColor: $("optActive").value,
      karaoke: $("optKaraoke").checked,
      outlineColor: $("optStrokeColor").value,
      outline: +$("optStroke").value,
      boxColor: $("optBox").value,
      boxOpacity: +$("optBoxOpacity").value,
      boxPad: +$("optBoxPad").value,
      boxRadius: +$("optBoxRadius").value,
      shadowColor: $("optShadowColor").value,
      shadow: +$("optShadow").value,
      vAlign: $("optVAlign").value,
      hAlign: $("optHAlign").value,
      marginX: +$("optMarginX").value,
      marginY: +$("optMarginY").value,
      maxWidth: +$("optMaxWidth").value,
    };
  }
  // The ASS/style export format still expects the old field names.
  function readAssStyle() {
    const s = buildRenderStyle();
    return {
      font: s.fontFamily, fontName: s.fontName, size: s.size, weight: s.weight,
      tracking: s.tracking, color: s.textColor, active: s.activeColor,
      strokeColor: s.outlineColor, stroke: s.outline, box: s.boxColor,
      boxOpacity: s.boxOpacity, shadow: s.shadow, shadowColor: s.shadowColor,
      vAlign: s.vAlign, hAlign: s.hAlign, marginX: s.marginX, marginY: s.marginY,
    };
  }
  function readAnim() {
    return { id: $("optAnim").value, speed: +$("optAnimSpeed").value, intensity: +$("optAnimIntensity").value };
  }
  function readTiming() {
    return {
      maxWords: +$("optMaxWords").value, maxChars: +$("optMaxChars").value,
      maxDur: +$("optMaxDur").value, maxGap: +$("optMaxGap").value, punct: $("optPunct").checked,
    };
  }
  function exportRes() { const [w, h] = $("optRes").value.split("x").map(Number); return { w, h }; }
  function exportFps() { return +$("optFps").value; }

  // ---------- fonts ----------
  const loadedGFonts = new Set();
  const customFonts = new Set();
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
    sel.appendChild(og1); sel.appendChild(og2); sel.appendChild(ogU);
    sel.value = "Inter";
  }
  function loadFontFile(file) {
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Custom Font";
    const fr = new FileReader();
    fr.onload = () => {
      const face = new FontFace(name, fr.result);
      face.load().then((f) => {
        document.fonts.add(f);
        customFonts.add(name);
        const grp = $("customFontGroup");
        if (![...grp.children].some((o) => o.value === name)) grp.insertBefore(new Option(name, name), grp.firstChild);
        $("optFont").value = name;
        drawPreview(); saveStyle();
        toast("✓ Font “" + name + "” added");
      }).catch(() => toast("⚠️ Could not read that font file"));
    };
    fr.readAsArrayBuffer(file);
  }
  function buildAnimList() {
    const sel = $("optAnim");
    WXC.render.ANIMATIONS.forEach((a) => sel.appendChild(new Option(a.label, a.id)));
    sel.value = "none";
  }

  // ---------- preview canvas ----------
  function resizePreview() {
    const { w, h } = exportRes();
    stageWrap.style.aspectRatio = `${w} / ${h}`;
    // portrait/square: constrain by height so the frame doesn't overflow;
    // landscape: fill the column width.
    if (h >= w) { stageWrap.style.width = "auto"; stageWrap.style.height = "min(62vh, 620px)"; }
    else { stageWrap.style.width = "100%"; stageWrap.style.height = "auto"; stageWrap.style.maxHeight = "62vh"; }
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    drawPreview();
  }
  function cueAt(t) {
    for (let i = 0; i < state.cues.length; i++)
      if (t >= state.cues[i].start && t <= state.cues[i].end) return state.cues[i];
    return null;
  }
  function cueIndexAt(t) {
    for (let i = 0; i < state.cues.length; i++)
      if (t >= state.cues[i].start && t <= state.cues[i].end) return i;
    return -1;
  }
  function drawPreview() {
    const cue = cueAt(state.t);
    WXC.render.drawCaption(pctx, cue, buildRenderStyle(), state.t, canvas.width, canvas.height, readAnim());
    $("emptyHint").style.display = state.model ? "none" : "";
    highlightCueRow(cueIndexAt(state.t));
  }

  // ---------- background layer ----------
  function bgColor() {
    if ($("optBgMode").value !== "chroma") return null;
    const v = $("optChroma").value;
    return v === "custom" ? $("optChromaCustom").value : v;
  }
  function updateBackground() {
    const bg = $("stageBg");
    const mode = $("optBgMode").value;
    bg.classList.toggle("transparent", mode === "transparent");
    $("chromaRow").style.display = mode === "chroma" ? "" : "none";
    $("optChromaCustom").classList.toggle("hidden", !(mode === "chroma" && $("optChroma").value === "custom"));
    if (mode === "transparent") bg.style.background = "";
    else if (mode === "chroma") bg.style.background = bgColor();
    // image mode background is set when a file is chosen
  }

  // ---------- cues ----------
  function rebuildCues() {
    if (!state.model) return;
    state.cues = WXC.buildCues(state.model, readTiming());
    state.duration = (state.cues.length ? state.cues[state.cues.length - 1].end : 0) + 1.5;
    if (audio.src && audio.duration) state.duration = Math.max(state.duration, audio.duration);
    renderCueStrip();
    drawPreview();
    updateTimeUI();
    setExportEnabled(state.cues.length > 0);
  }
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
      const r = rows[idx], strip = $("cueStrip");
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
    drawPreview();
    updateTimeUI();
    if (state.playing) requestAnimationFrame(tick);
  }
  function play() {
    if (!state.cues.length || state.exporting) return;
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
    drawPreview();
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
    try { state.model = WXC.parse(name, text); }
    catch (e) { return toast("⚠️ " + e.message); }
    const nw = state.model.words ? state.model.words.length : 0;
    const ns = state.model.segments ? state.model.segments.length : 0;
    $("srcInfo").textContent = nw
      ? `Loaded ${nw} timed words → grouping into caption lines.`
      : ns ? `Loaded ${ns} caption blocks (no per-word timing → karaoke off).`
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

  // ---------- text exports ----------
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function baseName() { return (state.baseName || "captions").replace(/\.[^.]+$/, ""); }
  function setExportEnabled(on) {
    ["dlSrt", "dlVtt", "dlAss", "dlJson", "copyFfmpeg", "playBtn", "scrubber",
     "dlPngSeq", "dlPngFrame", "dlWebm"].forEach((id) => ($(id).disabled = !on));
  }
  function setExportBusy(b) {
    state.exporting = b;
    ["dlPngSeq", "dlPngFrame", "dlWebm", "playBtn"].forEach((id) => ($(id).disabled = b || !state.cues.length));
  }

  // ---------- transparent exporters ----------
  async function ensureFontsForExport(style, h) {
    try {
      await document.fonts.ready;
      await document.fonts.load(`${style.weight} ${Math.round(style.size * (h / 1080))}px ${style.fontFamily}`, "AaGg0123");
    } catch (e) {}
  }

  async function exportPngSequence() {
    if (!state.cues.length || state.exporting) return;
    const { w, h } = exportRes();
    const fps = exportFps();
    const frameCount = Math.max(1, Math.round(state.duration * fps));
    if (frameCount > 900 &&
        !confirm(`${frameCount} frames at ${w}×${h} is a large export and may use a lot of memory.\n\nTip: lower the FPS or trim the audio for shorter clips. Continue?`))
      return;
    const style = buildRenderStyle();
    const anim = readAnim();
    setExportBusy(true);
    pause();
    await ensureFontsForExport(style, h);
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const octx = off.getContext("2d", { alpha: true });
    const frames = [];
    try {
      for (let i = 0; i < frameCount; i++) {
        const t = i / fps;
        WXC.render.drawCaption(octx, cueAt(t), style, t, w, h, anim);
        const blob = await new Promise((res) => off.toBlob(res, "image/png"));
        frames.push({ name: `cap_${String(i).padStart(5, "0")}.png`, blob });
        if (i % 4 === 0) {
          $("exportProgress").textContent = `Rendering frame ${i + 1} / ${frameCount}…`;
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      const readme =
        `WhisperX Caption Studio — transparent caption frames\n` +
        `fps: ${fps}\nresolution: ${w}x${h}\nframes: ${frameCount}\n\n` +
        `Import as an image sequence and set the frame rate to ${fps}.\n` +
        `Premiere: File > Import > select cap_00000.png > tick "Image Sequence".\n` +
        `After Effects / Resolve / Final Cut: import the folder as a PNG sequence.\n` +
        `The alpha channel is preserved — drop it straight over your footage.\n`;
      frames.push({ name: "README.txt", blob: new Blob([readme], { type: "text/plain" }) });
      $("exportProgress").textContent = "Packaging .zip…";
      const zip = await WXC.zip.createStoreZipFromBlobs(frames);
      WXC.zip.downloadBlob(zip, `${baseName()}_${w}x${h}_${fps}fps_png.zip`);
      $("exportProgress").textContent = `✓ ${frameCount} transparent frames exported`;
      toast("✓ PNG sequence exported");
    } catch (e) {
      $("exportProgress").textContent = "⚠️ Export failed: " + e.message;
    } finally {
      setExportBusy(false);
    }
  }

  async function exportPngFrame() {
    if (!state.cues.length) return;
    const { w, h } = exportRes();
    let t = state.t;
    let cue = cueAt(t);
    if (!cue) { cue = state.cues[0]; t = (cue.start + cue.end) / 2; }
    const style = buildRenderStyle();
    await ensureFontsForExport(style, h);
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const octx = off.getContext("2d", { alpha: true });
    WXC.render.drawCaption(octx, cue, style, t, w, h, readAnim());
    off.toBlob((b) => WXC.zip.downloadBlob(b, `${baseName()}_frame.png`), "image/png");
    toast("✓ Transparent PNG exported");
  }

  // Opaque WebM recorded in real time — for the chroma-key path (browser WebM
  // cannot carry a real alpha channel; see README). Records background + caption.
  async function exportWebm() {
    if (!state.cues.length || state.exporting) return;
    if (typeof MediaRecorder === "undefined") return toast("⚠️ MediaRecorder not supported here");
    const { w, h } = exportRes();
    const fps = exportFps();
    const bg = bgColor() || "#000000";
    if (!bgColor())
      toast("Tip: WebM can't store alpha — set Background to a Solid color to key it out.");
    const style = buildRenderStyle();
    const anim = readAnim();
    setExportBusy(true);
    pause();
    await ensureFontsForExport(style, h);

    const rec = document.createElement("canvas"); rec.width = w; rec.height = h;
    const rctx = rec.getContext("2d", { alpha: false });
    const cap = document.createElement("canvas"); cap.width = w; cap.height = h;
    const cctx = cap.getContext("2d", { alpha: true });

    const stream = rec.captureStream(fps);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => (mr.onstop = r));
    mr.start();
    const startT = performance.now();
    await new Promise((resolve) => {
      function frame() {
        const t = (performance.now() - startT) / 1000;
        rctx.fillStyle = bg; rctx.fillRect(0, 0, w, h);
        WXC.render.drawCaption(cctx, cueAt(t), style, t, w, h, anim);
        rctx.drawImage(cap, 0, 0);
        $("exportProgress").textContent = `Recording ${t.toFixed(1)}s / ${state.duration.toFixed(1)}s…`;
        if (t >= state.duration) { resolve(); return; }
        requestAnimationFrame(frame);
      }
      frame();
    });
    mr.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    WXC.zip.downloadBlob(blob, `${baseName()}_${w}x${h}_chroma.webm`);
    $("exportProgress").textContent = "✓ WebM exported (opaque — key out the background)";
    setExportBusy(false);
  }

  function copyFfmpeg() {
    const name = baseName();
    const fps = exportFps();
    const cmd =
      `# Burn styled captions into a video (ffmpeg + libass):\n` +
      `ffmpeg -i input.mp4 -vf "ass=${name}.ass" -c:a copy output.mp4\n\n` +
      `# Turn the transparent PNG sequence into a single alpha ProRes 4444 .mov\n` +
      `# (drops straight over footage in Premiere / FCP / Resolve / After Effects):\n` +
      `ffmpeg -framerate ${fps} -i cap_%05d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le ${name}_overlay.mov\n\n` +
      `# Or QuickTime Animation (lossless RGBA):\n` +
      `ffmpeg -framerate ${fps} -i cap_%05d.png -c:v qtrle -pix_fmt argb ${name}_overlay.mov`;
    navigator.clipboard.writeText(cmd).then(() => toast("✓ ffmpeg commands copied"), () => toast(cmd));
  }

  // ---------- presets ----------
  const STYLE_KEYS = [
    "optFont", "optSize", "optWeight", "optTracking", "optLineH", "optTransform",
    "optColor", "optActive", "optStrokeColor", "optStroke", "optKaraoke",
    "optBox", "optBoxOpacity", "optBoxPad", "optBoxRadius", "optShadow", "optShadowColor",
    "optAnim", "optAnimSpeed", "optAnimIntensity",
    "optVAlign", "optHAlign", "optMarginX", "optMarginY", "optMaxWidth",
    "optMaxWords", "optMaxChars", "optMaxDur", "optMaxGap", "optPunct",
    "optExportKaraoke", "optBgMode", "optChroma", "optChromaCustom", "optRes", "optFps",
  ];
  function saveStyle() {
    const o = {};
    STYLE_KEYS.forEach((id) => { const el = $(id); if (el) o[id] = el.type === "checkbox" ? el.checked : el.value; });
    try { localStorage.setItem("wxc.style", JSON.stringify(o)); } catch (e) {}
  }
  function loadStyle() {
    let o;
    try { o = JSON.parse(localStorage.getItem("wxc.style")); } catch (e) {}
    if (!o) return;
    STYLE_KEYS.forEach((id) => {
      if (o[id] === undefined) return;
      const el = $(id); if (!el) return;
      if (el.type === "checkbox") el.checked = o[id]; else el.value = o[id];
    });
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- wiring ----------
  const TIMING_IDS = ["optMaxWords", "optMaxChars", "optMaxDur", "optMaxGap", "optPunct"];
  function wire() {
    buildFontList();
    buildAnimList();
    loadStyle();
    updateBackground();

    document.querySelectorAll(".panel input, .panel select").forEach((el) => {
      el.addEventListener("input", () => {
        if (TIMING_IDS.includes(el.id)) rebuildCues();
        if (el.id === "optRes") resizePreview();
        if (el.id === "optAnimSpeed") $("animSpeedVal").textContent = (+el.value).toFixed(2).replace(/0$/, "") + "×";
        if (el.id === "optAnimIntensity") $("animIntVal").textContent = (+el.value).toFixed(1);
        drawPreview();
        saveStyle();
      });
    });

    $("fileJson").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      state.baseName = f.name; readFile(f, (txt) => loadTranscriptText(f.name, txt));
    });
    $("fileAudio").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      audio.src = URL.createObjectURL(f);
      audio.onloadedmetadata = () => { rebuildCues(); toast("✓ Audio synced"); };
    });

    // background controls
    $("optBgMode").addEventListener("change", (e) => {
      if (e.target.value === "image") $("fileBg").click();
      updateBackground(); saveStyle();
    });
    $("optChroma").addEventListener("change", () => { updateBackground(); saveStyle(); });
    $("optChromaCustom").addEventListener("input", () => { updateBackground(); saveStyle(); });
    $("fileBg").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      $("optBgMode").value = "image";
      $("stageBg").classList.remove("transparent");
      $("stageBg").style.background = `url(${URL.createObjectURL(f)}) center/cover no-repeat`;
      updateBackground();
    });

    // custom font upload
    let lastFont = $("optFont").value;
    $("optFont").addEventListener("change", (e) => {
      if (e.target.value === "__upload") { e.target.value = lastFont; drawPreview(); $("fileFont").click(); }
      else lastFont = e.target.value;
    });
    $("fileFont").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) loadFontFile(f); e.target.value = ""; });

    $("playBtn").addEventListener("click", () => (state.playing ? pause() : play()));
    $("scrubber").addEventListener("input", (e) => seek((e.target.value / 1000) * state.duration));

    // exports
    $("dlPngSeq").addEventListener("click", exportPngSequence);
    $("dlPngFrame").addEventListener("click", exportPngFrame);
    $("dlWebm").addEventListener("click", exportWebm);
    $("dlSrt").addEventListener("click", () => download(baseName() + ".srt", WXC.formats.toSRT(state.cues)));
    $("dlVtt").addEventListener("click", () => download(baseName() + ".vtt", WXC.formats.toVTT(state.cues, $("optExportKaraoke").checked), "text/vtt"));
    $("dlAss").addEventListener("click", () => download(baseName() + ".ass", WXC.formats.toASS(state.cues, readAssStyle(), { karaoke: $("optExportKaraoke").checked })));
    $("dlJson").addEventListener("click", () => download(baseName() + ".captions.json", WXC.formats.toJSON(state.cues, readAssStyle())));
    $("copyFfmpeg").addEventListener("click", copyFfmpeg);

    $("savePreset").addEventListener("click", () => { saveStyle(); toast("✓ Style saved"); });
    $("resetPreset").addEventListener("click", () => { try { localStorage.removeItem("wxc.style"); } catch (e) {} location.reload(); });
    $("loadSample").addEventListener("click", loadSample);

    // drag & drop
    const dz = $("dropzone");
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (e) => {
      for (const f of e.dataTransfer.files) {
        if (/\.(json|srt|vtt|txt)$/i.test(f.name)) { state.baseName = f.name; readFile(f, (t) => loadTranscriptText(f.name, t)); }
        else if (/\.(ttf|otf|woff2?)$/i.test(f.name) || /^font\//.test(f.type)) loadFontFile(f);
        else if (/^(audio|video)\//.test(f.type)) { audio.src = URL.createObjectURL(f); audio.onloadedmetadata = () => rebuildCues(); }
        else if (/^image\//.test(f.type)) {
          $("optBgMode").value = "image"; $("stageBg").classList.remove("transparent");
          $("stageBg").style.background = `url(${URL.createObjectURL(f)}) center/cover no-repeat`; updateBackground();
        }
      }
    });

    audio.addEventListener("play", () => { if (!state.playing) play(); });
    audio.addEventListener("pause", () => { if (state.playing && audio.currentTime < audio.duration) pause(); });
    window.addEventListener("resize", resizePreview);
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); state.playing ? pause() : play();
      }
    });

    // reflect any restored anim slider labels
    $("animSpeedVal").textContent = (+$("optAnimSpeed").value).toFixed(2).replace(/0$/, "") + "×";
    $("animIntVal").textContent = (+$("optAnimIntensity").value).toFixed(1);
    resizePreview();
  }

  function loadSample() {
    fetch("sample/sample.whisperx.json")
      .then((r) => r.json())
      .then((d) => { state.baseName = "sample.json"; loadTranscriptText("sample.whisperx.json", JSON.stringify(d)); })
      .catch(() => toast("⚠️ Could not load sample"));
  }

  wire();
})();
