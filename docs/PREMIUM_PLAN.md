# Premium plan — Cloud Transcribe

The concrete plan for adding a paid feature without breaking the free tool.

## Positioning (why this, not "Opus but longer")
- **Opus Pro / Opus Clip** = automation: long video → auto-picked viral shorts,
  auto-reframe, virality scoring. That's a *repurposing* tool.
- **This app** = caption **craft** + a **transparent alpha overlay** (PNG
  sequence / alpha `.mov`) that drops over any footage in any editor, no
  forced chopping, full control of the look. That's a tool for people who
  want **control**, not one-click automation. Don't market it as "another
  auto-caption tool" — lead with *styled caption overlays you own, in your
  editor, any length*.
- The **only** thing that blocks non-technical users today is running WhisperX
  locally. **Cloud Transcribe removes that barrier** → that's the paid unlock,
  and it can't be bypassed by reading the open-source client (it's a real
  server-side GPU service).

## Free vs paid split
- **Free (unchanged):** bring your own transcript (WhisperX `.json` / `.srt` /
  `.vtt`) → style → export. Everything client-side, no cost to you.
- **Paid — Cloud Transcribe:** upload audio/video → we run WhisperX on a GPU →
  transcript flows into the existing app. The whole styling/export side needs
  **zero changes** (output is the same WhisperX JSON `js/parse.js` already
  reads).

## Architecture (keeps the current static site)
```
 Browser (existing static app on Cloudflare)
   │  sign in (Supabase Auth)
   │  upload audio → Supabase Storage (signed URL)
   │  POST /api/transcribe  ─────────────►  Cloudflare Worker  (the only new server)
   │                                          │  verify Supabase JWT
   │                                          │  check credits (Supabase, service role)
   │                                          │  call GPU → Replicate WhisperX
   │                                          │  on success: store result, debit credits
   │  ◄──────── WhisperX JSON ───────────────┘
   │  feed JSON into existing loadTranscriptText() → style → export
   │
   └─ Buy credits: POST /api/checkout → Stripe Checkout → webhook → /api/stripe → credit user
```
You keep the static frontend on Cloudflare and add **one Worker** as the API.

## Stack (you already have Supabase + Stripe)
- **Auth + DB + Storage:** Supabase (have it).
- **Payments:** Stripe (have it) — pay-as-you-go credit packs to start.
- **GPU / WhisperX:** **Replicate** to start (e.g. a `whisperx` model — call an
  API, pay per second, no infra). Alternative later: **Modal** (deploy your own
  WhisperX, scales to zero, cheaper at volume, more control).
- **API glue:** a Cloudflare Worker (you're already on Cloudflare).

## Supabase data model
```sql
-- one row per user (mirrors auth.users)
profiles(
  id uuid primary key references auth.users,
  email text,
  credit_seconds int not null default 600,   -- 10 free min on signup
  created_at timestamptz default now()
)

-- append-only ledger = source of truth for credits (auditable, idempotent)
credit_ledger(
  id bigint generated always as identity primary key,
  user_id uuid references auth.users,
  delta_seconds int not null,                 -- + on purchase, - on job
  reason text,                                -- 'signup_grant' | 'purchase' | 'transcription'
  stripe_event_id text unique,                -- idempotency for webhooks
  created_at timestamptz default now()
)

transcription_jobs(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  status text default 'queued',               -- queued|running|done|error
  input_path text,                            -- storage path (delete after N days)
  duration_seconds int,
  cost_seconds int,
  result_json jsonb,
  provider_ref text,                          -- Replicate prediction id
  created_at timestamptz default now()
)
```
- **RLS:** users can `select` their own rows; **all writes go through the
  Worker with the service-role key** (never the client). Credits are a server
  concern only.

## Request flow (the important bits)
1. **Sign in** — Supabase Auth (email magic link or Google). Frontend gets a JWT.
2. **Upload** — Worker returns a Supabase Storage signed upload URL; client
   uploads the file directly (keeps big files off the Worker).
3. **Transcribe** — `POST /api/transcribe {path}`:
   - verify the Supabase JWT,
   - reject if file duration > limit (e.g. 60 min) or credits insufficient
     **before** calling the GPU,
   - call Replicate WhisperX with the file URL; poll or use its webhook,
   - on success: write `result_json`, insert a negative `credit_ledger` row,
     return the WhisperX JSON. **On failure: no charge.**
4. **Use** — client feeds the JSON into the existing app. Done.

## Credits & pricing
- **Unit = seconds of audio** transcribed (fair; long files cost more).
- **Free grant:** 10 min on signup (funnel).
- **Packs (example):** 60 min → $5, 300 min → $20. (Tune once you know real
  GPU cost per minute from Replicate.)
- Margin check: GPU is roughly a few cents–$0.10 per typical clip; Stripe takes
  ~2.9% + 30¢. Packs above keep healthy margin. **Verify with a real run first.**

## Stripe (test mode first)
1. Create credit-pack **Prices** in Stripe.
2. `POST /api/checkout` → create Checkout Session with
   `client_reference_id = supabase user id`; redirect the user.
3. `POST /api/stripe` webhook → **verify signature** → on
   `checkout.session.completed`, insert a positive `credit_ledger` row keyed by
   the Stripe `event.id` (**idempotent** — safe on retries).
4. Flip to live keys only after end-to-end test-mode passes.

## Security must-haves (do not skip)
- Verify the Supabase JWT on **every** Worker call.
- **Enforce credits server-side** — never trust the client for entitlements.
- **Verify the Stripe webhook signature**; idempotent by event id.
- All secrets (Replicate token, Stripe secret, Supabase **service role**) live
  in **Worker secrets** (`wrangler secret put …`), never in the client bundle.
- Hard limits: max duration, max file size, per-user rate limit, reject on
  insufficient credits before spending GPU.
- Privacy: audio can be sensitive — auto-delete uploads after N days; let users
  delete jobs.

## Build order (milestones)
1. Supabase: auth + tables + RLS + storage bucket. (½–1 day)
2. Worker skeleton: JWT verify + `/api/transcribe` calling Replicate on a test
   file, returns JSON. (1–2 days)
3. Frontend: sign-in + a "Cloud Transcribe" upload panel + progress +
   "X min left". (2–3 days)
4. Credit ledger + enforcement + limits. (1 day)
5. Stripe Checkout + webhook + crediting (test mode). (2–3 days)
6. Go-live: live keys, limits, monitoring, error paths. (1–2 days)

≈ **1.5–3 weeks** for a solid MVP.

## What you provide vs what gets built
- **You:** Supabase project (have), Stripe account (have), a **Replicate**
  account + API token, chosen pricing/packs, and set the Worker secrets.
- **Built for you:** the Worker API, Supabase schema + RLS, the frontend
  sign-in + upload + credits UI, and the Stripe flow.

## Recommended: validate before you build the billing stack
Ship a **"Cloud Transcribe — join the waitlist"** button first (just writes an
email to a Supabase table). If enough people click, build the full thing. One
afternoon vs three weeks — cheap signal before the real investment.
