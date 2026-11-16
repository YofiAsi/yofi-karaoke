#!/usr/bin/env python3
"""One shot CLI over separation.py; the worker itself uses gpu_sidecar.py.

Usage:
    separate.py --input <audio> --output-dir <dir> --model <model> --backend <openvino|cuda|cpu> --bitrate <e.g. 192k>

Prints a single JSON line to stdout: {"instrumentalPath": str, "vocalsPath": str | null}.
Fails fast with non-zero exit if the requested GPU backend is not available.
"""

import argparse
import json
import sys

from separation import SeparationEngine, SeparationError


def fail(msg: str) -> None:
    print(f"separate.py ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--backend", default="openvino", choices=["openvino", "cuda", "cpu"])
    parser.add_argument("--model-dir", default="/app/models")
    parser.add_argument("--bitrate", default="192k")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        result = SeparationEngine().separate(args.input, args.output_dir, args.model, args.backend, args.model_dir, args.bitrate)
    except SeparationError as exc:
        fail(str(exc))
    print(json.dumps({"instrumentalPath": result["instrumentalPath"], "vocalsPath": result["vocalsPath"]}))


if __name__ == "__main__":
    main()
