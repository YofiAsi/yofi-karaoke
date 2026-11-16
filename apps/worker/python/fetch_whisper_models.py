#!/usr/bin/env python3
"""Downloads the CTranslate2 Whisper models used by transcribe.py into <model-dir>/<name>."""

import argparse
import sys
from pathlib import Path

from whisper_models import MODELS

MODEL_FILES = ["config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.json"]


def is_complete(target: Path) -> bool:
    return all((target / name).is_file() for name in MODEL_FILES)


def fetch(repo: str, target: Path) -> None:
    from huggingface_hub import snapshot_download

    if is_complete(target):
        print(f"{repo}: already present in {target}", file=sys.stderr)
        return
    print(f"{repo}: downloading into {target}", file=sys.stderr)
    snapshot_download(repo_id=repo, local_dir=str(target), allow_patterns=MODEL_FILES)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    root = Path(args.model_dir)
    for name, repo in MODELS.items():
        fetch(repo, root / name)


if __name__ == "__main__":
    main()
