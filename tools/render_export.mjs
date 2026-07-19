#!/usr/bin/env node
// render_export.mjs — headless local export for WhisperX Caption Studio.
//
// Drives the SAME rendering code as the web app (the real page, in headless
// Chromium via Playwright) so the output is pixel-identical to the in-browser
// "Transparent PNG sequence" export — but with none of the browser-tab
// babysitting: a script-driven headless page is never backgrounded, so
// Chrome's hidden-tab timer throttling (which can stall a long interactive
// export for hours) simply doesn't apply. Optionally muxes the frames into a
// transparent .mov with your NATIVE ffmpeg, which is typically 10-50x faster
// than the in-browser ffmpeg.wasm encoder.
//
// Usage:
//   node tools/render_export.mjs <transcript.json> [options]
//
//   --style <path.json>    flat JSON of style-control ids -> values, same shape
//                          as the app's presets (e.g. {"optFont":"Anton",
//                          "optSize":"72","optKaraoke":true}). Omit for the
//                          app's own defaults.
//   --res WxH              export resolution (default 1920x1080)
//   --fps N                frames per second (default 30)
//   --crop / --no-crop     crop-to-caption-band toggle (default on, like the app)
//   --out <dir>            output directory (default: alongside the transcript)
//   --mov [qtrle|prores]   after the PNG sequence, mux a .mov with native
//                          ffmpeg (default codec: qtrle). If ffmpeg isn't on
//                          PATH the mux is skipped and the manual command is
//                          printed — the PNG sequence is a complete deliverable
//                          on its own.
//   --help                 show this help
//
// Setup (once):  npm install   then   npx playwright install chromium
// No audio file is needed — the transcript alone sets the export duration.
// New to this? Full step-by-step walkthrough: docs/LOCAL_CLI_GUIDE.md

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import yauzl from "yauzl";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Expected user errors carry no stack trace — just one clear line.
class CliError extends Error {}
const fail = (msg) => { throw new CliError(msg); };

// Native-ffmpeg codec args, matching the app's own "Copy ffmpeg command"
// output (js/app.js copyFfmpeg / MOV_CODECS) so the muxed .mov is exactly
// what the app itself considers correct.
const MOV_CODECS = {
  qtrle:  { label: "QuickTime Animation (RGBA)", args: ["-c:v", "qtrle", "-pix_fmt", "argb"] },
  prores: { label: "ProRes 4444",                args: ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"] },
};

function usage() {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  // The comment block at the top of this file IS the help text.
  console.log(src.split("\n").slice(1, 34).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}

// ---------- argument parsing ----------
function parseArgs(argv) {
  const opts = {
    transcript: null, style: null, res: null, fps: null, crop: null,
    out: null, mov: null,
  };
  const args = [];
  for (const a of argv) {
    // support --opt=value as well as --opt value
    const m = /^(--[a-z-]+)=(.*)$/.exec(a);
    if (m) args.push(m[1], m[2]); else args.push(a);
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const val = () => {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) fail(`${a} needs a value`);
      return args[++i];
    };
    if (a === "--help" || a === "-h") { usage(); process.exit(0); }
    else if (a === "--style") opts.style = val();
    else if (a === "--res") opts.res = val();
    else if (a === "--fps") opts.fps = val();
    else if (a === "--crop") opts.crop = true;
    else if (a === "--no-crop") opts.crop = false;
    else if (a === "--out") opts.out = val();
    else if (a === "--mov") {
      const next = args[i + 1];
      if (next && Object.hasOwn(MOV_CODECS, next)) { opts.mov = next; i++; }
      else if (next && !next.startsWith("--") && opts.transcript) fail(`unknown --mov codec "${next}" (use qtrle or prores)`);
      else opts.mov = "qtrle"; // bare --mov: a following non-codec token is the transcript positional
    }
    else if (a.startsWith("--")) fail(`unknown option ${a} (see --help)`);
    else if (!opts.transcript) opts.transcript = a;
    else fail(`unexpected extra argument "${a}"`);
  }
  if (!opts.transcript) fail("no transcript given — usage: node tools/render_export.mjs <transcript.json> [options] (see --help)");
  return opts;
}

function validate(opts) {
  const transcript = path.resolve(opts.transcript);
  if (!fs.existsSync(transcript)) fail(`transcript not found: ${transcript}`);
  try { JSON.parse(fs.readFileSync(transcript, "utf8")); }
  catch (e) { fail(`transcript is not valid JSON: ${transcript} (${e.message})`); }

  let style = null;
  if (opts.style) {
    const p = path.resolve(opts.style);
    if (!fs.existsSync(p)) fail(`style file not found: ${p}`);
    try { style = JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { fail(`style file is not valid JSON: ${p} (${e.message})`); }
    if (typeof style !== "object" || style === null || Array.isArray(style))
      fail(`style file must be a JSON object of control ids -> values: ${p}`);
    // presets store the style under {name, style}; accept that shape too
    if (style.style && typeof style.style === "object") style = style.style;
  }

  if (opts.res !== null && !/^\d+x\d+$/.test(opts.res))
    fail(`--res must look like 1920x1080 (got "${opts.res}")`);
  if (opts.res !== null && opts.res.split("x").some((n) => +n < 2))
    fail(`--res dimensions must be at least 2x2 (got "${opts.res}")`);
  if (opts.fps !== null && !(/^\d+$/.test(opts.fps) && +opts.fps > 0))
    fail(`--fps must be a positive integer (got "${opts.fps}")`);

  const out = path.resolve(opts.out ?? path.dirname(transcript));
  return { ...opts, transcript, styleObj: style, out };
}

// ---------- tiny static file server (serves the app itself) ----------
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".otf": "font/otf", ".wasm": "application/wasm", ".txt": "text/plain",
};
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let file = path.normalize(path.join(REPO, urlPath === "/" ? "index.html" : urlPath));
      if (!file.startsWith(REPO + path.sep) && file !== path.join(REPO, "index.html")) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
        res.end(data);
      });
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve(srv)); // 0 = any free port
  });
}

// ---------- page helpers (same mechanism as the app's own UI events) ----------
async function setControl(page, id, value) {
  await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === String(value))) {
      const o = document.createElement("option");
      o.value = String(value); o.textContent = String(value);
      el.appendChild(o); // the renderer only reads .value, so a custom res/fps works fine
    }
    if (el.type === "checkbox") el.checked = !!value && value !== "false";
    else el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, [id, value]);
}

async function applyStyle(page, styleObj) {
  const unknown = [];
  for (const [id, value] of Object.entries(styleObj)) {
    if (id === "optFont" && value === "__upload") continue; // the app never persists this sentinel either
    const exists = await page.evaluate((id) => !!document.getElementById(id), id);
    if (!exists) { unknown.push(id); continue; }
    await setControl(page, id, value);
  }
  if (unknown.length)
    console.warn(`warning: ignored unknown style keys: ${unknown.join(", ")}`);
}

const progressText = (page) =>
  page.evaluate(() => document.getElementById("exportProgress").textContent);

// ---------- zip extraction (the export zip is STORE-only, but yauzl reads any) ----------
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const names = [];
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        const name = path.basename(entry.fileName); // export zips are flat; flatten defensively
        if (!name || name.includes("..")) return zip.readEntry();
        zip.openReadStream(entry, (err2, stream) => {
          if (err2) return reject(err2);
          const ws = fs.createWriteStream(path.join(destDir, name));
          stream.pipe(ws);
          ws.on("error", reject);
          ws.on("finish", () => { names.push(name); zip.readEntry(); });
        });
      });
      zip.on("end", () => { zip.close(); resolve(names); });
      zip.readEntry();
    });
  });
}

// PNG IHDR: width at byte 16, height at byte 20 (big-endian).
function pngSize(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ---------- native ffmpeg ----------
function ffmpegUsable() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (r.error) return { ok: false, why: r.error.code === "ENOENT" ? "not found on PATH" : r.error.message };
  if (r.status === 0) return { ok: true };
  return { ok: false, why: (r.stderr || r.stdout || "").trim().split("\n")[0] || `exit code ${r.status}` };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    // -stats keeps ffmpeg's live "frame= fps= time=" line on stderr visible.
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new CliError(`ffmpeg exited with code ${code}`))));
  });
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const opts = validate(parseArgs(process.argv.slice(2)));
  fs.mkdirSync(opts.out, { recursive: true });

  const server = await startServer();
  const port = server.address().port;
  let browser = null;
  const cleanup = async () => {
    if (browser) { try { await browser.close(); } catch {} browser = null; }
    server.close();
  };
  process.on("SIGINT", () => { cleanup().finally(() => process.exit(130)); });

  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      if (/Executable doesn't exist|browserType.launch/.test(String(e.message)))
        fail("Playwright's Chromium isn't installed — run: npx playwright install chromium");
      throw e;
    }
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 950 } });
    // No native save picker -> the app uses its download fallback, which we
    // capture via Playwright's download event. Dialogs can't be interactive
    // headlessly: confirms are accepted, alerts recorded and reported.
    await context.addInitScript(() => {
      try { delete window.showSaveFilePicker; } catch { window.showSaveFilePicker = undefined; }
      window.confirm = () => true;
      window.alert = (m) => { window.__wxcAlert = String(m); };
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn("page error:", String(e).split("\n")[0]));

    console.log(`Booting WhisperX Caption Studio headlessly (http://127.0.0.1:${port}/)…`);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.waitForSelector("#appVersion");

    // Load the transcript exactly like a user dropping the file in.
    await page.click('.tab[data-tab="source"]');
    await page.setInputFiles("#fileJson", opts.transcript);
    const loaded = await page.waitForFunction(() => {
      if (document.querySelectorAll("#cueStrip .cue-row").length > 0) return "ok";
      if (/No usable captions/.test(document.getElementById("srcInfo").textContent)) return "empty";
      const t = document.getElementById("toast");
      if (t.classList.contains("show") && t.textContent.startsWith("⚠️")) return "err:" + t.textContent;
      return false;
    }, { timeout: 30000 }).then((h) => h.jsonValue())
      .catch(() => fail("the app did not load this transcript (unrecognized format?)"));
    if (loaded === "empty") fail("transcript contains no usable cues — nothing to render");
    if (String(loaded).startsWith("err:")) fail(`the app rejected the transcript: ${String(loaded).slice(4)}`);
    const srcInfo = await page.evaluate(() => document.getElementById("srcInfo").textContent);
    const durText = await page.evaluate(() => document.getElementById("timeTotal").textContent);
    console.log(`Transcript loaded: ${srcInfo} Duration ${durText}.`);

    // Style first, then explicit CLI flags (CLI wins over the style file;
    // app defaults already match the documented CLI defaults).
    if (opts.styleObj) { await applyStyle(page, opts.styleObj); console.log(`Applied style: ${opts.style}`); }
    if (opts.res !== null) await setControl(page, "optRes", opts.res);
    if (opts.fps !== null) await setControl(page, "optFps", opts.fps);
    if (opts.crop !== null) await setControl(page, "optCropBand", opts.crop);
    const eff = await page.evaluate(() => ({
      res: document.getElementById("optRes").value,
      fps: document.getElementById("optFps").value,
      crop: document.getElementById("optCropBand").checked,
    }));
    console.log(`Export settings: ${eff.res} @ ${eff.fps}fps, crop-to-caption-band ${eff.crop ? "on" : "off"}`);

    // ---- run the PNG-sequence export, relaying the app's live progress ----
    await page.click('.tab[data-tab="export"]');
    const dlPromise = page.waitForEvent("download", { timeout: 0 });
    dlPromise.catch(() => {}); // settled via the race below; avoid an unhandled rejection on failure
    await page.click("#dlPngSeq");

    let stopWatch = () => {};
    const watch = new Promise((_, reject) => {
      let last = "", lastChange = Date.now(), lastPrint = 0;
      const iv = setInterval(async () => {
        try {
          const alert = await page.evaluate(() => window.__wxcAlert || null);
          if (alert) return reject(new CliError(`export refused: ${alert.replace(/\s+/g, " ")}`));
          const text = await progressText(page);
          if (text && text !== last) {
            last = text; lastChange = Date.now();
            // phase lines print immediately; per-frame ETA lines at most every 2s
            const phase = !/^Rendering frame/.test(text);
            if (phase || Date.now() - lastPrint > 2000) { console.log("  " + text); lastPrint = Date.now(); }
            if (/^⚠️|^Export failed|failed:|^Export cancelled/.test(text))
              return reject(new CliError(`export failed in the app: ${text}`));
          }
          if (Date.now() - lastChange > 10 * 60 * 1000)
            return reject(new CliError("export made no progress for 10 minutes — aborting"));
        } catch { /* page busy or closing — skip this tick */ }
      }, 500);
      stopWatch = () => clearInterval(iv);
    });
    const download = await Promise.race([dlPromise, watch]).finally(() => stopWatch());

    const zipName = download.suggestedFilename();
    const zipPath = path.join(opts.out, zipName);
    await download.saveAs(zipPath);
    const doneLine = await page.waitForFunction(() => {
      const t = document.getElementById("exportProgress").textContent;
      return t.startsWith("✓") ? t : false;
    }, { timeout: 60000 }).then((h) => h.jsonValue());

    // ---- extract the frames next to the zip ----
    const stem = zipName.replace(/\.zip$/, "").replace(/_png$/, "");
    const framesDir = path.join(opts.out, `${stem}_frames`);
    if (fs.existsSync(framesDir)) {
      console.log(`Replacing existing ${framesDir}/`);
      fs.rmSync(framesDir, { recursive: true, force: true }); // stale frames would leak into a re-mux
    }
    fs.mkdirSync(framesDir, { recursive: true });
    const names = await extractZip(zipPath, framesDir);
    const frames = names.filter((n) => /^cap_\d{5}\.png$/.test(n)).sort();
    if (!frames.length) fail(`the export zip contained no frames (${zipPath})`);
    for (let i = 0; i < frames.length; i++)
      if (frames[i] !== `cap_${String(i).padStart(5, "0")}.png`)
        fail(`frame numbering has a gap at index ${i} (${frames[i]}) — the zip may be corrupt`);
    const dim = pngSize(path.join(framesDir, frames[0]));
    console.log(`Extracted ${frames.length} frames (${dim.w}x${dim.h})${names.includes("README.txt") ? " + README.txt" : ""} -> ${framesDir}/`);

    // ---- optional native-ffmpeg mux ----
    let movPath = null, movNote = null;
    if (opts.mov) {
      const codec = MOV_CODECS[opts.mov];
      movPath = path.join(opts.out, `${stem}_overlay.mov`);
      const args = ["-hide_banner", "-loglevel", "warning", "-stats", "-y",
        "-framerate", eff.fps, "-i", path.join(framesDir, "cap_%05d.png"),
        ...codec.args, movPath];
      const ff = ffmpegUsable();
      if (!ff.ok) {
        const q = (s) => (/[\s"'$\\]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s);
        movNote = `ffmpeg not usable (${ff.why})`;
        console.log(`\nffmpeg mux skipped: ${ff.why}. The PNG sequence is complete on its own;`);
        console.log(`to make the .mov yourself once ffmpeg is installed, run:\n  ffmpeg ${args.slice(5).map(q).join(" ")}`);
        movPath = null;
      } else {
        console.log(`\nMuxing ${frames.length} frames -> ${codec.label} .mov with native ffmpeg…`);
        const tMux = Date.now();
        await runFfmpeg(args);
        const secs = (Date.now() - tMux) / 1000;
        movNote = `${codec.label}, encoded in ${secs.toFixed(1)}s (${(frames.length / secs).toFixed(0)} fps)`;
        console.log(`Encoded in ${secs.toFixed(1)}s — ${(frames.length / secs).toFixed(0)} frames/sec (native ffmpeg).`);
      }
    }

    // ---- summary ----
    console.log("\nDone in " + ((Date.now() - t0) / 1000).toFixed(1) + "s total.");
    console.log(`  ${doneLine}`);
    console.log(`  zip:    ${zipPath}`);
    console.log(`  frames: ${framesDir}${path.sep}cap_00000.png … cap_${String(frames.length - 1).padStart(5, "0")}.png  (import at ${eff.fps} fps${names.includes("README.txt") ? "; placement details in README.txt" : ""})`);
    if (opts.mov) console.log(`  mov:    ${movPath ?? "(skipped)"}  ${movNote ? "— " + movNote : ""}`);
  } finally {
    await cleanup();
  }
}

main().catch((e) => {
  if (e instanceof CliError) { console.error("Error: " + e.message); process.exit(1); }
  console.error(e);
  process.exit(1);
});
