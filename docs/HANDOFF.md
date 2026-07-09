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
- **Live on main: v1.9.3.**
- **PR #16 is OPEN** on branch `claude/code-handoff-issues-q6we0f` and contains
  **v1.9.4** (real neon backdrop art) + **v1.9.5** (mobile drop-hint fix).
  → **Merge PR #16** to take the live site to v1.9.5.
- Full history in `CHANGELOG.md`.

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
1. **Merge PR #16** (v1.9.4 + v1.9.5).
2. The user's earlier message cut off at **"and also…"** — never clarified;
   worth asking.
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
