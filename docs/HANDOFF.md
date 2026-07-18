# Handoff — WhisperX Caption Studio

Snapshot to continue in a fresh session/thread. Written 2026-07-07.

## What the app is
A 100%-client-side web app that turns a WhisperX transcript (`.json` / `.srt` /
`.vtt`) into styled, animated captions and exports them as a **transparent
overlay** (PNG sequence or alpha `.mov`) plus SRT/VTT/ASS/JSON. All processing
(parse, render, encode) runs in the visitor's browser — no backend, no cost per
use. That's why it's free.

## Deploy / hosting (important)
- Live site: **https://whisperxcaption.fusionmma.workers.dev** (Cloudflare
  Workers, static assets).
- **Auto-deploy:** every push to `main` runs `.github/workflows/deploy.yml`
  (`wrangler deploy`). Repo secrets `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID` are set. Config: `wrangler.toml`, `.assetsignore`.
- Version is `APP_VERSION` in `js/app.js`, shown in the footer — use it to
  confirm which build is live.

## Current version state
- **Live on main: v1.11.0** (caption-band export merged via PR #25).
- **In progress: v1.12.0** on branch `claude/export-caption-sizing-e85vyx` —
  fixes the `.mov` export v1.11.0 broke (ffmpeg's writeFile *transfers/detaches*
  the buffer, so the cached blank-frame bytes died on first use → "ArrayBuffer
  is already detached" on every clip with silence), sizes the strip to the
  caption + the selected animation's real travel instead of a ≥120 px worst
  case, reuses one encode per static caption hold, and makes per-frame cue
  lookup O(1). Both video exporters now share `renderExportFrames`.
- Full history in `CHANGELOG.md`.

## Performance: caption-band export (v1.11.0) — why long exports were slow
The motivating bug: a **23-minute** transcript exported for **3 hours and was
only ~1/5 done**. Cause: `exportPngSequence`/`exportMov` in `js/app.js` render
**and PNG-encode the entire frame** (`off.toBlob(…, "image/png")`) for **every
frame**, e.g. 23 min × 30 fps = ~41,400 full-resolution PNG encodes; at 4K each
encode is the dominant, pixel-bound cost. Fix (both share the pattern):
- **`computeCaptionBand(style, anim, w, h)`** measures, via the shared
  `WXC.render.layout`, the smallest vertical band that contains every cue across
  the clip, pads it (outline/shadow/box + animation travel), and **anchors it to
  `style.vAlign`** (bottom→strip bottom = frame bottom; top→strip top = frame
  top; middle→centered). Returns `{top,height,w,h}`, or `null` when a band gives
  no real win (falls back to full frame).
- The offscreen canvas is sized `w × band.height`; before the frame loop we
  `octx.setTransform(1,0,0,1,0,-band.top)` so `drawCaption` keeps using the FULL
  frame geometry but only the strip is rasterised (its own save/restore leave
  that base transform intact). Fewer pixels → proportionally faster encode +
  smaller output.
- **Empty-frame reuse:** the first no-cue frame's PNG bytes are cached and reused
  for every silent-gap frame (identical transparent output), so gaps cost ~0.
- Placement is written into the `.zip` README (`X=0, Y=<top>px`, plus the
  bottom-align hint) and the `.mov` success status line. Toggle: `#optCropBand`
  checkbox in the Export tab, **default ON**, persisted via `STYLE_KEYS`.
- Verified end-to-end with headless Playwright (drives the real UI, exports the
  sample, asserts exported PNG dimensions are the band with crop on and the full
  frame with crop off). Script lived in the scratchpad (not committed).

## Repo layout
- `index.html` — structure (header, stage/preview, tabbed control panel).
- `css/style.css` — cinematic square theme; **layer model documented at top**
  (backdrop image → gradient veil → translucent frosted surfaces → grain).
- `js/app.js` — UI wiring, canvas preview, all exports, tabs, presets.
- `js/parse.js` — normalizes transcripts → model → caption cues.
- `js/formats.js` — SRT/VTT/ASS/JSON output.
- `js/render.js` — `drawCaption` (preview + every exporter share it → WYSIWYG).
- `js/store-only-zip.js` — dependency-free ZIP (in-memory + streaming).
- `vendor/` — **self-hosted** ffmpeg.wasm (wasm gzipped ~10 MB, gunzipped in
  browser via DecompressionStream). CDN is fallback only.
- `fonts/` — self-hosted Oswald (display type).
- `assets/backdrop.jpg` — page backdrop; **replace this file to change it**.
- `tools/transcribe_whisperx.py` — the local WhisperX helper (not part of the site).

## Local transcription pipeline (PowerShell) — how the input JSON is made
This is the exact process a user runs today to produce the WhisperX `.json`
the app consumes. It's also **the pipeline the premium Cloud Transcribe
feature would automate server-side** (see `docs/PREMIUM_PLAN.md`).

1. **Isolate the vocals** with Demucs (two-stem split → cleaner transcription
   of lyrics, no music bleed):
   ```powershell
   demucs --two-stems=vocals "buffalo-stance.mp3"
   ```
   Output lands at `separated\htdemucs\<song-name>\vocals.wav`.

2. **Transcribe the isolated vocals** with WhisperX → WhisperX JSON:
   ```powershell
   whisperx "separated\htdemucs\buffalo-stance\vocals.wav" --model large-v2 --language en --output_format json --compute_type int8
   ```

One-liner (separate + transcribe in sequence):
```powershell
demucs --two-stems=vocals "common-people.mp3"; whisperx "separated\htdemucs\common-people\vocals.wav" --model large-v2 --language en --output_format json --compute_type int8
```

Notes:
- `--model large-v2` = accuracy; `--compute_type int8` = lower VRAM/CPU-friendly.
- `--language en` skips auto-detect (faster, avoids mis-detection on lyrics).
- The resulting `.json` is what you drop into the app's **Source** tab.
- The Demucs step is optional for clean speech, but it noticeably improves
  transcription of **sung lyrics** over a music bed.

### Troubleshooting / filename gotchas
- **Demucs always outputs `vocals.wav`** (from `--two-stems=vocals`) inside a
  folder named after the **input file**, i.e.
  `separated\htdemucs\<filename-without-extension>\vocals.wav`. Point WhisperX
  at *that* — not at the song's name, and not at a leftover folder from an
  earlier run.
- **Keep filenames simple** — letters/numbers/hyphens, **no spaces and no
  quote characters**. A stray "smart"/curly quote (`“` `”`) or space breaks
  PowerShell's quote parsing; the classic symptom is the second command's
  flags leaking into the first, e.g.
  `demucs.separate: error: unrecognized arguments: --model large-v2 …`
  (that means the `;` got swallowed and WhisperX's args were handed to Demucs).
  Fix: rename the file to something like `song.mp3` and rerun.
- **Run the two commands separately** (or on two lines). `;` runs the second
  even if the first failed, and WhisperX needs the `vocals.wav` Demucs makes.
- **Robust version for any filename** (derives the folder, avoids retyping the
  path — just use straight quotes `"` in `$in`, never curly):
  ```powershell
  $in = "my song.mp3"
  demucs --two-stems=vocals $in
  $name = [System.IO.Path]::GetFileNameWithoutExtension($in)
  whisperx "separated\htdemucs\$name\vocals.wav" --model large-v2 --language en --output_format json --compute_type int8
  ```

## Gotchas for the next dev
- **Every control has an `id` referenced by `js/app.js` — preserve ids** when
  editing markup. Sections are `.tabpanel[data-panel]`; `wireTabs()` toggles
  them (closed by default; click to open, click again to close).
- Controls in hidden tabs are still read by render/export (values, not
  visibility) — that's expected.
- `.mov` export defaults to **qtrle** (QuickTime Animation, RGBA — fast, small,
  true alpha). ProRes 4444 is selectable but heavy in-browser; it can OOM on
  long/4K clips (handled: live progress, OOM diagnosis, dead-core reload).
- Inline caption text edits **write through to the model** so they survive
  re-grouping (timing sliders / presets); revert restores the original.
- Backdrop: image in `body::before`, dark gradient **veil** over it (~15%
  visibility). Surfaces are translucent rgba + backdrop-blur. To show the art
  more/less, change the veil alphas in `body::before`.
- Testing was done with headless Playwright scripts kept in the scratchpad
  (not committed): serve the repo, drive the real UI, screenshot at 320/390/
  1280, and assert exports/edits. Re-create as needed.

## Open threads
1. **Merge the v1.12.0 PR** (branch `claude/export-caption-sizing-e85vyx`) —
   without it the one-click `.mov` export on main is broken.
2. **Further export speedups if still needed:** band, blank-gap reuse and
   static-hold reuse are done. Next levers (not done): a Web Worker /
   OffscreenCanvas encode so the tab stays responsive, and letting the user
   trim the export time range.
3. **Premium Cloud Transcribe** — full plan in `docs/PREMIUM_PLAN.md`. User has
   Supabase + Stripe already; recommended GPU = Replicate; API glue = a
   Cloudflare Worker; validate with a waitlist button before building billing.

## What shipped this session (from the original "fix the handoff" task)
Handoff bug fixes (persistent edits, export cancel/streaming) → the whole `.mov`
saga (default to Animation; **self-hosted encoder** so it works behind CDN
blocks/firewalls) → Save As dialog → donation + portfolio links → deploy
automation → and the full cinematic **square editorial redesign** with a
**tabbed control panel**, self-hosted fonts, and a **backdrop-image** system.
See `CHANGELOG.md` for the version-by-version detail.
