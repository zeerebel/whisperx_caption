/* Cloudflare Worker — Cloud Transcribe API for WhisperX Caption Studio.
 *
 * The static site is served by Cloudflare's asset pipeline (wrangler.toml
 * [assets]). This Worker only handles /api/* ; every other path falls through
 * to the static assets, so the site behaves exactly as before. If the two
 * secrets below aren't set, /api/transcribe reports "not configured" and the
 * app stays 100% free and client-side — nothing changes for existing users.
 *
 * Cloud Transcribe flow: the browser uploads audio/video → we run it through
 * the Replicate `victor-upmeet/whisperx` model **server-side** (so the
 * Replicate token never reaches the client) → we hand back WhisperX JSON that
 * js/parse.js already knows how to style and export.
 *
 * Secrets (set once; they persist across deploys — never commit them):
 *   wrangler secret put REPLICATE_API_TOKEN     # your Replicate API token
 *   wrangler secret put TRANSCRIBE_PASSPHRASE   # a shared passphrase that
 *       gates the endpoint so strangers can't burn your GPU credits.
 * (Or set both in the Cloudflare dashboard: Workers → whisperxcaption →
 *  Settings → Variables and Secrets.)
 */

const MODEL = "victor-upmeet/whisperx";
const REPLICATE = "https://api.replicate.com/v1";
const MAX_BYTES = 60 * 1024 * 1024; // 60 MB — keep it fast; extract audio for long clips
const POLL_HINT = "starting";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/transcribe") return handleTranscribe(request, env, url);
    if (url.pathname === "/api/health") return json({ ok: true, configured: isConfigured(env) });

    // Not an API route → hand it to the static assets (index, css, js, …).
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

function isConfigured(env) {
  return Boolean(env.REPLICATE_API_TOKEN && env.TRANSCRIBE_PASSPHRASE);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Length-independent compare so the passphrase check doesn't leak via timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function handleTranscribe(request, env, url) {
  if (!isConfigured(env)) {
    return json({ error: "Cloud Transcribe isn't configured on this deployment yet." }, 501);
  }
  const pass = request.headers.get("x-transcribe-pass") || url.searchParams.get("pass") || "";
  if (!safeEqual(pass, env.TRANSCRIBE_PASSPHRASE)) {
    return json({ error: "Wrong or missing passphrase." }, 401);
  }

  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Missing prediction id." }, 400);
    return pollPrediction(id, env);
  }
  if (request.method === "POST") return startPrediction(request, env);
  return json({ error: "Method not allowed." }, 405);
}

async function startPrediction(request, env) {
  let form;
  try { form = await request.formData(); }
  catch (e) { return json({ error: "Expected multipart form data." }, 400); }

  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "No file uploaded." }, 400);
  if (file.size > MAX_BYTES) {
    return json({
      error: `That file is ${(file.size / 1048576) | 0} MB — the ${(MAX_BYTES / 1048576) | 0} MB limit keeps it fast. Extract or trim the audio and try again.`,
    }, 413);
  }
  const language = String(form.get("language") || "").trim();     // "" = auto-detect
  const align = String(form.get("align") ?? "true") !== "false";  // word-level timing on by default

  // 1) Put the media in Replicate's file store → a URL the model can read.
  const upForm = new FormData();
  upForm.append("content", file, file.name || "audio");
  const upRes = await fetch(`${REPLICATE}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
    body: upForm,
  });
  if (!upRes.ok) {
    return json({ error: "Upload to the transcription service failed.", detail: await safeText(upRes) }, 502);
  }
  const uploaded = await upRes.json().catch(() => null);
  const audioUrl = uploaded && uploaded.urls && uploaded.urls.get;
  if (!audioUrl) return json({ error: "Transcription service didn't return a file URL." }, 502);

  // 2) Kick off WhisperX (async — the client polls for the result).
  const input = { audio_file: audioUrl, align_output: align, batch_size: 32 };
  if (language) input.language = language;
  const predRes = await fetch(`${REPLICATE}/models/${MODEL}/predictions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ input }),
  });
  const pred = await predRes.json().catch(() => null);
  if (!predRes.ok || !pred || !pred.id) {
    return json({ error: "Couldn't start transcription.", detail: (pred && pred.detail) || (await safeText(predRes)) }, 502);
  }
  return json({ id: pred.id, status: pred.status || POLL_HINT });
}

async function pollPrediction(id, env) {
  const res = await fetch(`${REPLICATE}/predictions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
  });
  const pred = await res.json().catch(() => null);
  if (!res.ok || !pred) return json({ error: "Couldn't read transcription status." }, 502);

  // status: starting | processing | succeeded | failed | canceled
  const out = { id: pred.id, status: pred.status };
  if (pred.status === "succeeded") out.output = pred.output;
  if (pred.status === "failed" || pred.status === "canceled") out.error = pred.error || "Transcription failed.";
  return json(out);
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 500); } catch (e) { return ""; }
}
