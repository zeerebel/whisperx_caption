# Deploying WhisperX Caption Studio

It's a static site (HTML/CSS/JS, no build step), so any static host works.

## Cloudflare Pages (recommended)

1. Push this repo to GitHub (already done if you're reading this there).
2. In the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, and pick `zeerebel/whisperx_caption`.
3. Build settings:
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
4. **Save and Deploy.** You'll get a `*.pages.dev` URL. Add a custom domain
   later under the project's **Custom domains** tab if you want.

Every push to `main` redeploys automatically.

### Or deploy from your machine with Wrangler

```bash
npm i -g wrangler
wrangler pages deploy . --project-name whisperx-caption
```

## GitHub Pages

Settings → **Pages** → Source: **Deploy from a branch** → `main` / `/ (root)`.
Served at `https://zeerebel.github.io/whisperx_caption/`.

## Netlify

Drag the folder onto app.netlify.com/drop, or connect the repo with build
command empty and publish directory `.`.

## Just open it

Because there's no backend, you can also double-click `index.html` — though the
**Try a sample** button needs a real server (it `fetch()`es a file), so run a
tiny local one for that:

```bash
python -m http.server 8000   # then visit http://localhost:8000
```
