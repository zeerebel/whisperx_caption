/* app.js — UI, canvas preview and export wiring for WhisperX Caption Studio.
 * Preview and every exporter share WXC.render.drawCaption, so what you see is
 * exactly what you export. */
(function () {
  const WXC = window.WXC;
  const $ = (id) => document.getElementById(id);

  // Bump this on every change so the footer shows whether the deploy is current.
  const APP_VERSION = "1.9.3";

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
    audioUrl: null,
    bgUrl: null,
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
      activePill: $("optActivePill").checked,
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
  const gfontReady = new Map(); // family -> Promise that resolves when its stylesheet has loaded
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
    // remember when the @font-face rules are actually registered, so exports can wait
    gfontReady.set(name, new Promise((res) => { link.onload = res; link.onerror = res; }));
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
    const idx = cueIndexAt(state.t);           // one scan instead of cueAt + cueIndexAt
    const cue = idx >= 0 ? state.cues[idx] : null;
    WXC.render.drawCaption(pctx, cue, buildRenderStyle(), state.t, canvas.width, canvas.height, readAnim());
    $("emptyHint").style.display = state.model ? "none" : "";
    highlightCueRow(idx);
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
    else if (mode === "image" && !state.bgUrl) bg.classList.add("transparent"); // no image yet → keep checkerboard
  }

  // Object-URL-owning setters that revoke the previous URL so repeated picks don't leak.
  function setAudioFile(f) {
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(f);
    audio.src = state.audioUrl;
    audio.onloadedmetadata = () => { rebuildCues(); toast("✓ Audio synced"); };
  }
  function setBgImageFile(f) {
    if (state.bgUrl) URL.revokeObjectURL(state.bgUrl);
    state.bgUrl = URL.createObjectURL(f);
    $("optBgMode").value = "image";
    const bg = $("stageBg");
    bg.classList.remove("transparent");
    bg.style.background = `url(${state.bgUrl}) center/cover no-repeat`;
    updateBackground();
    saveStyle();
  }

  // ---------- cues ----------
  function rebuildCues() {
    if (!state.model) return;
    state.cues = WXC.buildCues(state.model, readTiming());
    decorateEditedCues();
    state.duration = (state.cues.length ? state.cues[state.cues.length - 1].end : 0) + 1.5;
    if (audio.src && audio.duration) state.duration = Math.max(state.duration, audio.duration);
    renderCueStrip();
    drawPreview();
    updateTimeUI();
    setExportEnabled(state.cues.length > 0);
  }
  let editingIndex = -1;
  function renderCueStrip() {
    const strip = $("cueStrip");
    strip.innerHTML = "";
    state.cues.forEach((c, i) => strip.appendChild(buildCueRow(c, i)));
  }
  function buildCueRow(c, i) {
    const row = document.createElement("div");
    row.className = "cue-row" + (c.edited ? " edited" : "");
    row.dataset.i = i;

    const t = document.createElement("span");
    t.className = "t";
    t.textContent = fmt(c.start);
    t.title = "Jump to this caption";
    t.addEventListener("click", (e) => { e.stopPropagation(); seek(c.start + 0.01); });
    row.appendChild(t);

    const x = document.createElement("span");
    x.className = "x";
    x.textContent = c.text;
    x.title = "Click to edit this line";
    x.addEventListener("click", (e) => { e.stopPropagation(); enterEditMode(row, c, i); });
    row.appendChild(x);

    if (c.edited && c.original) {
      const was = document.createElement("span");
      was.className = "cue-was";
      was.textContent = "was: " + c.original.text;
      const rev = document.createElement("button");
      rev.type = "button";
      rev.className = "cue-revert";
      rev.textContent = "↺";
      rev.title = "Revert to the original transcription";
      rev.addEventListener("click", (e) => { e.stopPropagation(); revertCueEdit(c, i); });
      was.appendChild(rev);
      row.appendChild(was);
    }

    row.addEventListener("click", () => seek(c.start + 0.01));
    return row;
  }

  // Click a line → edit it. The ORIGINAL transcription stays visible (dimmed,
  // struck through) above an input pre-filled with the current text; your typed
  // version becomes the active caption, and ↺ restores the original.
  function enterEditMode(row, c, i) {
    if (state.exporting) return;            // don't mutate cues while frames render
    if (editingIndex === i) return;
    // Close any other open editor first (rebuilds the strip, so re-fetch the row).
    if (editingIndex !== -1) { renderCueStrip(); row = $("cueStrip").children[i]; if (!row) { editingIndex = -1; return; } }
    editingIndex = i;
    pause();
    const orig = (c.original && c.original.text) || c.text;
    row.className = "cue-row editing";
    row.innerHTML = "";

    const t = document.createElement("span");
    t.className = "t"; t.textContent = fmt(c.start);
    row.appendChild(t);

    const box = document.createElement("div");
    box.className = "cue-edit";
    const origEl = document.createElement("div");
    origEl.className = "cue-orig"; origEl.textContent = orig; origEl.title = "Original transcription";
    const input = document.createElement("input");
    input.className = "cue-input"; input.type = "text"; input.value = c.text;
    input.setAttribute("aria-label", "Corrected caption text");
    const actions = document.createElement("div");
    actions.className = "cue-edit-actions";
    const save = document.createElement("button");
    save.type = "button"; save.className = "btn tiny"; save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn ghost tiny"; cancel.textContent = "Cancel";
    actions.appendChild(save); actions.appendChild(cancel);
    box.appendChild(origEl); box.appendChild(input); box.appendChild(actions);
    row.appendChild(box);

    const commit = () => { editingIndex = -1; applyCueEdit(c, i, input.value); renderCueStrip(); };
    const abort = () => { editingIndex = -1; renderCueStrip(); };
    save.addEventListener("click", (e) => { e.stopPropagation(); commit(); });
    cancel.addEventListener("click", (e) => { e.stopPropagation(); abort(); });
    box.addEventListener("click", (e) => e.stopPropagation()); // don't seek while editing
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); abort(); }
    });
    input.focus();
    input.setSelectionRange(0, input.value.length);
  }

  // Text corrections write through to the MODEL (word renames via _orig,
  // word-count changes as spliced runs via _run, segment text via _orig), so
  // re-grouping — timing sliders, presets — and every export keeps them.
  // The cue-level "edited" flag and original text are re-derived from those
  // markers on every rebuild instead of living on throwaway cue objects.
  const editRuns = new Map(); // runId -> pristine original words the run replaced
  let editRunSeq = 0;

  // Expand a slice of model words back to the original transcription, resolving
  // per-word renames (_orig) and spliced runs (_run) to what WhisperX produced.
  function pristineWords(ws) {
    const out = [];
    const seenRuns = new Set();
    for (const w of ws) {
      if (w._run !== undefined) {
        if (!seenRuns.has(w._run)) {
          seenRuns.add(w._run);
          (editRuns.get(w._run) || []).forEach((o) => out.push({ word: o.word, start: o.start, end: o.end }));
        }
      } else out.push({ word: w._orig !== undefined ? w._orig : w.word, start: w.start, end: w.end });
    }
    return out;
  }

  function decorateEditedCues() {
    state.cues.forEach((c, i) => {
      if (c.words && c.words.length) {
        if (c.words.some((w) => w._orig !== undefined || w._run !== undefined)) {
          c.edited = true;
          c.original = { text: WXC.joinWords(pristineWords(c.words)) };
        }
      } else {
        // Word-less cues map 1:1, in order, onto model.segments.
        const seg = state.model && state.model.segments && state.model.segments[i];
        if (seg && seg._orig !== undefined) { c.edited = true; c.original = { text: seg._orig }; }
      }
    });
  }

  function applyCueEdit(c, i, raw) {
    const newText = raw.replace(/\s+/g, " ").trim();
    if (!newText || newText === c.text) return;
    const tokens = newText.split(" ");
    if (c.words && c.words.length) {
      if (tokens.length === c.words.length) {
        // Same word count → rename each model word in place.
        c.words.forEach((w, k) => {
          if (w._run === undefined && w._orig === undefined) w._orig = w.word;
          w.word = tokens[k];
          if (w._orig !== undefined && w.word === w._orig) delete w._orig;
        });
      } else {
        // Word count changed → splice an evenly-timed run into the model
        // (keeps karaoke working; per-word timing is approximate), remembering
        // the pristine originals so revert survives any later re-grouping.
        const mw = state.model.words;
        const at = mw.indexOf(c.words[0]);
        if (at === -1) return; // cue words should always be model references
        const span = Math.max(0.01, c.end - c.start);
        const step = span / tokens.length;
        const runId = ++editRunSeq;
        editRuns.set(runId, pristineWords(c.words));
        const oldRuns = new Set(c.words.map((w) => w._run).filter((r) => r !== undefined));
        mw.splice(at, c.words.length, ...tokens.map((tok, k) =>
          ({ word: tok, start: c.start + step * k, end: c.start + step * (k + 1), _run: runId })));
        oldRuns.forEach((r) => { if (!mw.some((w) => w._run === r)) editRuns.delete(r); });
      }
    } else {
      const seg = state.model.segments[i];
      if (!seg) return;
      if (seg._orig === undefined) seg._orig = seg.text;
      seg.text = newText;
      if (seg.text === seg._orig) delete seg._orig;
    }
    rebuildCues();
  }

  function revertCueEdit(c, i) {
    if (c.words && c.words.length) {
      const runs = new Set();
      c.words.forEach((w) => {
        if (w._run !== undefined) runs.add(w._run);
        else if (w._orig !== undefined) { w.word = w._orig; delete w._orig; }
      });
      const mw = state.model.words;
      runs.forEach((r) => {
        const at = mw.findIndex((w) => w._run === r);
        if (at === -1) return;
        let len = 1;
        while (at + len < mw.length && mw[at + len]._run === r) len++;
        mw.splice(at, len, ...(editRuns.get(r) || []).map((o) => ({ word: o.word, start: o.start, end: o.end })));
        editRuns.delete(r);
      });
    } else {
      const seg = state.model.segments[i];
      if (seg && seg._orig !== undefined) { seg.text = seg._orig; delete seg._orig; }
    }
    rebuildCues();
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
    editRuns.clear(); // stale edit originals belong to the previous transcript
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
  // ---------- saving files (native "Save As" when available) ----------
  // showSaveFilePicker (Chrome/Edge) lets the user name and place the file. It
  // MUST run during the click gesture, so long exports grab a handle up front
  // and write to it when finished. Everywhere else falls back to a normal
  // auto-named download.
  async function pickSaveHandle(suggestedName, accept) {
    if (typeof window.showSaveFilePicker !== "function") return null;
    try {
      return await window.showSaveFilePicker({
        suggestedName,
        types: accept ? [{ description: "File", accept }] : undefined,
      });
    } catch (e) {
      if (e && e.name === "AbortError") return "cancel"; // user dismissed the dialog
      return null;                                       // unsupported/blocked → fall back
    }
  }
  async function saveOrDownload(handle, blob, name) {
    if (handle) {
      try { const w = await handle.createWritable(); await w.write(blob); await w.close(); return; }
      catch (e) { toast("⚠️ Couldn't save there — downloading instead"); }
    }
    WXC.zip.downloadBlob(blob, name);
  }
  // Instant exports (text, single frame): pick + write in one call. Returns
  // false only if the user cancelled the save dialog.
  async function saveBlobNow(blob, name, accept) {
    const h = await pickSaveHandle(name, accept);
    if (h === "cancel") return false;
    await saveOrDownload(h, blob, name);
    return true;
  }
  async function download(name, text, mime) {
    await saveBlobNow(new Blob([text], { type: mime || "text/plain;charset=utf-8" }), name);
  }
  function baseName() { return (state.baseName || "captions").replace(/\.[^.]+$/, ""); }
  function setExportEnabled(on) {
    ["dlSrt", "dlVtt", "dlAss", "dlJson", "copyFfmpeg", "playBtn", "scrubber",
     "dlPngSeq", "dlPngFrame", "dlWebm", "dlMov"].forEach((id) => ($(id).disabled = !on));
  }
  function setExportBusy(b) {
    state.exporting = b;
    exportCancelled = false;
    cancelHook = null;
    const btn = $("exportCancel");
    btn.classList.toggle("hidden", !b);
    btn.disabled = false;
    ["dlPngSeq", "dlPngFrame", "dlWebm", "dlMov", "playBtn"].forEach((id) => ($(id).disabled = b || !state.cues.length));
  }

  // ---------- export cancellation ----------
  // One flag shared by every long-running exporter; frame loops poll it and
  // bail via CANCEL, while cancelHook lets the .mov path kill a busy encoder.
  let exportCancelled = false;
  let cancelHook = null;
  const CANCEL = new Error("Export cancelled");
  function checkCancel() { if (exportCancelled) throw CANCEL; }
  function reportExportError(e, prefix) {
    if (e === CANCEL) { $("exportProgress").textContent = "Export cancelled."; toast("Export cancelled"); }
    else { $("exportProgress").textContent = "⚠️ " + prefix + e.message; }
  }

  // ---------- transparent exporters ----------
  async function ensureFontsForExport(style, h) {
    try {
      // For a just-selected Google font the <link> may still be loading — wait for
      // it (custom uploads are added synchronously, so gfontReady won't have them).
      if (gfontReady.has(style.fontName)) await gfontReady.get(style.fontName);
      await document.fonts.load(`${style.weight} ${Math.round(style.size * (h / 1080))}px ${style.fontFamily}`, "AaGg0123");
      await document.fonts.ready;
      if (!document.fonts.check(`${style.weight} ${Math.round(style.size * (h / 1080))}px ${style.fontFamily}`))
        toast("⚠️ Font may not be fully loaded — export could use a fallback");
    } catch (e) {}
  }

  async function exportPngSequence() {
    if (!state.cues.length || state.exporting) return;
    const { w, h } = exportRes();
    const fps = exportFps();
    const frameCount = Math.max(1, Math.round(state.duration * fps));
    const zipName = `${baseName()}_${w}x${h}_${fps}fps_png.zip`;

    // Stream the zip straight to disk when the browser allows it (Chrome/Edge):
    // frames leave memory as soon as they're written, so peak memory stays flat
    // no matter how long or high-res the clip is.
    let writable = null;
    if (window.showSaveFilePicker) {
      try {
        $("exportProgress").textContent = "Choose where to save the .zip…";
        const fh = await window.showSaveFilePicker({
          suggestedName: zipName,
          types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
        });
        writable = await fh.createWritable();
      } catch (e) {
        if (e && e.name === "AbortError") return; // user closed the save dialog
        writable = null; // picker unavailable → fall back to the in-memory path
      }
    }
    // The in-memory fallback holds every frame at once — warn before big runs
    // (the budget scales with resolution: 4K frames cost 4× 1080p).
    if (!writable && frameCount * w * h > 1920 * 1080 * 900 &&
        !confirm(`${frameCount} frames at ${w}×${h} is a large export and may use a lot of memory.\n\nTip: lower the FPS/resolution or trim the audio for shorter clips. Continue?`))
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
    const zw = writable ? WXC.zip.createZipStream((bytes) => writable.write(bytes)) : null;
    try {
      for (let i = 0; i < frameCount; i++) {
        checkCancel();
        const t = i / fps;
        WXC.render.drawCaption(octx, cueAt(t), style, t, w, h, anim);
        const blob = await new Promise((res) => off.toBlob(res, "image/png"));
        if (!blob) throw new Error(`PNG encode failed at frame ${i} — try a lower resolution.`);
        const name = `cap_${String(i).padStart(5, "0")}.png`;
        if (zw) await zw.add(name, new Uint8Array(await blob.arrayBuffer()));
        else frames.push({ name, blob });
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
      if (zw) {
        await zw.add("README.txt", new TextEncoder().encode(readme));
        $("exportProgress").textContent = "Finishing .zip…";
        await zw.finish();
        await writable.close();
        writable = null;
      } else {
        frames.push({ name: "README.txt", blob: new Blob([readme], { type: "text/plain" }) });
        $("exportProgress").textContent = "Packaging .zip…";
        const zip = await WXC.zip.createStoreZipFromBlobs(frames);
        WXC.zip.downloadBlob(zip, zipName);
      }
      $("exportProgress").textContent = `✓ ${frameCount} transparent frames exported`;
      toast("✓ PNG sequence exported");
    } catch (e) {
      reportExportError(e, "Export failed: ");
    } finally {
      if (writable) { try { await writable.abort(); } catch (e) {} } // cancelled/failed mid-stream → discard the partial file
      off.width = off.height = 0; // drop the (up to 4K) canvas backing store
      setExportBusy(false);
    }
  }

  async function exportPngFrame() {
    if (!state.cues.length || state.exporting) return;
    const { w, h } = exportRes();
    let t = state.t;
    let cue = cueAt(t);
    if (!cue) { cue = state.cues[0]; t = (cue.start + cue.end) / 2; }
    const name = `${baseName()}_frame.png`;
    // Prompt for the save location first, while we still hold the click gesture.
    const handle = await pickSaveHandle(name, { "image/png": [".png"] });
    if (handle === "cancel") return;
    const style = buildRenderStyle();
    await ensureFontsForExport(style, h);
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const octx = off.getContext("2d", { alpha: true });
    WXC.render.drawCaption(octx, cue, style, t, w, h, readAnim());
    off.toBlob((b) => {
      if (!b) return toast("⚠️ PNG export failed (resolution too large?)");
      saveOrDownload(handle, b, name).then(() => toast("✓ Transparent PNG exported"));
    }, "image/png");
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
    const webmName = `${baseName()}_${w}x${h}_chroma.webm`;
    const saveHandle = await pickSaveHandle(webmName, { "video/webm": [".webm"] });
    if (saveHandle === "cancel") return; // user dismissed the save dialog
    const style = buildRenderStyle();
    const anim = readAnim();
    setExportBusy(true);
    pause();
    let mr = null, stream = null, rec = null, cap = null;
    try {
      await ensureFontsForExport(style, h);
      rec = document.createElement("canvas"); rec.width = w; rec.height = h;
      const rctx = rec.getContext("2d", { alpha: false });
      cap = document.createElement("canvas"); cap.width = w; cap.height = h;
      const cctx = cap.getContext("2d", { alpha: true });

      stream = rec.captureStream(fps);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise((r) => (mr.onstop = r));
      mr.start();
      const startT = performance.now();
      await new Promise((resolve, reject) => {
        function frame() {
          try {
            if (exportCancelled) { resolve(); return; }
            const t = (performance.now() - startT) / 1000;
            rctx.fillStyle = bg; rctx.fillRect(0, 0, w, h);
            WXC.render.drawCaption(cctx, cueAt(t), style, t, w, h, anim);
            rctx.drawImage(cap, 0, 0);
            $("exportProgress").textContent = `Recording ${t.toFixed(1)}s / ${state.duration.toFixed(1)}s…`;
            if (t >= state.duration) { resolve(); return; }
            requestAnimationFrame(frame);
          } catch (err) { reject(err); }
        }
        frame();
      });
      mr.stop();
      await stopped;
      checkCancel(); // cancelled mid-recording → drop the partial capture
      await saveOrDownload(saveHandle, new Blob(chunks, { type: "video/webm" }), webmName);
      $("exportProgress").textContent = "✓ WebM exported (opaque — key out the background)";
      toast("✓ WebM exported");
    } catch (e) {
      reportExportError(e, "WebM export failed: ");
    } finally {
      if (mr && mr.state !== "inactive") { try { mr.stop(); } catch (e) {} }
      if (stream) stream.getTracks().forEach((t) => t.stop()); // stop the live canvas-capture track
      if (rec) rec.width = rec.height = 0;
      if (cap) cap.width = cap.height = 0;
      setExportBusy(false);
    }
  }

  // ---------- in-browser transparent .mov (ffmpeg.wasm, lazy-loaded) ----------
  // Single-threaded core → no SharedArrayBuffer, so NO COOP/COEP headers are
  // needed and Google-Fonts loading is unaffected. Loaded only on first click.
  let ffmpegInstance = null;
  const ffLogRing = [];   // recent ffmpeg stderr lines, kept so a failure can be diagnosed
  let onFfFrame = null;   // optional callback fed the "frame=N" progress during exec
  // Self-hosted, same-origin encoder — so the .mov export keeps working when
  // the jsdelivr CDN is blocked (ad-blockers, corporate/school firewalls, some
  // regions). The wasm is shipped gzipped (~10 MB vs ~30 MB) to fit Cloudflare's
  // 25 MiB asset limit and is gunzipped in the browser.
  const LOCAL = {
    ffmpeg: "vendor/ffmpeg.js",
    coreJs: "vendor/ffmpeg-core.js",
    coreWasm: "vendor/ffmpeg-core.wasm.gz",
  };
  // CDN — used only as a fallback if the vendored files can't be fetched
  // (e.g. the app was opened straight from file://).
  const FF = {
    ffmpeg: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js",
    coreJs: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
    coreWasm: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
  };
  // In-browser .mov codecs. QuickTime Animation (qtrle, 8-bit RGBA) is the
  // default: for caption-over-transparent frames it's ~20× faster and ~10×
  // smaller than ProRes 4444 in the single-threaded wasm core, still lossless
  // true alpha, and read by every NLE. ProRes 4444 stays available but is
  // heavy enough in-browser to stall or run out of memory on long/4K clips —
  // for that, the PNG sequence + "Copy ffmpeg command" (native ffmpeg) is best.
  const MOV_CODECS = {
    qtrle:  { label: "QuickTime Animation, RGBA", args: ["-c:v", "qtrle", "-pix_fmt", "argb"] },
    prores: { label: "ProRes 4444", args: ["-c:v", "prores_ks", "-profile:v", "4444", "-vendor", "apl0", "-pix_fmt", "yuva444p10le"] },
  };
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const abs = new URL(src, document.baseURI).href; // script els report .src absolute
      if ([...document.scripts].some((s) => s.src === abs)) return resolve();
      const s = document.createElement("script");
      s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }
  async function fetchToBlobURL(url, type) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`could not fetch ${url} (${r.status})`);
    return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
  }
  // Fetch the core wasm → blob URL, transparently gunzipping when the bytes are
  // gzip-compressed (our self-hosted asset) rather than raw wasm (the CDN).
  // Detecting by magic bytes keeps it correct even if a host already inflated a
  // .gz via its own Content-Encoding.
  async function fetchWasmBlobURL(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`could not fetch ${url} (${r.status})`);
    let buf = new Uint8Array(await r.arrayBuffer());
    const isWasm = buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d; // "\0asm"
    const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
    if (isGzip && !isWasm) {
      if (typeof DecompressionStream === "undefined")
        throw new Error("this browser can't unpack the encoder (no DecompressionStream)");
      const ds = new DecompressionStream("gzip");
      buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer());
    }
    return URL.createObjectURL(new Blob([buf], { type: "application/wasm" }));
  }
  async function buildFFmpeg(ffmpegSrc, coreJsUrl, coreWasmUrl) {
    await loadScriptOnce(ffmpegSrc);
    if (!window.FFmpegWASM) throw new Error("encoder script did not initialize");
    const ff = new window.FFmpegWASM.FFmpeg();
    // Keep the tail of ffmpeg's log so a failed encode can be diagnosed (e.g.
    // an out-of-memory abort), and surface "frame=N" as live encode progress.
    ff.on("log", ({ message }) => {
      ffLogRing.push(message);
      if (ffLogRing.length > 60) ffLogRing.shift();
      const m = /frame=\s*(\d+)/.exec(message);
      if (m && onFfFrame) onFfFrame(+m[1]);
    });
    const coreURL = await fetchToBlobURL(coreJsUrl, "text/javascript");
    const wasmURL = await fetchWasmBlobURL(coreWasmUrl);
    await ff.load({ coreURL, wasmURL });
    // the worker has instantiated the core; release the (~30 MB) blob URLs
    URL.revokeObjectURL(coreURL);
    URL.revokeObjectURL(wasmURL);
    return ff;
  }
  async function ensureFFmpeg() {
    if (ffmpegInstance) return ffmpegInstance;
    try {
      ffmpegInstance = await buildFFmpeg(LOCAL.ffmpeg, LOCAL.coreJs, LOCAL.coreWasm);
    } catch (e) {
      // Vendored assets unreachable (e.g. opened from file://) — fall back to the CDN.
      ffmpegInstance = await buildFFmpeg(FF.ffmpeg, FF.coreJs, FF.coreWasm);
    }
    return ffmpegInstance;
  }

  async function exportMov() {
    if (!state.cues.length || state.exporting) return;
    const { w, h } = exportRes();
    const fps = exportFps();
    const frameCount = Math.max(1, Math.round(state.duration * fps));
    const codecSel = ($("optMovCodec") && $("optMovCodec").value) || "qtrle";
    const codec = MOV_CODECS[codecSel] || MOV_CODECS.qtrle;
    // ProRes 4444 is far heavier in the wasm core, so warn much sooner for it
    // than for the light Animation codec (thresholds are frames × pixels).
    const budget = (codecSel === "prores" ? 300 : 1200) * 1920 * 1080;
    if (frameCount * w * h > budget &&
        !confirm(`${frameCount} frames at ${w}×${h} as ${codec.label} is a large in-browser encode and may be slow or run out of memory.\n\nTip: lower the FPS/resolution, trim the clip, or use the PNG sequence + “Copy ffmpeg command”. Continue?`))
      return;
    // Ask where to save now, while the click gesture is still live; we write to
    // it once encoding finishes.
    const movName = `${baseName()}_${w}x${h}_alpha.mov`;
    const saveHandle = await pickSaveHandle(movName, { "video/quicktime": [".mov"] });
    if (saveHandle === "cancel") return; // user dismissed the save dialog
    const style = buildRenderStyle();
    const anim = readAnim();
    setExportBusy(true);
    pause();
    $("exportProgress").textContent = "Loading the in-browser encoder (first time downloads ~10 MB)…";
    let ff;
    try {
      ff = await ensureFFmpeg();
    } catch (e) {
      $("exportProgress").textContent = "⚠️ Couldn't load the in-browser encoder. Use the Transparent PNG sequence + “Copy ffmpeg command”, or “.webm (chroma)”, instead.";
      toast("⚠️ Encoder unavailable — use the PNG sequence + ffmpeg command");
      setExportBusy(false);
      return;
    }
    const names = [];
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    let terminated = false;
    try {
      await ensureFontsForExport(style, h);
      const octx = off.getContext("2d", { alpha: true });
      for (let i = 0; i < frameCount; i++) {
        checkCancel();
        const t = i / fps;
        WXC.render.drawCaption(octx, cueAt(t), style, t, w, h, anim);
        const blob = await new Promise((res) => off.toBlob(res, "image/png"));
        if (!blob) throw new Error(`PNG encode failed at frame ${i} — try a lower resolution.`);
        const name = `cap_${String(i).padStart(5, "0")}.png`;
        await ff.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
        names.push(name);
        if (i % 4 === 0) {
          $("exportProgress").textContent = `Rendering frame ${i + 1} / ${frameCount}…`;
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      $("exportProgress").textContent = `Encoding transparent .mov (${codec.label})…`;
      ffLogRing.length = 0;
      // A wedged encode would otherwise spin forever. Give it a budget that
      // scales with the clip, then kill the worker; Cancel uses the same kill.
      // A terminated FFmpeg instance is dead, so drop it and reload next time.
      const timeoutMs = Math.max(120000, frameCount * 3000);
      const killEncoder = () => { terminated = true; ffmpegInstance = null; try { ff.terminate(); } catch (err) {} };
      cancelHook = killEncoder;
      const stallTimer = setTimeout(killEncoder, timeoutMs);
      // ffmpeg reports "frame=N" as it encodes — mirror it so a multi-second
      // (or multi-minute) encode shows progress instead of looking frozen.
      onFfFrame = (n) => { if (!terminated) $("exportProgress").textContent = `Encoding transparent .mov — frame ${Math.min(n, frameCount)} / ${frameCount} (${codec.label})…`; };
      try {
        await ff.exec(["-framerate", String(fps), "-i", "cap_%05d.png", ...codec.args, "out.mov"]);
      } catch (e) {
        if (exportCancelled) throw CANCEL;
        if (terminated) throw new Error(`the encoder stopped after ${Math.round(timeoutMs / 60000)} min — lower the resolution/FPS or shorten the clip, or export the PNG sequence.`);
        throw e;
      } finally {
        clearTimeout(stallTimer);
        cancelHook = null;
        onFfFrame = null;
      }
      checkCancel();
      let data = null;
      try { data = await ff.readFile("out.mov"); } catch (err) { data = null; }
      if (!data || !data.length) {
        // The encoder wrote nothing — on this single-threaded wasm core that's
        // almost always an out-of-memory abort on a long/high-res clip. The
        // aborted core is unusable, so drop it and reload fresh next time.
        ffmpegInstance = null;
        const oom = ffLogRing.some((l) => /out of memory|cannot enlarge|memory access|abort|killed|malloc|bad_alloc/i.test(l));
        throw new Error(oom
          ? "the in-browser encoder ran out of memory at this size. Lower the resolution/FPS or shorten the clip — or export the PNG sequence and use “Copy ffmpeg command” for a ProRes .mov."
          : "the encoder produced no output. Lower the resolution/FPS or shorten the clip — or use the PNG sequence + “Copy ffmpeg command”.");
      }
      await saveOrDownload(saveHandle, new Blob([data], { type: "video/quicktime" }), movName);
      $("exportProgress").textContent = `✓ Transparent .mov exported (${w}×${h}, ${fps}fps, ${codec.label})`;
      toast("✓ Transparent .mov exported");
    } catch (e) {
      if (e === CANCEL) reportExportError(e, "");
      else {
        ffmpegInstance = null; // a failed/aborted core can't be trusted — reload on next try
        $("exportProgress").textContent = "⚠️ .mov export failed: " + e.message;
        toast("⚠️ .mov export failed");
      }
    } finally {
      // Drain the virtual FS (frames + any partial out.mov) and the canvas —
      // but ONLY if this core is still the live instance. A terminated or
      // OOM-aborted core is dropped (ffmpegInstance nulled) and won't answer
      // deleteFile, so touching it here would hang the whole export.
      if (ffmpegInstance === ff) {
        for (const n of names) { try { await ff.deleteFile(n); } catch (err) {} }
        try { await ff.deleteFile("out.mov"); } catch (err) {}
      }
      off.width = off.height = 0;
      setExportBusy(false);
    }
  }

  function copyFfmpeg() {
    const name = baseName();
    const fps = exportFps();
    const { w, h } = exportRes();
    // the color the chroma WebM was rendered on (green unless you changed it),
    // as ffmpeg's 0xRRGGBB form, so colorkey removes the right color.
    const chromaSel = $("optChroma").value;
    const chromaHex = (chromaSel === "custom" ? $("optChromaCustom").value : chromaSel).replace("#", "0x");
    const webm = `${name}_${w}x${h}_chroma.webm`;
    const cmd =
      `# Burn styled captions into a video (ffmpeg + libass):\n` +
      `ffmpeg -i input.mp4 -vf "ass=${name}.ass" -c:a copy output.mp4\n\n` +
      `# Chroma .webm → real transparent ProRes 4444 .mov (keys out the color, no\n` +
      `# green screen step needed after — drops over footage in Premiere/FCP/Resolve/AE):\n` +
      `ffmpeg -i ${webm} -vf "colorkey=${chromaHex}:0.3:0.2,format=yuva444p10le" -c:v prores_ks -profile:v 4444 ${name}_alpha.mov\n\n` +
      `# Chroma .webm → plain MP4 (stays opaque — key out the color in your editor):\n` +
      `ffmpeg -i ${webm} -c:v libx264 -pix_fmt yuv420p ${name}.mp4\n\n` +
      `# Transparent PNG sequence → single alpha ProRes 4444 .mov:\n` +
      `ffmpeg -framerate ${fps} -i cap_%05d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le ${name}_overlay.mov\n\n` +
      `# Or QuickTime Animation (lossless RGBA):\n` +
      `ffmpeg -framerate ${fps} -i cap_%05d.png -c:v qtrle -pix_fmt argb ${name}_overlay.mov`;
    navigator.clipboard.writeText(cmd).then(() => toast("✓ ffmpeg commands copied"), () => toast(cmd));
  }

  // ---------- presets ----------
  const STYLE_KEYS = [
    "optFont", "optSize", "optWeight", "optTracking", "optLineH", "optTransform",
    "optColor", "optActive", "optStrokeColor", "optStroke", "optKaraoke", "optActivePill",
    "optBox", "optBoxOpacity", "optBoxPad", "optBoxRadius", "optShadow", "optShadowColor",
    "optAnim", "optAnimSpeed", "optAnimIntensity",
    "optVAlign", "optHAlign", "optMarginX", "optMarginY", "optMaxWidth",
    "optMaxWords", "optMaxChars", "optMaxDur", "optMaxGap", "optPunct",
    "optExportKaraoke", "optBgMode", "optChroma", "optChromaCustom", "optRes", "optFps", "optMovCodec",
  ];
  // Snapshot every style control into a plain object (the shape a preset stores).
  function captureStyle() {
    const o = {};
    STYLE_KEYS.forEach((id) => {
      const el = $(id); if (!el) return;
      if (id === "optFont" && el.value === "__upload") return; // never persist the upload sentinel
      o[id] = el.type === "checkbox" ? el.checked : el.value;
    });
    return o;
  }
  function saveStyle() {
    try { localStorage.setItem("wxc.style", JSON.stringify(captureStyle())); } catch (e) {}
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
  function updateAnimLabels() {
    $("animSpeedVal").textContent = (+$("optAnimSpeed").value).toFixed(2).replace(/0$/, "") + "×";
    $("animIntVal").textContent = (+$("optAnimIntensity").value).toFixed(1);
  }

  // ---------- presets ----------
  // Built-in look templates. Each is a PARTIAL style object: only the keys it
  // lists get applied, so switching a template keeps your export resolution/fps
  // and background mode untouched. Values map 1:1 to the STYLE_KEYS control ids.
  const BUILTIN_PRESETS = [
    { name: "Bold Yellow (Hormozi)", style: {
      optFont: "Anton", optSize: "72", optWeight: "400", optTransform: "uppercase",
      optColor: "#ffffff", optActive: "#ffe000", optStrokeColor: "#000000", optStroke: "6",
      optKaraoke: true, optBoxOpacity: "0", optShadow: "4", optShadowColor: "#000000",
      optAnim: "word-pop-in", optAnimSpeed: "1", optAnimIntensity: "1",
      optVAlign: "bottom", optHAlign: "center", optMarginY: "12", optMaxWidth: "82",
      optMaxWords: "4", optMaxChars: "22" } },
    { name: "Karaoke Pop", style: {
      optFont: "Poppins", optSize: "64", optWeight: "800", optTransform: "uppercase",
      optColor: "#ffffff", optActive: "#00e5ff", optStrokeColor: "#10131a", optStroke: "5",
      optKaraoke: true, optBoxOpacity: "0", optShadow: "5", optShadowColor: "#000000",
      optAnim: "word-pop-in", optAnimSpeed: "1.2", optAnimIntensity: "1.1",
      optVAlign: "bottom", optHAlign: "center", optMaxWords: "5", optMaxChars: "28" } },
    { name: "Clean White", style: {
      optFont: "Inter", optSize: "58", optWeight: "700", optTransform: "none",
      optColor: "#ffffff", optActive: "#7cc4ff", optStrokeColor: "#000000", optStroke: "3",
      optKaraoke: true, optBoxOpacity: "0", optShadow: "8", optShadowColor: "#000000",
      optAnim: "fade-in", optAnimSpeed: "1", optAnimIntensity: "1",
      optVAlign: "bottom", optHAlign: "center" } },
    { name: "Bebas Big Outline", style: {
      optFont: "Bebas Neue", optSize: "96", optWeight: "400", optTracking: "1", optTransform: "uppercase",
      optColor: "#ffffff", optActive: "#ffd400", optStrokeColor: "#000000", optStroke: "7",
      optKaraoke: true, optBoxOpacity: "0", optShadow: "3", optShadowColor: "#000000",
      optAnim: "pop-scale-in", optAnimSpeed: "1", optAnimIntensity: "1",
      optVAlign: "bottom", optHAlign: "center", optMaxWords: "3" } },
    { name: "Boxed Subtitle", style: {
      optFont: "Inter", optSize: "50", optWeight: "700", optTransform: "none",
      optColor: "#ffffff", optActive: "#ffd400", optStrokeColor: "#000000", optStroke: "0",
      optKaraoke: false, optBox: "#000000", optBoxOpacity: "0.55", optBoxPad: "16", optBoxRadius: "12",
      optShadow: "0", optAnim: "slide-up", optAnimSpeed: "1", optAnimIntensity: "1",
      optVAlign: "bottom", optHAlign: "center", optMarginY: "10" } },
    { name: "Minimal Lower Third", style: {
      optFont: "Montserrat", optSize: "42", optWeight: "600", optTransform: "none",
      optColor: "#ffffff", optActive: "#ffffff", optStrokeColor: "#000000", optStroke: "2",
      optKaraoke: false, optBoxOpacity: "0", optShadow: "6", optShadowColor: "#000000",
      optAnim: "slide-up", optAnimSpeed: "1", optAnimIntensity: "1",
      optVAlign: "bottom", optHAlign: "left", optMarginX: "6", optMaxWidth: "70" } },
  ];

  const PRESET_LS = "wxc.presets";
  function getUserPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_LS)) || {}; } catch (e) { return {}; }
  }
  function setUserPresets(o) {
    try { localStorage.setItem(PRESET_LS, JSON.stringify(o)); } catch (e) {}
  }
  function buildPresetList(selectValue) {
    const sel = $("presetSelect");
    sel.innerHTML = "";
    sel.appendChild(new Option("— Select a preset —", ""));
    const ogB = document.createElement("optgroup");
    ogB.label = "Built-in templates";
    BUILTIN_PRESETS.forEach((p) => ogB.appendChild(new Option(p.name, "b:" + p.name)));
    sel.appendChild(ogB);
    const user = getUserPresets();
    const names = Object.keys(user).sort((a, b) => a.localeCompare(b));
    if (names.length) {
      const ogU = document.createElement("optgroup");
      ogU.label = "My presets";
      names.forEach((n) => ogU.appendChild(new Option(n, "u:" + n)));
      sel.appendChild(ogU);
    }
    if (selectValue !== undefined) sel.value = selectValue;
  }
  // Apply a partial style object, then refresh everything downstream so the
  // change behaves exactly like the user having set each control by hand.
  function applyPreset(style) {
    STYLE_KEYS.forEach((id) => {
      if (style[id] === undefined) return;
      const el = $(id); if (!el) return;
      if (el.type === "checkbox") el.checked = !!style[id]; else el.value = style[id];
    });
    fontValue($("optFont").value);          // trigger Google-font load if needed
    if ($("optBgMode").value === "image") $("optBgMode").value = "transparent";
    updateBackground();
    updateAnimLabels();
    rebuildCues();                          // re-group if line-grouping changed
    resizePreview();                        // re-fit + redraw for any res change
    saveStyle();
  }
  function selectedPreset() {
    const v = $("presetSelect").value;
    if (!v) return null;
    const kind = v.slice(0, 2), name = v.slice(2);
    if (kind === "b:") return { builtin: true, name, style: (BUILTIN_PRESETS.find((p) => p.name === name) || {}).style };
    if (kind === "u:") return { builtin: false, name, style: getUserPresets()[name] };
    return null;
  }
  function savePresetAs() {
    const name = (prompt("Name this preset:") || "").trim();
    if (!name) return;
    if (BUILTIN_PRESETS.some((p) => p.name === name)) return toast("⚠️ That name is reserved by a built-in template");
    const user = getUserPresets();
    if (user[name] && !confirm(`Overwrite your preset “${name}”?`)) return;
    user[name] = captureStyle();
    setUserPresets(user);
    buildPresetList("u:" + name);
    toast(`✓ Saved preset “${name}”`);
  }
  function updateCurrentPreset() {
    const p = selectedPreset();
    if (!p || p.builtin) return toast("Pick one of your own presets to update (built-ins are read-only)");
    const user = getUserPresets();
    user[p.name] = captureStyle();
    setUserPresets(user);
    toast(`✓ Updated “${p.name}”`);
  }
  function deleteCurrentPreset() {
    const p = selectedPreset();
    if (!p || p.builtin) return toast("Built-in templates can't be deleted");
    if (!confirm(`Delete your preset “${p.name}”?`)) return;
    const user = getUserPresets();
    delete user[p.name];
    setUserPresets(user);
    buildPresetList("");
    toast(`✓ Deleted “${p.name}”`);
  }
  function exportPresetPack() {
    const user = getUserPresets();
    if (!Object.keys(user).length) return toast("No saved presets to export yet — use Save as… first");
    const pack = { v: 1, kind: "wxc-preset-pack", presets: user };
    download("caption-presets.json", JSON.stringify(pack, null, 2), "application/json");
    toast("✓ Preset pack exported");
  }
  function importPresetPack(file) {
    readFile(file, (txt) => {
      let data;
      try { data = JSON.parse(txt); } catch (e) { return toast("⚠️ Not a valid preset file"); }
      // Require the pack marker so a stray captions.json can't become junk presets.
      if (!data || data.kind !== "wxc-preset-pack" || typeof data.presets !== "object" || Array.isArray(data.presets))
        return toast("⚠️ Not a preset pack — make one with “Export pack”");
      const incoming = data.presets;
      const user = getUserPresets();
      const names = Object.keys(incoming).filter((name) =>
        !BUILTIN_PRESETS.some((p) => p.name === name) && incoming[name] && typeof incoming[name] === "object");
      if (!names.length) return toast("No presets found in that pack");
      const clashes = names.filter((n) => user[n]);
      if (clashes.length && !confirm(`Overwrite ${clashes.length} preset(s) you already have (${clashes.slice(0, 3).join(", ")}${clashes.length > 3 ? "…" : ""})?`))
        return;
      names.forEach((n) => { user[n] = incoming[n]; });
      setUserPresets(user);
      buildPresetList("");
      toast(`✓ Imported ${names.length} preset${names.length > 1 ? "s" : ""}`);
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

  // Tabbed control panel: closed by default; clicking a tab opens that one
  // section (and only that one), clicking the open tab again closes it.
  function wireTabs() {
    const tabs = [...document.querySelectorAll(".tab")];
    const panels = [...document.querySelectorAll(".tabpanel")];
    const activate = (key) => {
      tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === key));
      panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === key));
    };
    tabs.forEach((t) => t.addEventListener("click", () => {
      activate(t.classList.contains("is-active") ? null : t.dataset.tab);
    }));
  }
  // Open a panel by key (e.g. surface the Export tab when needed).
  function showTab(key) {
    const t = document.querySelector(`.tab[data-tab="${key}"]`);
    if (t && !t.classList.contains("is-active")) t.click();
  }

  function wire() {
    wireTabs();
    const vEl = $("appVersion"); if (vEl) vEl.textContent = "v" + APP_VERSION;
    console.log("WhisperX Caption Studio v" + APP_VERSION);
    buildFontList();
    buildAnimList();
    loadStyle();
    if ($("optBgMode").value === "image") $("optBgMode").value = "transparent"; // image blobs can't be persisted
    updateBackground();

    document.querySelectorAll(".panel input, .panel select").forEach((el) => {
      el.addEventListener("input", () => {
        if (el.id === "optFont" && el.value === "__upload") return; // sentinel handled by the change listener
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
      setAudioFile(f);
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
      setBgImageFile(f);
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
    $("dlMov").addEventListener("click", exportMov);
    $("dlSrt").addEventListener("click", () => download(baseName() + ".srt", WXC.formats.toSRT(state.cues)));
    $("dlVtt").addEventListener("click", () => download(baseName() + ".vtt", WXC.formats.toVTT(state.cues, $("optExportKaraoke").checked), "text/vtt"));
    $("dlAss").addEventListener("click", () => download(baseName() + ".ass", WXC.formats.toASS(state.cues, readAssStyle(), { karaoke: $("optExportKaraoke").checked })));
    $("dlJson").addEventListener("click", () => download(baseName() + ".captions.json", WXC.formats.toJSON(state.cues, readAssStyle())));
    $("copyFfmpeg").addEventListener("click", copyFfmpeg);
    $("exportCancel").addEventListener("click", () => {
      exportCancelled = true;
      $("exportCancel").disabled = true;
      $("exportProgress").textContent = "Cancelling…";
      if (cancelHook) cancelHook(); // e.g. terminate a busy ffmpeg worker
    });

    // presets
    buildPresetList();
    $("presetSelect").addEventListener("change", () => {
      const p = selectedPreset();
      if (p && p.style) { applyPreset(p.style); toast(`✓ Applied “${p.name}”`); }
    });
    $("presetSaveAs").addEventListener("click", savePresetAs);
    $("presetUpdate").addEventListener("click", updateCurrentPreset);
    $("presetDelete").addEventListener("click", deleteCurrentPreset);
    $("presetExport").addEventListener("click", exportPresetPack);
    $("presetImport").addEventListener("click", () => $("presetImportFile").click());
    $("presetImportFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importPresetPack(f); e.target.value = ""; });
    $("resetPreset").addEventListener("click", () => {
      if (!confirm("Reset all style controls to defaults and reload? Your loaded transcript, audio and any text edits will be cleared.")) return;
      try { localStorage.removeItem("wxc.style"); } catch (e) {}
      location.reload();
    });
    $("loadSample").addEventListener("click", loadSample);

    // drag & drop
    const dz = $("dropzone");
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (e) => {
      for (const f of e.dataTransfer.files) {
        if (/\.(json|srt|vtt|txt)$/i.test(f.name)) { state.baseName = f.name; readFile(f, (t) => loadTranscriptText(f.name, t)); }
        else if (/\.(ttf|otf|woff2?)$/i.test(f.name) || /^font\//.test(f.type)) loadFontFile(f);
        else if (/^(audio|video)\//.test(f.type)) setAudioFile(f);
        else if (/^image\//.test(f.type)) setBgImageFile(f);
      }
    });

    audio.addEventListener("play", () => { if (!state.playing) play(); });
    audio.addEventListener("pause", () => { if (state.playing && audio.currentTime < audio.duration) pause(); });
    audio.addEventListener("ended", pause);
    window.addEventListener("resize", resizePreview);
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); state.playing ? pause() : play();
      }
    });

    // reflect any restored anim slider labels
    updateAnimLabels();
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
