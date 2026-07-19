# How to render captions locally (step by step)

This is a plain-language walkthrough of the local rendering tool
(`tools/render_export.mjs`) — for when a clip is too long to comfortably
export in the browser tab. If you just want the short version, the README
has it; this is the version with every step spelled out.

## First, the mental model

There are **two separate things** in this project, and they do different jobs:

1. **The website** (whisperxcaption.com) — this is where you *design* the
   caption look: font, colors, animation, position. You watch it update live
   in the preview. This is the only place you can do that. You still use it
   every time, for every clip.
2. **The local tool** (`tools/render_export.mjs`) — a script that runs on
   your own computer. It does not design anything and has no preview. All it
   does is take a look you already designed on the website and *produce the
   files* — faster and more reliably than clicking the export button in the
   browser tab, especially on long clips.

So the website isn't replaced by anything — you use it exactly like before.
The local tool is just a better way to do the very last step (the actual
export) when a clip is long enough that the browser tab becomes a problem.

## Part 1 — One-time setup (do this once, ever)

You need two programs installed on your computer:

1. **Node.js** — go to [nodejs.org](https://nodejs.org), download, install it
   like any other program. (This is separate from the Python you already use
   for WhisperX/Demucs — you need both, they don't conflict.)
2. **A copy of this project's code on your computer** — not just the live
   website, the actual source files. If you don't already have this:
   on the GitHub page for the repo, click the green **Code** button →
   **Download ZIP**, then unzip it somewhere. (If you use `git`, `git clone`
   works too — same result.)

Then, open **PowerShell**, and move into that folder:

```powershell
cd C:\path\to\whisperx_caption
```

(Replace with wherever you unzipped it.) Now run these two commands — **you
only ever do this once**, not every time you export:

```powershell
npm install
npx playwright install chromium
```

`npm install` downloads a few small helper libraries the script needs.
`npx playwright install chromium` downloads an invisible copy of Chrome that
the script drives in the background — this is *not* your normal Chrome, it
doesn't open a visible window, and it doesn't touch your regular browser at
all.

That's the whole setup. If both commands finish without a red error message,
you're done and won't need to do this again.

## Part 2 — Every time you want to caption a clip

### Step 1 — Get your transcript (same as always)

Nothing changes here. This is the same Demucs + WhisperX PowerShell process
you already use (also documented in the app's own **Guide** tab):

```powershell
demucs --two-stems=vocals "my-clip.mp3"
whisperx "separated\htdemucs\my-clip\vocals.wav" --model large-v2 --language en --output_format json --compute_type int8
```

This gives you `my-clip.json` — the transcript file.

### Step 2 — Design the look, on the website (same as always)

Open the site, drop `my-clip.json` into the **Source** tab, pick a preset or
build your own look (font, color, animation, box, position — whatever you
want), and preview it against the audio like normal.

### Step 3 — Download your style (this is the new part)

Once you're happy with how it looks, go to the **Export** tab and scroll to
the bottom. Click:

> **⬇ Style settings (.json)**

This saves a small file — something like `my-clip.style.json` — that
captures exactly the look you just built. It's not the captions, not the
video, just the *settings*.

### Step 4 — Run the local tool (instead of clicking export in the tab)

Put both files (`my-clip.json` and `my-clip.style.json`) somewhere handy —
e.g. inside the project folder, or note their full paths. Back in PowerShell,
from the project folder:

```powershell
node tools/render_export.mjs my-clip.json --style my-clip.style.json --mov prores
```

That's it — that one command replaces clicking the export button on the
website. It'll print progress in the terminal as it works (and an estimated
time remaining), then finish.

### Step 5 — Find your files

The tool creates, next to your transcript:

- `my-clip_1920x1080_30fps_png.zip` — the transparent caption frames, zipped
  (this is the "real" output — same thing the website would have given you).
- `my-clip_1920x1080_30fps_frames\` — the same frames, already unzipped, so
  you can drag the folder straight into Premiere/Resolve/etc. as an image
  sequence.
- `my-clip_1920x1080_30fps_overlay.mov` — a single video file with your
  captions and true transparency, ready to drop over your footage. (Only
  appears if you used `--mov` — see below.)

Drop the `.mov` (or the frames folder) onto a track above your footage in
your video editor, same as the README already describes for the website's
own export.

## Common options, plain-English

| You want to… | Add this |
|---|---|
| Use a different resolution than 1920×1080 | `--res 1080x1920` (for vertical/9:16) |
| Change the frame rate | `--fps 24` |
| Turn off the "crop to caption strip" speed trick | `--no-crop` |
| Get a `.mov` file, not just PNG frames | `--mov qtrle` (fast, default if you just write `--mov`) or `--mov prores` (heavier, but some editors prefer it) |
| Save the output somewhere specific | `--out C:\some\other\folder` |
| See all the options again | `node tools/render_export.mjs --help` |

Full example with everything:

```powershell
node tools/render_export.mjs my-clip.json --style my-clip.style.json --res 1080x1920 --fps 30 --mov qtrle --out C:\exports
```

## Troubleshooting

- **"npx playwright install chromium" or "npm install" gave an error** —
  make sure Node.js actually installed (open a *new* PowerShell window and
  type `node --version` — it should print a version number, not an error).
- **"Playwright's Chromium isn't installed"** — you skipped or need to re-run
  `npx playwright install chromium` (Part 1, step 2).
- **It says the `.mov` mux was skipped / ffmpeg not found** — that's fine,
  not an error. It means you don't have `ffmpeg` installed on your computer
  (separate from the browser-based encoder the website uses). Your PNG
  sequence and frames folder are still complete and usable on their own. If
  you specifically want the `.mov` file, install ffmpeg (WhisperX itself
  already needs it — if WhisperX works, you likely already have it; if not,
  see [ffmpeg.org](https://ffmpeg.org/download.html)).
- **"the app did not load this transcript"** — double check the file is
  really a WhisperX/Whisper `.json`, `.srt`, or `.vtt`, and that the path you
  typed is correct.
- **Nothing about this touches your website** — running this tool never
  uploads, changes, or affects whisperxcaption.com in any way. It's entirely
  local, entirely separate.

## Quick answer to "why do I need both?"

- **Short clip, or you just want to try a look?** Use the website's export
  buttons like normal. Simplest, no setup.
- **Long clip, or you've been burned by a stuck export before?** Design on
  the website (Steps 1-3 above), then run it through the local tool
  (Steps 4-5). Same look, produced on your own computer instead of in a
  browser tab that can hang for hours.
