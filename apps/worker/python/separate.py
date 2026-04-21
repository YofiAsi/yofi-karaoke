#!/usr/bin/env python3
"""Thin CLI wrapper around audio-separator.

Usage:
    separate.py --input <audio> --output-dir <dir> --model <model> --backend <openvino|cuda|cpu>

Prints a single line to stdout: the absolute path of the produced instrumental file.
Fails fast with non-zero exit if the requested GPU backend is not available.
"""

import argparse
import json
import sys
from pathlib import Path


def fail(msg: str) -> None:
    print(f"separate.py ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def pick_instrumental(output_files, output_dir: Path) -> Path:
    candidates = []
    for f in output_files:
        p = Path(f)
        if not p.is_absolute():
            p = output_dir / p
        candidates.append(p)

    for p in candidates:
        name = p.name.lower()
        if "instrumental" in name or "no_vocal" in name or "accompaniment" in name:
            return p

    for p in candidates:
        name = p.name.lower()
        if "vocals" not in name and "vocal" not in name:
            return p

    fail(f"Could not identify instrumental stem in outputs: {candidates}")


def probe_openvino() -> None:
    try:
        import openvino as ov

        core = ov.Core()
        devices = core.available_devices
        if "GPU" not in devices:
            fail(f"OpenVINO reports no GPU device. available={devices}")
    except Exception as exc:
        fail(f"failed to probe OpenVINO GPU: {exc}")


def probe_cuda() -> None:
    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
        if "CUDAExecutionProvider" not in providers:
            fail(f"onnxruntime reports no CUDA provider. available={providers}")
    except Exception as exc:
        fail(f"failed to probe CUDA provider: {exc}")


def build_separator(output_dir: str, model_dir: str):
    try:
        from audio_separator.separator import Separator
    except Exception as exc:
        fail(f"failed to import audio_separator: {exc}")

    return Separator(
        output_dir=output_dir,
        output_format="mp3",
        model_file_dir=model_dir,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--backend", default="openvino", choices=["openvino", "cuda", "cpu"])
    parser.add_argument("--model-dir", default="/app/models")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    Path(args.model_dir).mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        fail(f"input file does not exist: {input_path}")

    if args.backend == "openvino":
        probe_openvino()
    elif args.backend == "cuda":
        probe_cuda()

    separator = build_separator(str(output_dir), args.model_dir)
    separator.load_model(model_filename=args.model)
    output_files = separator.separate(str(input_path))

    instrumental = pick_instrumental(output_files, output_dir)
    if not instrumental.exists():
        fail(f"instrumental path does not exist after separation: {instrumental}")

    result = {"instrumentalPath": str(instrumental.resolve())}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
