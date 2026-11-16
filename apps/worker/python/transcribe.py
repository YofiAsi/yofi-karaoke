#!/usr/bin/env python3
"""One shot CLI over transcription.py that prints one JSON line with timed words; the worker itself uses gpu_sidecar.py.

Usage:
    transcribe.py --input <audio> --language <he|auto> --model-dir <dir> [--device cuda|cpu]

Fails fast when CUDA is requested but unusable.
"""

import argparse
import json
import sys

from transcription import TranscriptionEngine, TranscriptionError


def fail(message: str) -> None:
    print(f"transcribe.py ERROR: {message}", file=sys.stderr, flush=True)
    sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        result = TranscriptionEngine().transcribe(args.input, args.language, args.model_dir, args.device)
    except TranscriptionError as exc:
        fail(str(exc))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
