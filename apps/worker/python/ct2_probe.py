#!/usr/bin/env python3
"""Fails unless faster-whisper can run both Whisper models on CUDA. Usage: ct2_probe.py --model-dir <dir>"""

import argparse
import sys
from pathlib import Path

import transcribe
from whisper_models import MODELS


def run_on_silence(model) -> None:
    import numpy as np

    segments, _ = model.transcribe(np.zeros(32000, dtype=np.float32), language="en", vad_filter=False)
    list(segments)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    try:
        print(transcribe.assert_cuda())
        for name in MODELS:
            model = transcribe.load_model(Path(args.model_dir), name, "cuda")
            run_on_silence(model)
            print(f"{name} runs on {model.model.device}")
    except Exception as exc:
        print(f"ct2_probe ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
