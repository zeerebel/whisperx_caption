/* parse.js — normalize many transcript shapes into a common model, then group
 * timed words into readable caption cues.
 *
 * Normalized model:
 *   words    : [{ start:Number, end:Number, word:String }]   // seconds
 *   segments : [{ start, end, text }]                          // fallback if no words
 *
 * A "cue" (what becomes one caption block) is:
 *   { start, end, words:[{start,end,word}], text }
 */
(function () {
  const WXC = (window.WXC = window.WXC || {});

  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

  // ---- JSON: WhisperX, OpenAI verbose_json, WhisperX word_segments, Amoeba sidecar
  function fromJSON(data) {
    const words = [];
    const segments = [];
    const pushWord = (w, s, e) => {
      const text = String(w == null ? "" : w).trim();
      if (!text) return;
      words.push({ word: text, start: num(s), end: num(e) });
    };

    const segs = data.segments || data.Segments;
    if (Array.isArray(segs)) {
      for (const seg of segs) {
        const ws = seg.words || seg.Words;
        if (Array.isArray(ws) && ws.length) {
          for (const w of ws) pushWord(w.word !== undefined ? w.word : w.text, w.start, w.end);
        }
        const stext = String(seg.text || "").trim();
        if (stext) segments.push({ start: num(seg.start), end: num(seg.end), text: stext });
      }
    }
    // WhisperX also emits a flat word_segments[]
    if (!words.length && Array.isArray(data.word_segments)) {
      for (const w of data.word_segments) pushWord(w.word !== undefined ? w.word : w.text, w.start, w.end);
    }
    // Amoeba karaoke sidecar {words:[{t,d,w}]}
    if (!words.length && Array.isArray(data.words)) {
      for (const w of data.words) {
        if (w.t !== undefined) {
          const s = num(w.t);
          pushWord(w.w, s, s != null && w.d != null ? s + Number(w.d) : null);
        } else {
          pushWord(w.word !== undefined ? w.word : w.text, w.start, w.end);
        }
      }
    }

    fillMissingTimes(words);
    return { words, segments };
  }

  // Words with null start/end (WhisperX leaves numbers/symbols untimed) get
  // times interpolated from their neighbours so nothing is dropped or mistimed.
  function fillMissingTimes(words) {
    const n = words.length;
    for (let i = 0; i < n; i++) {
      if (words[i].start != null && words[i].end != null) continue;
      let a = i - 1;
      while (a >= 0 && words[a].end == null) a--;
      let b = i + 1;
      while (b < n && words[b].start == null) b++;
      const left = a >= 0 ? words[a].end : null;
      const right = b < n ? words[b].start : null;
      let j = i,
        run = 0;
      while (j < n && (words[j].start == null || words[j].end == null)) { j++; run++; }
      const lo = left != null ? left : right != null ? Math.max(0, right - 0.3 * run) : 0;
      const hi = right != null ? right : lo + 0.3 * run;
      const step = (hi - lo) / run;
      for (let k = 0; k < run; k++) {
        if (words[i + k].start == null) words[i + k].start = lo + step * k;
        if (words[i + k].end == null) words[i + k].end = lo + step * (k + 1);
      }
      i = j - 1;
    }
    // Guarantee monotonic, non-zero-length words
    for (let i = 0; i < n; i++) {
      if (words[i].start == null) words[i].start = i ? words[i - 1].end : 0;
      if (words[i].end == null || words[i].end <= words[i].start) words[i].end = words[i].start + 0.2;
    }
  }

  // ---- SRT / VTT text
  function fromSubtitles(text) {
    const segments = [];
    const clean = text.replace(/\r/g, "");
    const stampRe =
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;
    const blocks = clean.split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split("\n").filter((l) => l.trim() !== "");
      const idx = lines.findIndex((l) => stampRe.test(l));
      if (idx === -1) continue;
      const m = lines[idx].match(stampRe);
      const start = tsToSec(m[1]);
      const end = tsToSec(m[2]);
      const body = lines
        .slice(idx + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "") // strip VTT/karaoke tags
        .replace(/\{[^}]+\}/g, "")
        .trim();
      if (body) segments.push({ start, end, text: body });
    }
    return { words: [], segments };
  }

  function tsToSec(ts) {
    const s = ts.replace(",", ".");
    const parts = s.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(s) || 0;
  }

  // ---- dispatcher
  function parse(name, text) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "srt" || ext === "vtt") return fromSubtitles(text);
    // default: try JSON, fall back to subtitle
    try {
      return fromJSON(JSON.parse(text));
    } catch (e) {
      if (/-->/.test(text)) return fromSubtitles(text);
      throw new Error("Could not read this file as WhisperX JSON, SRT or VTT.");
    }
  }

  // ---- group words (or segments) into cues
  function buildCues(model, opts) {
    const o = Object.assign(
      { maxWords: 7, maxChars: 38, maxDur: 5, maxGap: 0.7, punct: true },
      opts
    );
    if (model.words && model.words.length) return cuesFromWords(model.words, o);
    // No word timings — one cue per segment, re-wrapped only if very long.
    return (model.segments || []).map((s) => ({
      start: s.start ?? 0,
      end: s.end ?? (s.start ?? 0) + 2,
      words: null,
      text: s.text,
    }));
  }

  function cuesFromWords(words, o) {
    const cues = [];
    let cur = [];
    const endsSentence = (w) => /[.!?…]["')\]]?$/.test(w);
    const flush = () => {
      if (!cur.length) return;
      cues.push({
        start: cur[0].start,
        end: cur[cur.length - 1].end,
        words: cur.slice(),
        text: joinWords(cur),
      });
      cur = [];
    };
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const gap = (w.start ?? prev.end) - prev.end;
        const nextText = joinWords(cur.concat(w));
        const tooLong =
          cur.length >= o.maxWords ||
          nextText.length > o.maxChars ||
          w.end - cur[0].start > o.maxDur ||
          gap >= o.maxGap;
        if (tooLong) flush();
      }
      cur.push(w);
      if (o.punct && endsSentence(w.word)) flush();
    }
    flush();
    return cues;
  }

  function joinWords(ws) {
    let out = "";
    for (const w of ws) {
      const t = w.word;
      if (out && !/^[.,!?;:…'’)\]}%]/.test(t)) out += " ";
      out += t;
    }
    return out;
  }

  WXC.parse = parse;
  WXC.buildCues = buildCues;
  WXC.joinWords = joinWords;
})();
