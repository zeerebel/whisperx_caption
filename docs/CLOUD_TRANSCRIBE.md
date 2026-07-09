# Cloud Transcribe — setup

Cloud Transcribe lets people upload audio/video and get a WhisperX transcript
without installing anything. It runs **server-side** on Replicate through a
Cloudflare Worker, so your Replicate token never reaches the browser. Until you
set the two secrets below, the endpoint reports "not configured" and the site
stays 100% free and client-side — nothing changes for existing users.

## How it works
```
Browser (Source tab → Cloud Transcribe)
  │  POST /api/transcribe   (file + passphrase)      ┌───────────────────────┐
  │ ───────────────────────────────────────────────►│  Cloudflare Worker    │
  │                                                   │  worker/index.js      │
  │                                                   │  • check passphrase   │
  │                                                   │  • upload to Replicate│
  │                                                   │  • start WhisperX     │
  │  ◄── { id }                                       └──────────┬────────────┘
  │  GET /api/transcribe?id=…  (poll every 3s)                   │ Replicate
  │  ◄── { status, output }  ◄──────────────────────────────────┘ victor-upmeet/whisperx
  │  loadTranscriptText(output)  → style → export
```
- The Worker and the static site are one Cloudflare Workers project. Static
  assets are still served directly; the Worker only runs for `/api/*`.
- `align_output` (word-level timestamps, for karaoke/word-highlight) is **on by
  default** — that's what produces the per-word timing the app animates.

## What you provide
1. A **Replicate** account + API token (https://replicate.com/account/api-tokens).
2. A **passphrase** you hand to allowed users (any string you choose).

## Set the two secrets (once — they persist across deploys)
From the repo root, with wrangler installed (`npx wrangler login` first):
```bash
npx wrangler secret put REPLICATE_API_TOKEN
npx wrangler secret put TRANSCRIBE_PASSPHRASE
```
Or in the dashboard: **Workers & Pages → whisperxcaption → Settings →
Variables and Secrets → Add** (type: Secret) for each.

Then push to `main` (or re-run the deploy workflow) — the Worker deploys with
the static site via `.github/workflows/deploy.yml`. Check
`https://whisperxcaption.<your>.workers.dev/api/health` → it should report
`{"ok":true,"configured":true}`.

## Cost & limits (know before you flip it on)
- **You pay Replicate per run** (a few cents for a short clip; alignment adds a
  little GPU time). The passphrase is the only thing standing between the
  endpoint and your bill — treat it like a key, rotate it if it leaks.
- Upload cap is **60 MB** (`MAX_BYTES` in `worker/index.js`) to keep runs fast
  and stay within Worker memory. For long files, extract/trim the audio first.

## This is the v1 (passphrase) — what's next for a real product
This ships the *functionality*. To sell it (per the plan in
`docs/PREMIUM_PLAN.md`) you'd add, in order: Supabase auth, a per-user credit
ledger enforced in the Worker, Stripe checkout + webhook, and per-user rate
limits — replacing the single shared passphrase with real accounts. The
transcription core here doesn't change; you're wrapping billing around it.

## Security notes
- Token lives only in a Worker secret — never in the client bundle or git.
- The passphrase is checked on every call (length-independent compare).
- No unauthenticated public endpoint: no passphrase → 401, before any GPU spend.
- Consider adding Cloudflare rate limiting / Turnstile before wider sharing.
