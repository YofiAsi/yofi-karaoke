#!/usr/bin/env python3
"""Thin CLI wrapper around audio-separator.

Usage:
    separate.py --input <audio> --output-dir <dir> --model <model> --backend <openvino|cuda|cpu> --bitrate <e.g. 192k>

Prints a single JSON line to stdout: {"instrumentalPath": str, "vocalsPath": str | null}.
Fails fast with non-zero exit if the requested GPU backend is not available.
"""

import argparse
import json
import sys
from pathlib import Path

VOCALS_TOKENS = ("(vocals)",)
INSTRUMENTAL_TOKENS = ("(instrumental)", "(no vocals)", "(no_vocals)", "(accompaniment)")


class StemPickError(Exception):
    pass


def fail(msg: str) -> None:
    print(f"separate.py ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def resolve_outputs(output_files, output_dir: Path) -> list:
    paths = []
    for f in output_files:
        p = Path(f)
        paths.append(p if p.is_absolute() else output_dir / p)
    return paths


def find_by_tokens(paths, tokens):
    for p in paths:
        name = p.name.lower()
        if any(token in name for token in tokens):
            return p
    return None


def only_other(paths, taken):
    rest = [p for p in paths if p != taken]
    return rest[0] if len(rest) == 1 else None


def pick_stems(output_files, output_dir: Path):
    paths = resolve_outputs(output_files, output_dir)
    vocals = find_by_tokens(paths, VOCALS_TOKENS)
    instrumental = find_by_tokens(paths, INSTRUMENTAL_TOKENS)

    if instrumental is None and vocals is not None:
        instrumental = only_other(paths, vocals)
    if instrumental is None and vocals is None and len(paths) == 1:
        instrumental = paths[0]
    if instrumental is None:
        raise StemPickError(f"Could not identify instrumental stem in outputs: {paths}")

    if vocals is None:
        vocals = only_other(paths, instrumental)
    return instrumental, vocals


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


def build_separator(output_dir: str, model_dir: str, bitrate: str):
    try:
        from audio_separator.separator import Separator
    except Exception as exc:
        fail(f"failed to import audio_separator: {exc}")

    return Separator(
        output_dir=output_dir,
        output_format="mp3",
        output_bitrate=bitrate,
        model_file_dir=model_dir,
    )


def existing_path(p, label: str):
    if p is None:
        return None
    if not p.exists():
        fail(f"{label} path does not exist after separation: {p}")
    return str(p.resolve())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--backend", default="openvino", choices=["openvino", "cuda", "cpu"])
    parser.add_argument("--model-dir", default="/app/models")
    parser.add_argument("--bitrate", default="192k")
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

    separator = build_separator(str(output_dir), args.model_dir, args.bitrate)
    separator.load_model(model_filename=args.model)
    output_files = separator.separate(str(input_path))
    print(f"separate.py outputs: {output_files}", file=sys.stderr)

    try:
        instrumental, vocals = pick_stems(output_files, output_dir)
    except StemPickError as exc:
        fail(str(exc))

    result = {
        "instrumentalPath": existing_path(instrumental, "instrumental"),
        "vocalsPath": existing_path(vocals, "vocals"),
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
