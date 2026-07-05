#!/usr/bin/env python3
"""
transcribe_whisperx.py — turn an MP3 (dialogue, interview, voiceover) into a
word-level WhisperX JSON you can drop into WhisperX Caption Studio.

This is the ONLY step that runs on your computer. Everything after it — styling
and exporting captions — happens in the browser at the Caption Studio site.

------------------------------------------------------------------------------
ONE-TIME SETUP (terminal, needs ffmpeg installed):
    pip install whisperx

RUN IT:
    python tools/transcribe_whisperx.py "my-conversation.mp3"
        -> writes  my-conversation.json   (word-level, forced-aligned)

Options:
    --model small|medium|large-v2   (default large-v2; use small on a slow laptop)
    --language en                    (default: auto-detect)
    --out path.json                  (default: same name as the audio, .json)

Then open the Caption Studio, drop in that .json (and optionally the mp3 to
preview in sync), style it, and export .srt / .vtt / .ass.

No GPU? It still works on CPU — WhisperX is invoked with int8 compute so a
normal laptop can run it (slower, but fine for short clips).
------------------------------------------------------------------------------
"""
import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser(description="MP3 -> word-level WhisperX JSON")
    ap.add_argument("audio", help="path to the audio file (mp3/wav/m4a)")
    ap.add_argument("--model", default="large-v2")
    ap.add_argument("--language", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    if not os.path.exists(args.audio):
        sys.exit("Audio not found: " + args.audio)
    try:
        import whisperx
    except ImportError:
        sys.exit("Run:  pip install whisperx   (needs ffmpeg installed)")

    device = "cpu"
    compute_type = "int8"
    try:
        import torch
        if torch.cuda.is_available():
            device, compute_type = "cuda", "float16"
    except Exception:
        pass

    print(f"Loading model '{args.model}' on {device} ...")
    model = whisperx.load_model(args.model, device, compute_type=compute_type)
    audio = whisperx.load_audio(args.audio)

    print("Transcribing ...")
    result = model.transcribe(audio, language=args.language)
    lang = result.get("language", args.language or "en")

    print(f"Aligning words (language={lang}) ...")
    align_model, meta = whisperx.load_align_model(language_code=lang, device=device)
    result = whisperx.align(result["segments"], align_model, meta, audio, device,
                            return_char_alignments=False)
    result["language"] = lang

    out = args.out or (os.path.splitext(args.audio)[0] + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    n_words = sum(len(s.get("words", []) or []) for s in result.get("segments", []))
    print(f"\nWrote {out}  ({len(result.get('segments', []))} segments, {n_words} words).")
    print("Now open WhisperX Caption Studio and drop this .json in.")


if __name__ == "__main__":
    main()
