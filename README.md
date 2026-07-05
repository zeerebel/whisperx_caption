# 💬 WhisperX Caption Studio

Turn a **WhisperX transcript** into **styled captions** — pick the font,
colors, outline, karaoke highlight and layout, preview it against your audio,
and export **SRT / VTT / ASS**. Everything runs **in your browser**: no server,
no upload, no cost. Your audio and transcript never leave your machine.

It's a static site, so it drops straight onto **Cloudflare Pages** (or GitHub
Pages, Netlify, or just opening `index.html`).

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
- **Line grouping** — how words get chunked into caption lines (max words /
  chars / seconds, split on pauses and sentence ends).

### 3 · Export

| Format | What it's for |
|--------|---------------|
| **.srt** | Universal plain captions — YouTube, Premiere, CapCut, etc. |
| **.vtt** | Web captions (`<track>`); optional word-by-word timing. |
| **.ass** | **Carries your whole look** — font, colors, outline, position and karaoke. This is the one you burn into video. |
| **.json** | Your styled cues + settings, to re-open or feed another tool. |

**Burn the styled captions into a video** (the *Copy ffmpeg command* button
gives you these filled in):

```bash
# caption an existing video
ffmpeg -i input.mp4 -vf "ass=my-conversation.ass" -c:a copy output.mp4

# turn a still image + audio into a captioned video
ffmpeg -loop 1 -i background.jpg -i my-conversation.mp3 \
  -vf "ass=my-conversation.ass" -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac output.mp4
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
