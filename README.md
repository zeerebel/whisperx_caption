# 💬 WhisperX Caption Studio

Turn a **WhisperX transcript** into **styled, animated captions** — pick the
font (or upload your own), colors, outline, karaoke highlight, motion effect and
layout, preview it against your audio, and export a **transparent PNG sequence**
you can overlay in any video editor, plus **SRT / VTT / ASS**. Everything runs
**in your browser**: no server, no upload, no cost. Your audio and transcript
never leave your machine.

It's a static site, so it drops straight onto **Cloudflare Pages** (or GitHub
Pages, Netlify, or just opening `index.html`).

**What it does**

- 🎬 **Transparent overlay export** — a PNG image sequence with a real alpha
  channel. Drop it straight over your footage in Premiere, DaVinci Resolve,
  Final Cut, After Effects or CapCut. No green screen needed.
- 🟩 **Chroma-key mode** — or render on solid green / blue / magenta and key it
  out, if you'd rather work with a flat video file.
- ✨ **18 motion effects** — fade, slide, pop, bounce, typewriter, word-by-word
  pop, blur-in, wave, drop-in… with speed + intensity controls.
- 🔤 **Any typeface** — 25 built-in web fonts or **upload your own** `.ttf`/`.otf`/`.woff`.
- 🎤 **Karaoke word highlight** driven by WhisperX word timings.
- 📐 **1080p, 4K, vertical 9:16 and square 1:1** at 24 / 30 / 60 fps.
- 📝 Still exports plain **SRT / VTT / ASS / JSON** for editors that want a caption file.

---

## The workflow

```
   your .mp3                 (runs once, on your computer)
      │   python tools/transcribe_whisperx.py my-clip.mp3
      ▼
   my-clip.json  ── WhisperX word-level transcript (forced-aligned)
      │   drop into the Caption Studio in your browser
      ▼
   style it  →  export  my-clip.srt / .vtt / .ass
```

You already run WhisperX to get the JSON. This tool is everything *after* that:
the part that used to mean paying for a captioning app.

### 1 · Get a word-level JSON from your MP3

WhisperX runs locally (free, offline, tight word timing via forced alignment):

```bash
pip install whisperx                 # needs ffmpeg installed
python tools/transcribe_whisperx.py "my-conversation.mp3"
# -> my-conversation.json
```

Already have a WhisperX/Whisper `.json`, or even an `.srt`/`.vtt`? Skip this —
the studio reads those directly (word-level karaoke needs the JSON, though).

### 2 · Open the studio and drop the JSON in

- **Transcript** — drag your `.json` (or `.srt`/`.vtt`) onto the stage.
- **Audio** — optionally drop the `.mp3` too, so the preview plays in sync and
  the words highlight karaoke-style.
- **Style** — font, size, weight, color, active-word color, outline, box,
  shadow, position, margins. Live preview updates as you tweak. Want your own
  typeface? Pick **Font → Upload font…** (or drop a `.ttf`/`.otf`/`.woff` on the
  stage). *Uploaded fonts show in the preview and VTT; to burn a custom font
  into video with ffmpeg the font must also be installed on that machine (or
  passed via `-vf "ass=file.ass:fontsdir=./fonts"`).*
- **Animation** — pick a motion effect and dial in speed + intensity.
- **Background** — *Transparent* (checkerboard = alpha, for overlay export),
  *Solid color* (green/blue/magenta, for chroma keying), or an *Image* preview.
- **Line grouping** — how words get chunked into caption lines (max words /
  chars / seconds, split on pauses and sentence ends).

### 3 · Export

Everything renders from the **same engine as the live preview**, so what you see
is what you get.

**Overlay video (with transparency)** — for dropping captions over your footage:

| Export | Alpha? | Best for |
|--------|--------|----------|
| **Transparent PNG sequence (.zip)** | ✅ true alpha | **The universal one.** Imports as an alpha overlay in *every* editor (Premiere, Resolve, FCP, After Effects, CapCut). Pick resolution + fps first. |
| **Single frame (.png)** | ✅ true alpha | A static lower-third / title / watermark. |
| **.webm (chroma)** | ❌ opaque | A flat video on your key color — key it out in the editor. (Browsers can't put a real alpha channel in WebM — see note below.) |

**Text caption files** — for editors/platforms that take a caption track:

| Format | What it's for |
|--------|---------------|
| **.srt** | Universal plain captions — YouTube, Premiere, CapCut, etc. |
| **.vtt** | Web captions (`<track>`); optional word-by-word timing. |
| **.ass** | Carries font/colors/outline/position + karaoke — burn into video with ffmpeg. |
| **.json** | Your styled cues + settings, to re-open or feed another tool. |

#### Using the transparent PNG sequence

The `.zip` contains gap-free numbered frames (`cap_00000.png …`) plus a
`README.txt` with the fps and resolution (a PNG sequence carries no timing of
its own — set the frame rate at import).

> **Crop to caption band** (Export tab, on by default) exports just the
> horizontal **strip** the captions sit in instead of the whole frame, so long
> clips render **~3–4× faster** and the file is smaller. The strip is aligned to
> your caption position — **bottom-aligned captions keep the same bottom edge**,
> so you drop it in and bottom-align exactly as before; the `README.txt` states
> the exact `X=0, Y=…` placement for top/middle layouts. Untick it for a
> full-frame overlay you drop at `0,0`.

- **Premiere:** File ▸ Import ▸ select `cap_00000.png` ▸ tick **Image Sequence**.
- **After Effects / DaVinci Resolve / Final Cut:** import the folder as a PNG
  sequence — the alpha is read automatically. Drop it on a track above your video.
- **Want one file instead of a folder?** The *Copy ffmpeg command* button gives
  you a one-liner to mux the frames into an alpha **ProRes 4444 `.mov`** (native
  in Premiere/FCP/Resolve/AE):
  ```bash
  ffmpeg -framerate 30 -i cap_%05d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le overlay.mov
  ```

> **Why not a transparent WebM/MP4 straight from the browser?** Browser video
> recording (MediaRecorder) **flattens transparency to solid black** — VP8/VP9
> can hold alpha, but the browser encoder doesn't write it, and Premiere/FCP/
> Resolve won't read alpha WebM anyway. The PNG sequence (or the ProRes mux
> above) is the real, editor-compatible alpha path. The `.webm` button here is
> the *opaque* recorder for the chroma-key workflow only.

#### Long clip? Render it locally instead — no browser tab to babysit

**New to this? [`docs/LOCAL_CLI_GUIDE.md`](docs/LOCAL_CLI_GUIDE.md) walks through
every step from a blank folder, plain-language, no assumed knowledge.**

The same export, run headlessly on your own machine: `tools/render_export.mjs`
boots the real app in headless Chromium (the identical rendering code, so the
frames are pixel-for-pixel the same), saves **and unzips** the PNG sequence for
you, and can mux the `.mov` with your **native** ffmpeg. Two things make it the
better choice for anything longer than a few minutes: a script-driven headless
page is never a background tab (so the browser's hidden-tab throttling can't
stall the render), and native ffmpeg encodes far faster than the in-browser
encoder. No hosting, no upload — it's the local-pipeline sibling of
`tools/transcribe_whisperx.py`.

```bash
npm install && npx playwright install chromium    # setup, once
node tools/render_export.mjs my-conversation.json --mov prores
# -> my-conversation_1920x1080_30fps_png.zip  (kept, README.txt inside)
#    my-conversation_1920x1080_30fps_frames/  (extracted, import-ready)
#    my-conversation_1920x1080_30fps_overlay.mov  (alpha ProRes 4444)
```

**Getting your look into it:** style the caption in the app as normal — font,
color, animation, position, all of it — then hit **⬇ Style settings (.json)**
at the bottom of the Export tab. That downloads exactly what you built, in the
shape `--style` expects:

```bash
node tools/render_export.mjs my-conversation.json --style my-conversation.style.json --mov prores
```

`--res` / `--fps` / `--no-crop` mirror the Export tab, `--out` picks the
output folder; live progress + ETA prints in the terminal. No audio file
needed. If ffmpeg isn't installed the run still succeeds — the frames are the
deliverable, and the tool prints the exact mux command to run later. See
`node tools/render_export.mjs --help`.

**Burn the styled caption file onto a video** instead (the *Copy ffmpeg command*
button fills these in too):

```bash
# caption an existing video with the .ass (keeps your exact look)
ffmpeg -i input.mp4 -vf "ass=my-conversation.ass" -c:a copy output.mp4
```

---

## Supported input shapes

The parser normalizes all of these automatically:

- **WhisperX** JSON — `segments[].words[]` with `start`/`end`/`word` (best; word timing → karaoke)
- **WhisperX** flat `word_segments[]`
- **OpenAI** `verbose_json` (`timestamp_granularities=["word","segment"]`)
- **Amoeba** karaoke sidecar — `{ "words": [{ "t", "d", "w" }] }`
- **SRT / VTT** — block-level timing (no per-word karaoke)

Words that WhisperX leaves untimed (bare numbers, symbols) get their timing
interpolated from their neighbours, so nothing is dropped or mistimed.

---

## Deploy to Cloudflare Pages

No build step — it's plain static files. See **[DEPLOY.md](DEPLOY.md)**. Short
version: connect this repo in Cloudflare Pages, leave the build command empty,
set the output directory to `/`, deploy.

---

## Privacy

100% client-side. The only network request is loading Google Fonts (for the
typefaces you pick). Your audio and transcript stay in the browser tab.

## License

MIT — see [LICENSE](LICENSE).
