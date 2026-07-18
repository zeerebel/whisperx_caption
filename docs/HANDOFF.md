# Handoff — WhisperX Caption Studio

Snapshot to continue in a fresh session/thread. Written 2026-07-07, last updated 2026-07-18.

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
- **Live on main: v1.12.1** (PR #27 → v1.12.0, PR #28 → v1.12.1, both merged
  2026-07-18) — confirmed actually serving live via a clean Cloudflare deploy
  log (see "Deploy pipeline was silently landing stale builds" below).
- **v1.12.0** (PR #27) fixed the `.mov` export that v1.11.0 had broken for
  almost every clip (ffmpeg's `writeFile` *transfers/detaches* the buffer, so
  the cached blank-frame bytes died on first reuse → "ArrayBuffer is already
  detached" on any clip with more than one silent frame), sized the caption
  strip to the caption + the selected animation's real travel instead of a
  ≥120 px worst case (strip shrank ~374px → ~232px on the 1080p sample), added
  static-caption-hold reuse (one encode per unanimated cue), and made
  per-frame cue lookup O(1). Both video exporters share `renderExportFrames`.
- **v1.12.1** (PR #28) fixed two problems the app's owner hit in real use:
  1. **A 10+ hour export that never finished.** Root cause: the export loop
     yielded to the browser every 4 frames via `setTimeout`, and browsers
     clamp timers hard in **backgrounded tabs** — Chrome's intensive
     throttling can fire them as little as once a *minute*. A long clip has
     thousands of those yields (~10,000 on a 23-minute clip at 30fps); the
     moment the tab isn't in the foreground, each one is a potential
     minute-long stall — easily adding up to "still not done after 10
     hours." Fix: yield on wall time (~60ms since the last yield) instead of
     a frame count — far fewer clamp-exposed timers — plus a visible warning
     (progress line + toast) when the tab goes hidden mid-export, telling the
     user to keep it visible. This is a mitigation, not the cure — see open
     thread #1 below for the real fix.
  2. **Exports that still looked full-screen.** `computeCaptionBand` silently
     falls back to a full-frame export when the computed band would cover
     almost the whole frame (large font + high animation intensity + tall
     caption span) — with zero indication, so it read as "the crop feature
     doesn't work." Both exporters now say so on screen when it happens, and
     the PNG-sequence success line now states output dimensions/placement at
     all (it previously said nothing; the `.mov` line already did).
  - Implemented by a subagent (Fable model) on maintainer instruction, code
    reviewed by the orchestrating session, `node --check` passes. **Not
    verified in a real browser** (no browser harness in this environment) —
    spot-check: start a long export, switch tabs away and back, confirm the
    warning/toast appear and the export still completes; also confirm the
    PNG-sequence success line now shows dimensions.
- Full history in `CHANGELOG.md`.

## Deploy pipeline was silently landing stale builds (fixed, PR #29)
After merging #27 and #28, the live site kept serving old `js/app.js`
(`APP_VERSION` stuck at `1.12.0` even after #28 shipped `1.12.1`) despite
`.github/workflows/deploy.yml` showing a **green** checkmark both times.
Reading the *actual* Wrangler output (not just the job conclusion) showed why:

```
+ /.git/shallow
+ /.git/objects/6c/6587b560ad70e266cde6328cdd7c8df9f54184
+ /.git/config
+ /.git/index
...
Asset upload failed. Retrying...
 APIError: Received a malformed response from the API
```

`wrangler.toml` sets `[assets].directory = "."` (the whole repo root), so
`.assetsignore` is the *only* thing keeping non-site files out of the
Cloudflare upload — and it never excluded `.git/`. Since `actions/checkout@v4`
does a fresh shallow clone every run, `.git`'s internal objects/refs are
different on every single deploy, so they always look like "new or modified"
assets to Wrangler, and Cloudflare's assets-upload-session API can't handle
them — corrupting the upload partway through. **`cloudflare/wrangler-action@v3`
did not fail the GitHub Actions job when this happened**, so there was no
visible signal anything was wrong; the job just quietly redeployed whatever
assets *did* make it through (i.e., stale ones for anything queued after the
first `.git` object it choked on).

Fix (PR #29): added `.git/` and `.wrangler/` to `.assetsignore`. Confirmed
fixed — the next deploy uploaded exactly the 3 files that had actually
changed (`CHANGELOG.md`, `docs/HANDOFF.md`, `js/app.js`), no `.git` paths in
the list, completed in 28s (vs. 1+ minute of retries before), and printed a
clean `Current Version ID`. **If a future deploy ever "succeeds" but the
footer version doesn't match what you just shipped, don't trust the green
checkmark — pull the actual job log and look for `Asset upload failed` /
`malformed response` before assuming it's a caching issue.**

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
- **A green deploy checkmark does not guarantee the live site updated** — see
  "Deploy pipeline was silently landing stale builds" above.

## Open threads
1. **The real fix for background-tab stalls: move frame-render + PNG-encode
   into a Web Worker + OffscreenCanvas.** v1.12.1's wall-time yield + hidden-tab
   warning are mitigations (fewer clamp-exposed timers, and telling the user
   why it's slow) — they don't eliminate the throttling, they reduce exposure
   to it and communicate it. Doing the actual render/encode off the main
   thread sidesteps page-visibility timer throttling entirely. Bigger lift,
   deserves its own session; the ffmpeg encode itself already runs in a
   Worker, only the canvas render + PNG encode (`renderExportFrames`) is on
   the main thread today.
2. **Let the user trim the export time range.** Probably the single biggest
   lever for "exports take too long" generically — most exports don't need
   the full clip, and a shorter range beats optimizing the encode of frames
   nobody wants. Not built yet.
3. **Screen Wake Lock during export** (`navigator.wakeLock`) — a different
   failure mode than tab-backgrounding: if the laptop screen locks/sleeps,
   JS execution pauses entirely until manually woken, which would also
   explain an export that "ran overnight and never finished." Cheap to add,
   not done.
4. **ProRes 4444 is known-slow/OOM-prone in-browser** (see Gotchas above) —
   worth a stronger nudge toward qtrle (already the default) or the PNG
   sequence + external `ffmpeg` command for anyone who picks it anyway.
5. **In-memory PNG-sequence fallback can OOM on long exports** in browsers
   without the File System Access API (Firefox, Safari) — the
   streaming-straight-to-disk path (`showSaveFilePicker`) only exists on
   Chromium. Not addressed.
6. **Premium Cloud Transcribe** — full plan in `docs/PREMIUM_PLAN.md`, and a
   draft implementation exists in (closed, unmerged) PR #23 — Cloudflare
   Worker + Replicate WhisperX + a "Cloud Transcribe" panel, fully inert
   until `REPLICATE_API_TOKEN`/`TRANSCRIBE_PASSPHRASE` secrets are set. User
   has Supabase + Stripe already for the eventual billed version; validate
   with a waitlist button before building billing.

## PR housekeeping (2026-07-18)
- **#25** (v1.11.0 caption-band), **#27** (v1.12.0 `.mov` fix + strip sizing),
  **#28** (v1.12.1 background-tab stall + silent-crop-skip fixes), **#29**
  (deploy pipeline fix, see above) — merged.
- **#26** (older `.mov` detached-buffer fix), **#24** (earlier horizontal-strip
  approach, predates #25), **#17** (frame de-dup, predates several shipped
  versions) — closed as superseded/stale.
- **#23** (Cloud Transcribe + hero `.mov` button) — still open as a draft, not
  merged; separate track from the export-reliability work above.

## What shipped this session (from the original "fix the handoff" task)
Handoff bug fixes (persistent edits, export cancel/streaming) → the whole `.mov`
saga (default to Animation; **self-hosted encoder** so it works behind CDN
blocks/firewalls) → Save As dialog → donation + portfolio links → deploy
automation → and the full cinematic **square editorial redesign** with a
**tabbed control panel**, self-hosted fonts, and a **backdrop-image** system.
See `CHANGELOG.md` for the version-by-version detail.
