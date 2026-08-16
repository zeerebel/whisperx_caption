# Changelog

All notable changes to **WhisperX Caption Studio**. The app version is shown
in the footer (`APP_VERSION` in `js/app.js`) so you can always tell which
build a deploy is serving.

## v1.14.1 — Real-usage verification round: 5 fixes
Ran the app the way its owner actually uses it (not another code audit) via
three background verification agents: one (Fable) drove the real UI like a
customer would — trying every preset, animation, export format, and editing
flow, with visual evidence at each step; one composited the local CLI tool's
output onto a real video with native ffmpeg and pixel-diffed it against the
browser's own export (found nothing wrong with the tool itself — crop-band
math, both `.mov` codecs, and the browser→CLI style hand-off all verified
byte-for-byte correct); one tested real transcript shapes and a genuine
42.5-minute clip to directly re-confirm the original 10-hour-stall complaint
stays fixed at scale — and found a new, real failure mode specific to that
scale (below). Five real issues found across the three agents, all fixed:
- **Fixed: applying ANY caption-style preset silently reset the export's
  resolution, FPS, crop-band, and codec to their defaults.** A real
  regression from this session's own earlier v1.13.0 preset field-bleed fix
  (`DEFAULT_STYLE` fallback in `applyPreset()`) — that fix correctly stopped
  *visual* fields (margins, grouping, etc.) from bleeding between presets,
  but it applied the same reset-to-default logic to `STYLE_KEYS`' *output*
  fields too (`optRes`/`optFps`/`optCropBand`/`optMovCodec`/etc.), even
  though no preset — built-in or user-saved — ever specifies them. The app's
  own original code comment already stated presets should leave "export
  resolution/fps and background mode untouched"; this restores that.
  Concretely: pick Vertical 1080×1920 for a Shorts/Reels export, browse
  presets to find a look, and the export would silently come back landscape
  unless you noticed and reset it yourself. `applyPreset()` now explicitly
  skips a dedicated `OUTPUT_KEYS` set — session persistence and the CLI
  style.json handoff (which both still want the full field set) are
  unaffected.
- **Fixed: exporting a single-frame PNG with the playhead paused in a
  silence gap always exported the clip's very FIRST caption**, regardless of
  where the playhead actually was — `cueNear(t)` (added alongside the
  trim-range feature to find the nearest cue) was only consulted when a trim
  range was active; an ordinary un-trimmed gap always fell straight through
  to `state.cues[0]`. Now used unconditionally.
- **Added: a `beforeunload` warning when leaving the page with unsaved inline
  caption edits.** Corrections made in the cue-editing strip are never
  auto-saved anywhere; an accidental refresh or tab close used to throw that
  work away with zero warning.
- **Fixed: OpenAI `verbose_json` transcripts (`timestamp_granularities:
  ["word","segment"]`) doubled every caption.** That shape puts word timing
  in a top-level `words[]` parallel to `segments[]`, not nested inside each
  segment — `parse.js` only ever set a segment's `hasWords` from its own
  nested array, so every segment looked word-less and the v1.13.0
  zero-word-segment fallback (correctly built for real word-less markers
  like `[applause]`) fired for all of them anyway, on top of the real
  word-grouped cues. Fixed by marking every segment `hasWords=true` once the
  top-level array has actually been consumed as the file's sole source of
  word timing (same fix covers the pre-existing flat `word_segments[]`
  case, which had the identical latent bug, just never previously
  exercised by a real transcript in this shape).
- **Fixed: the local CLI tool (`tools/render_export.mjs`) could fail near
  the finish line on a genuinely long (40+ minute) render, losing all
  rendered work.** Root cause: the CLI always uses the browser's in-memory
  zip fallback (there is no native save dialog to script), which holds every
  rendered frame as a separate Blob until the whole render finishes, then
  reads them all back at once. Chromium's blob storage is not guaranteed to
  keep tens of thousands of them valid for the many minutes a long render
  takes — reproduced empirically: a single-shot ~61,000-frame export failed
  reproducibly at ~93% completion with a Chromium blob-eviction error, twice
  in a row, while chunks under ~12,000 frames completed reliably every time.
  The CLI now auto-splits any export over 10,000 frames (configurable via
  `--chunk-frames`) into safe-sized chunks using the trim-range feature,
  stitching the extracted frames back into one continuous, correctly-
  numbered sequence — verified pixel-identical to an unchunked render of the
  same clip. Crop-to-caption-band is forced off for a chunked render (each
  chunk would otherwise see only its own slice of captions and could get a
  different band size), with a clear on-screen note explaining why.

## v1.14.0 — Trim export range, Screen Wake Lock, accessibility/mobile pass
Two background agents ran in parallel (isolation risk noted and handled — see
below), plus a Screen Wake Lock fix done directly. Every change verified with
its own regression test; the full existing suite plus 10 new tests all pass.

- **Added: trim the export to a time range.** Open thread #3 from v1.12.x —
  "probably the single biggest lever for 'exports take too long' generically."
  Two new fields on the Export tab, "Trim start" / "Trim end" (mm:ss.s or
  plain seconds), default blank = the full clip (a true no-op for anyone who
  doesn't touch them). All four export paths (PNG sequence, `.mov`, WebM,
  single-frame PNG) now render only the trimmed range — frame 0 of an export
  corresponds to the trim start, not absolute t=0. `computeCaptionBand` only
  sizes the crop-band around cues that actually fall inside the trimmed
  range, so a caption outside the export window doesn't inflate the strip. A
  cue already playing at the trim boundary keeps rendering for its natural
  remaining duration rather than being cut off. Composes with every existing
  safety guard (the state.exporting checks, the WebM/4-GiB-zip memory
  warnings, the bottom-edge clamp) since they all key off the same
  now-trim-aware `frameCount`/duration values. Trim resets automatically when
  a different transcript is loaded (a range from the old clip is almost
  certainly wrong for the new one) but survives timing/grouping changes on
  the same transcript. Not persisted to presets/localStorage — it's tied to a
  specific transcript's timeline, not a reusable style choice.
- **Added: Screen Wake Lock during export** — open thread #4. If the device's
  screen locks/sleeps mid-export, JS execution pauses entirely until manually
  woken, a different failure mode than tab-backgrounding (already mitigated
  in v1.12.1) that would also explain an export left running overnight and
  never finishing. `navigator.wakeLock` now holds the screen on for the
  export's duration, released on completion/cancel/error, and re-acquired if
  the tab is hidden then returns to the foreground (the spec auto-releases
  the lock the instant a tab hides). Unsupported browsers no-op safely.
- **Accessibility fixes**, found and fixed by an audit pass, each verified
  with a real headless-Chromium keyboard-only walkthrough:
  - The cue-editing strip was entirely mouse-only — the timestamp (seek) and
    caption-text (edit) elements had click handlers but no way to reach or
    activate them from the keyboard.
  - Focus silently dropped to `<body>` after every cue edit (the strip
    rebuilds from scratch on commit/cancel, destroying whatever had focus).
  - Escape stopped cancelling the cue editor once focus moved to the Save
    button via Tab (the handler only lived on the text input).
  - The tab widget had the ARIA roles but no `aria-selected`/`aria-controls`/
    `aria-labelledby`, so a screen reader couldn't tell which tab was open.
  - Four controls had no accessible name at all: the "↺ revert" button
    (icon-only, title-only) and the playback scrubber and custom chroma-key
    color picker (no label source of any kind).
- **Fixed: the Guide tab forced horizontal scroll on a phone.** `.layout`'s
  mobile breakpoint used a bare `1fr` grid column, which CSS Grid will not
  shrink below its widest descendant's min-content width — the Guide tab's
  long `ffmpeg`/CLI command lines (already wrapped in their own
  `overflow-x:auto` `<pre>`) blew the whole page out to ~1264px anyway. Fixed
  with `minmax(0,1fr)`.
- **CLI tool (`tools/render_export.mjs`) edge cases**: a directory passed as
  the transcript path, or `--out` pointing at an existing non-directory file,
  produced a raw Playwright/Node stack trace instead of the CLI's usual
  clean one-line failure. Both now validated up front, matching every other
  bad-input case in the file. (A broad re-check of other edge cases — empty
  transcripts, malformed `--res`/`--fps`, the 65535-frame and 4-GiB zip caps,
  re-running into a directory with existing output — found those already
  handled correctly from prior rounds; see the audit's full report in this
  session's history for the complete checked-and-solid list.)
- **Known, deliberately unfixed**: small italic UI text over the live-preview
  backdrop photo measures under WCAG AA contrast at some backdrop positions
  (decorative only, not a control) — a real fix is a visual-design call on a
  hand-crafted theme, flagged rather than unilaterally changed. Checkbox/
  slider touch-target sizes are below the 24×24px guideline but are
  pre-existing and identical on desktop, not a mobile-specific regression.
- **Process note**: this batch was built by two background agents working in
  the same live checkout at the same time (an export time-range feature and
  an accessibility/mobile/CLI audit), which is not normally how this project
  ships — a `git stash` incident occurred mid-flight from the resulting file
  contention. Recovered cleanly (verified via full diff review + the entire
  regression suite passing before merge) but confirms concurrent agents need
  isolated worktrees, not a shared working directory, next time this pattern
  is used.

## v1.13.0 — Multi-model audit round 2 (19 dimensions, adversarially verified)
A fanned-out audit workflow reviewed the app across 19 dimensions (export
correctness, parsing/data-integrity, presets, memory/perf, the CLI tool, and
more) using a mix of models/effort levels, with every finding independently
cross-checked by a second pass before being trusted. 23 findings confirmed
and fixed; each fix has a targeted regression test in `scratchpad/e2e/` and
the full suite was re-run clean after every batch.

- **Fixed: boxed captions with a scale animation (or even just a large static
  box pad) could clip past the physical bottom/top/side edge of the frame** —
  this is **open thread #1 from v1.12.2, now resolved.** `layout()` positioned
  a bottom-aligned block with zero reserve for the scale-animation/box growth
  applied later purely as a `ctx.scale()` transform in `drawCaption`, which
  `layout()` has no visibility into. Rather than threading `anim` into the
  shared preview+export positioning function (the originally-scoped fix, which
  would have needed retuning every alignment case), added a general
  `clampOnFrame()` step in `drawCaption` that measures where the scaled+
  translated line's edges actually land in device pixels and pulls them back
  inside a small safety margin — works for any alignment, animation, or
  crop-band setting, not just the reported bottom+zoom-in combination.
  Verified pixel-exact: zero edge-touching alpha across bottom/top/middle
  vAlign, horizontal-center, static boxes, and all 3 scale animations, with
  crop both on and off; the existing 7-test + 48-combo matrix suite is
  unaffected (identical crop-band dimensions as before).
- **Fixed: loading a new transcript while an export was running silently
  corrupted the output.** `computeCaptionBand` and `exportWebm`'s per-frame
  `cueAt(t)` read `state.cues`/`state.duration` live; if a transcript swap
  landed in one of the several `await` gaps an export runs through (font
  loading, the save-file picker), the render loop could end up drawing the
  NEW transcript's captions into a frame count computed from the OLD
  transcript's duration — a zip whose frame count and caption content
  silently disagreed. Fixed at the single choke point every load path funnels
  through (`loadTranscriptText`): now refuses to load while `state.exporting`
  is true, with a toast telling the user to cancel the export first (the file
  input is also disabled for the same window). Verified by racing a real
  transcript swap against a real in-flight export and confirming both the
  guard toast and the untouched original content.
- **Fixed: the real-time WebM export had no memory guard at all**, unlike the
  PNG-sequence and `.mov` paths — `MediaRecorder` only hands back its combined
  Blob at `stop()`, so the whole clip's encoded bytes sit in memory for the
  entire recording (a 42-minute clip at the default 12 Mbps bitrate is
  ~3.8 GB). Added the same kind of up-front, dismissible size-estimate warning
  the other two export paths already had, and switched `MediaRecorder.start()`
  to a 1-second timeslice so it flushes periodically instead of buffering the
  whole clip internally until stop().
- **Fixed: the PNG-sequence export's 4 GiB `.zip` cap (a hard limit of the
  STORE-only, non-ZIP64 format) only surfaced as a failure once a running
  export actually crossed it** — for a long/high-res clip that could be deep
  into a render that already took many minutes. Added an up-front, dismissible
  estimate before rendering starts, so the user finds out before spending that
  time, not after.
- **Fixed: a zero-word transcript segment (real text, but alignment produced
  no per-word timing — common for music/applause/crosstalk markers like
  `[applause]`) silently vanished** instead of becoming a caption. `buildCues`
  now merges a segment-level fallback cue for exactly those segments,
  chronologically interleaved with the word-based ones, each tagged with an
  explicit `_segIdx` back-reference so inline editing keeps tracking the right
  source segment even when word-based and segment-based cues are interleaved.
- **Fixed: a malformed non-numeric timestamp (e.g. `"start": "N/A"`) produced
  `NaN`**, which survives every downstream `!= null`/`?? 0` guard and silently
  corrupts interpolation, the renderer's cue-visibility check, and every
  exported timestamp field. `parse.js`'s `num()` now treats a `NaN` result as
  missing, same as `null`/`undefined`/`""`, so it gets interpolated instead.
- **Fixed: preset save/update/delete/import always reported success even when
  nothing persisted.** `setUserPresets` swallowed `localStorage.setItem`
  failures (quota exceeded, private-browsing storage blocks) without telling
  its callers; all four call sites now check its return value and show an
  error toast instead of a false "✓ Saved" — verified by forcing `setItem` to
  throw and confirming each of the three user-facing toasts.
- **Fixed: switching between built-in presets that don't specify the same
  fields let values bleed across.** Applying "Bold Yellow (Hormozi)" (sets
  `optMarginY`/`optMaxWidth`/`optMaxWords`/`optMaxChars`) and then "Clean
  White" (doesn't mention any of those) left Hormozi's values in place instead
  of resetting to the app's true defaults. Fixed by capturing a `DEFAULT_STYLE`
  snapshot once at boot (before any preset is ever applied) and falling back
  to it for any key a preset's style object omits.
- **Fixed: a stale `editingIndex` made re-clicking a caption's edit button a
  silent no-op.** Any full cue re-group (loading a new transcript, changing a
  timing control like Max chars/line) rebuilds every row from scratch as
  plain, non-editing rows, but the module-level `editingIndex` tracking which
  row had an editor open wasn't reset — so `enterEditMode`'s
  `editingIndex === i` short-circuit believed a since-rebuilt row was already
  being edited and did nothing on the next click. Now reset inside
  `rebuildCues()`.
- **Fixed: the ETA display could show `"1m 60s"` instead of `"2m 0s"`** at
  second-boundary crossings — the minutes/seconds/hours fields were each
  floored independently from the un-rounded remaining time instead of from one
  rounded total, so a value like `59.6s` split into `m=0, s=59.6→59` while a
  *different* rounding of the same instant would carry to `1m`. Now rounds the
  total once and derives every field from that single integer.
- **Fixed: ASS karaoke (`\kf`) timing could drift tens–100ms from the cue's
  actual end on a long, many-word cue.** Each word's `\kf` duration was
  rounded to centiseconds independently, summing every word's own rounding
  error across the cue. Now rounds each word's *cumulative* end time (from the
  cue start) and takes the difference from the previous cumulative point,
  bounding total drift to a single rounding step regardless of word count.
- **CLI tool (`tools/render_export.mjs`) robustness** — was silently
  mis-handling or crashing on: SRT/VTT transcripts (misreported as "not valid
  JSON" even though the app natively supports them); a `--mov` codec typo
  positioned before the transcript arg (silently absorbed the typo as the
  transcript path); a corrupt zip entry (unhandled `EventEmitter` 'error'
  throw bypassing cleanup); Ctrl+C (raw Playwright stack trace instead of a
  clean exit code); an invalid `--style` value for any control (silently set
  whatever the browser control coerced it to instead of failing); a custom/
  uploaded font referenced by a style file (silently fell back to a system
  font with no indication); and a Google Fonts network failure for the
  selected font (silently rendered in a fallback typeface). All now fail
  loudly with a clear message and non-zero exit instead of silently producing
  wrong output — verified live against a real network-restricted sandbox for
  every case above.

## v1.12.4 — Style hand-off to the local CLI tool
- **Added: ⬇ Style settings (.json)** button at the bottom of the Export tab.
  Downloads the exact look you built in the app — font, colors, animation,
  position, everything — in the shape `tools/render_export.mjs --style`
  expects. Closes the gap between "design it in the browser" and "render it
  locally": before this, there was no way to hand your styling off to the CLI
  tool without manually digging the settings out of browser storage. Verified
  end-to-end: applied a preset through the real UI, downloaded the file,
  fed it into the CLI cold (no browser state), confirmed the rendered output
  reflects the exact style (pixel-level check on the box/animation).

## v1.12.3 — Live export ETA
- **Added: a self-calibrating time estimate during export.** Rather than a
  hardcoded guess (actual speed varies enormously by machine, resolution,
  codec, and animation), each export phase times itself against the real
  device from the first ~15 frames / 1.5s onward and appends `— ~Xm Ys left`
  to the progress line, continuously recalculated from actual measured
  throughput. A stall — a slow codec, a huge clip, a backgrounded tab getting
  throttled — now shows up as a ballooning ETA within seconds instead of
  silence for hours. Applies to both the PNG-sequence render loop and the
  `.mov` ffmpeg encode phase; the ETA text never appears on the final success
  line. Motivated by a real report of a 42-minute export left running for 10
  hours with no way to tell if it was working — see `docs/HANDOFF.md` for the
  measured throughput numbers behind this and codec/duration guidance.

## v1.12.2 — Multi-model audit fixes
Found by a fanned-out audit (five independent finders across different models,
each finding adversarially cross-checked, plus a headless-browser agent that
drove the real app and validated behavior empirically — see `docs/HANDOFF.md`
for the full breakdown).
- **Fixed: every `.ass` export had a stray extra field**, shifting the caption
  text one column out of alignment with a literal leading comma on every line
  (`Dialogue: 0,start,end,Caption,,0,0,0,,text` had one comma too many vs. the
  declared 9-field `[Events] Format` — libass and any compliant parser read
  the text as `,Hello world` instead of `Hello world`). This is the app's
  flagship styled export format; it was broken on 100% of `.ass` exports.
- **Fixed: a PNG-sequence export could finish a multi-minute render and then
  discard the whole thing.** The zip writer's entry-count cap (65,535, a
  16-bit field) counts the README.txt entry the exporter always appends, but
  nothing checked `frameCount + 1` against that cap before rendering — so a
  clip landing at exactly 65,535 frames (~36 min at 30fps) would render
  completely, stream every frame to disk, and only then throw on the README
  add, discarding the finished file. Now checked up front, before any
  rendering starts.
- **Fixed: a boxed caption with a scale-up animation (Zoom In, Bounce In) at
  high intensity could clip against the crop-band edge.** `computeCaptionBand`
  reserved headroom for the *text block's* animation growth but not for the
  *box padding's* growth — the box scales around the same center as the text,
  so at max zoom/bounce the box edge could poke past the band boundary the pad
  was supposed to guarantee. Fixed by scaling the reserved headroom with the
  effective box padding, not just the block height.
- **Fixed: a failed/OOM `.mov` encode leaked the ffmpeg.wasm worker.** On
  encode failure the code dropped its reference to the worker without calling
  `ff.terminate()`, so the wasm heap and every already-written frame stayed
  resident — and the error message inviting a retry meant each failed attempt
  stacked another leaked worker on top, making the next attempt's OOM more
  likely. Both failure paths now terminate the worker before dropping it.
- **Fixed: cancelling the PNG-sequence save-file dialog left the status line
  stuck** on "Choose where to save the .zip…" indefinitely (every other cancel
  path in the app clears its status; this one didn't).

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
