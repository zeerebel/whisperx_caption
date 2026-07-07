# Vendored ffmpeg.wasm (self-hosted, same-origin)

The one-click transparent **.mov** export runs ffmpeg.wasm entirely in the
browser. These files are served from the app's own origin so the encoder keeps
working when the jsdelivr CDN is blocked (ad-blockers, corporate/school
firewalls, some regions). `js/app.js` loads them first and only falls back to
the CDN if they can't be fetched (e.g. opened straight from `file://`).

Pinned versions:
- `ffmpeg.js`, `814.ffmpeg.js` — @ffmpeg/ffmpeg 0.12.10 (UMD build + worker chunk)
- `ffmpeg-core.js`, `ffmpeg-core.wasm.gz` — @ffmpeg/core 0.12.6

`ffmpeg-core.wasm.gz` is the core wasm gzipped (~10 MB vs ~30 MB raw) so it fits
Cloudflare Workers' 25 MiB per-asset limit; the browser gunzips it via
`DecompressionStream` at load time. To refresh:

    npm pack @ffmpeg/ffmpeg@0.12.10 @ffmpeg/core@0.12.6
    # copy dist/umd/{ffmpeg.js,814.ffmpeg.js} and dist/umd/ffmpeg-core.js
    gzip -9 -c ffmpeg-core.wasm > ffmpeg-core.wasm.gz
