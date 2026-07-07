# Deploying WhisperX Caption Studio

It's a static site (HTML/CSS/JS, no build step), so any static host works.

## Cloudflare Workers (auto-deploy on push — set up in this repo)

`wrangler.toml` and `.github/workflows/deploy.yml` are already committed, wired
to deploy a Worker named `whisperxcaption` (static assets) on every push to
`main`. To turn it on:

1. **Create a Cloudflare API token**: dashboard → your profile icon (top
   right) → **My Profile** → **API Tokens** → **Create Token** → use the
   **Edit Cloudflare Workers** template → scope it to your account → **Create
   Token**, then copy it (shown once).
2. **Find your Account ID**: dashboard → **Workers & Pages** → the Account ID
   is in the right-hand sidebar of the overview page.
3. In the GitHub repo → **Settings** → **Secrets and variables** → **Actions**
   → **New repository secret**, add two secrets:
   - `CLOUDFLARE_API_TOKEN` — the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID` — the ID from step 2
4. Push to `main` (or re-run the workflow from the **Actions** tab) — it
   deploys automatically from then on.

If your existing `whisperxcaption.fusionmma.workers.dev` site was actually
created as a **Pages** project instead (check whether it's listed under
*Pages* rather than *Workers* in the dashboard), swap the workflow step's
command to `wrangler pages deploy . --project-name=whisperxcaption` and drop
`wrangler.toml`'s `[assets]` block — ask for help updating this if so.

## Cloudflare Pages (dashboard Git integration, no repo changes needed)

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
