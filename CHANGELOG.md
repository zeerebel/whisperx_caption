# Changelog

All notable changes to **WhisperX Caption Studio**. The app version is shown
in the footer (`APP_VERSION` in `js/app.js`) so you can always tell which
build a deploy is serving.

## v1.12.1 — Background-tab export stalls; crop feedback
- **Fixed: an export left in a background tab could take hours** (a real one
  ran 10+ hours without finishing). The frame loop yielded to the browser
  every 4 frames via `setTimeout`, and browsers clamp timers in hidden tabs
  hard — Chrome's "intensive throttling" fires them as little as **once a
  minute**. A long clip has thousands of those yield points (~10,000 on a
  23-minute clip at 30 fps), each a potential minute-long stall the moment
  you switch tabs. The loop now yields on wall time (~60 ms since the last
  yield) instead of a frame count, which cuts the number of clamp-exposed
  timers by orders of magnitude *and* speeds up the foreground case. The app
  also warns while an export is running in a hidden tab (progress line while
  hidden, toast when you return): keep the tab visible until it finishes.
- **Crop-to-band no longer skips silently.** When the computed caption strip
  would cover nearly the whole frame (huge font + tall animation travel +
  wide vertical span), the exporters legitimately fall back to full-frame —
  but with no indication, which read as "the crop doesn't work / still full
  screen". Both the PNG-sequence and `.mov` success lines now say the crop
  was skipped and why.
- The PNG-sequence success line now states the output dimensions and strip
  placement (the `.mov` line already did), so you can confirm the crop from
  the UI instead of opening the zip's README.txt.

## v1.12.0 — Fix broken .mov export; much tighter caption strip
- **Fixed: the one-click `.mov` export failed** ("ArrayBuffer is already
  detached") on any clip with more than one silent frame — i.e. almost every
  clip. Cause: v1.11.0's blank-frame reuse cached PNG bytes, but the ffmpeg
  worker *transfers* (detaches) the buffer it's handed, so the cached bytes
  died on their first use and the next silent frame crashed the export. Reused
  bytes are now copied before being handed to the encoder.
- **The caption strip is now sized to the caption, not a worst case.** The
  band's padding previously always reserved ≥120 px of animation headroom
  (even with animation off) plus 40% of the caption height. It now measures
  the *selected* animation's real vertical travel (zero for None / Fade /
  Wipe / Typewriter / Color Flash), counts box padding only when the box is
  visible, and uses a small glyph-overflow margin — on the sample at 1080p the
  strip shrank from 374 px to ~250 px tall, and captions without animation get
  the biggest win. Fewer pixels = proportionally faster PNG encode + smaller
  files.
- **Static captions are encoded once per cue.** With no intro animation and no
  word-by-word color (karaoke / active-word pill), every frame of a caption's
  hold is identical — the PNG is now encoded once and reused for the whole
  hold, the same way silent gaps already reuse one blank frame. Segment-only
  transcripts (SRT/VTT) with animation off export dramatically faster.
- **Cue lookup during export is O(1) per frame** (monotonic pointer) instead
  of scanning the whole cue list every frame — noticeable on long transcripts
  (the scan was frames × cues).
- Both video exporters now share one frame-render loop (`renderExportFrames`),
  so future fixes apply to the PNG sequence and the `.mov` equally.

## v1.11.0 — Caption-band export (much faster on long clips)
- **Crop to caption band** (Export tab, on by default): the transparent PNG
  sequence and one-click `.mov` now render only the horizontal **strip** the
  captions actually occupy instead of the whole frame. Because the per-frame
  cost (canvas clear + PNG encode) scales with pixel count, a lower-third strip
  is typically **~3–4× faster to export and produces a smaller file** — the win
  is largest on tall 9:16 clips and long transcripts (a 23-minute song was the
  motivating case). The band is computed from the same layout the renderer uses,
  padded for outline/shadow/box and animation motion, and **anchored to the
  caption's vertical alignment** so placement stays trivial: a bottom-aligned
  strip keeps the frame's bottom edge (drop it in and bottom-align exactly like
  before). The `.zip` README (and the `.mov` status line) state the exact
  `X=0, Y=…` placement and the full frame size. Untick the box for the classic
  full-frame overlay you drop at `0,0`.
- **Silent-gap frame reuse:** a blank (no-caption) frame is PNG-encoded once and
  its bytes reused for every gap frame, so instrumental/silent stretches cost
  almost nothing to export. Output is still a normal gap-free numbered sequence.

## v1.10.0–1.10.2 — In-app Guide + Export tab polish
- Added an in-app **Guide** tab documenting the local Demucs + WhisperX
  PowerShell pipeline (with a safe PowerShell 7 one-liner), and made the
  **Export** tab visually distinct so it's easy to find.

## v1.9.4 — Real backdrop art
- Replaced the placeholder backdrop with the neon portrait artwork supplied
  by the author (assets/backdrop.jpg). Same layer system: gradient veil at
  ~15%, frosted translucent surfaces on top.

## v1.9.3 — Backdrop image, translucent surfaces, themed donate button
- Full-page **backdrop image** layer (`assets/backdrop.jpg` — swap that file
  for your own art; it's cover-fitted). A dark **gradient veil** sits over it
  so the image reads at ~15% and the page stays consistent where nothing
  covers it.
- Panels, transport, cue list and tab cards are now **translucent + frosted**
  (rgba surfaces with backdrop blur): faint remnants of the image show
  through the boxes while text stays fully readable.
- **Buy me a coffee** button restyled to match the editorial theme: flat,
  square, condensed uppercase, quiet warm accent (no more glossy pink pill).
- Added this changelog; documented the CSS layer model at the top of
  `css/style.css`.

## v1.9.2 — Square editorial look, themed scrollbars, tabs closed by default (PR #14)
- Square frames everywhere (radius 0 on stage/panels/tabs/buttons/swatches);
  removed the blue glow ring and the always-on dashed dropzone border (the
  drag frame appears only while dragging).
- Asymmetric editorial header above the stage: offset **LIVE PREVIEW** title
  (condensed caps + hairline accent underline) left, italic annotation right.
- Scrollbars restyled to the surface family (dark thumb, transparent track).
- Tabs are **closed by default**; clicking a tab opens that section, clicking
  it again closes it.

## v1.9.1 — Tabbed control panel (PR #14)
- The right column became a single tabbed panel (Source / Grouping / Type /
  Color / Animation / Layout / Background / Export / Presets) — one section
  visible at a time instead of a long scroll of stacked accordions. All
  control ids preserved; hidden-tab values are still read by render/export.

## v1.9.0 — Cinematic UI redesign, mobile-friendly (PR #13)
- Dark "cinema" reskin: stage reads as a framed screen (dark two-tone
  transparency checker instead of a white swatch), inner vignette, film
  grain, deeper palette.
- Editorial display type via **self-hosted Oswald** (`fonts/`, ~13 KB per
  weight, same-origin — no font CDN).
- Mobile: single column, uncramped header, 40px+ touch targets, no
  horizontal overflow at phone widths.

## v1.8.2 — Footer portfolio link (PR #12)
- Footer "source" link replaced with "Check out more of my work ↗"
  → mongphu.com (repo still reachable via Help).

## v1.8.1 — Donation buttons (PR #11)
- Header **Buy me a coffee** (buymeacoffee.com/fusionmma) and footer
  **Donate (PayPal)** links.

## v1.8.0 — Native "Save As" for exports (PR #11)
- Every export (.mov, .webm, PNG frame, SRT/VTT/ASS/JSON) offers the
  browser's Save dialog (`showSaveFilePicker`) so you choose the name and
  folder; auto-named download remains the fallback (Firefox/Safari). Long
  exports grab the file handle up front (user-gesture requirement) and write
  when encoding finishes.

## v1.7.2 — Self-hosted ffmpeg.wasm encoder (PR #10)
- The .mov encoder is served from the app's own origin (`vendor/`,
  wasm gzipped to ~10 MB and gunzipped in the browser via
  DecompressionStream) so it works behind ad-blockers/firewalls that block
  the jsdelivr CDN. CDN kept only as a fallback. Fixes "encoder unavailable".

## v1.7.1 — .mov export fixed: QuickTime Animation default (PR #9)
- Root cause of ".mov encode failed": ProRes 4444 in the single-threaded
  wasm core is ~0.08× realtime at 1080p (~0.02× at 4K) and can exhaust the
  core's memory → no output. One-click .mov now defaults to **qtrle**
  (QuickTime Animation, RGBA — lossless alpha, ~20× faster, ~10× smaller for
  captions); ProRes 4444 stays selectable. Live "frame N / total" encode
  progress; out-of-memory is diagnosed with actionable guidance; a dead
  encoder core is dropped and reloaded cleanly (no hangs).

## Deploy automation (PR #8)
- `wrangler.toml` + GitHub Actions workflow: every push to `main` deploys the
  site to Cloudflare Workers (`whisperxcaption`). `.assetsignore` keeps
  `tools/`, `node_modules/`, etc. out of the upload.

## v1.7.0 — Handoff fixes: persistent edits + export safety (PR #7)
- **Inline text edits survive re-grouping** (timing sliders, presets):
  corrections write through to the model (per-word renames, spliced word
  runs, segment text); the edited flag and "was:" original are re-derived on
  every rebuild; revert restores the pristine transcription even after
  re-grouping.
- **Cancel button** for long exports; **.mov stall timeout** kills a wedged
  encoder; PNG-sequence zip **streams to disk** (`createZipStream`) when
  `showSaveFilePicker` is available so frames never accumulate in memory.

## v1.6.0 — Overnight batch (PR #6)
- Export-corrupting timestamp carry bugs fixed (SRT/VTT ms, ASS cs); VTT
  escaping; WebM canvas-capture leak and other memory fixes; preset-import
  validation; active-word "pill" highlight; first premium design pass.

## Earlier (PRs #1–#5)
- Named preset system + assColor fix; inline caption editing with original
  preserved + revert; ffmpeg helper commands (chroma WebM → transparent
  ProRes .mov + MP4); version footer; one-click in-browser transparent .mov
  export (ffmpeg.wasm).
