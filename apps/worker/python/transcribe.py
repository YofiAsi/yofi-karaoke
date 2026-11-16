#!/usr/bin/env python3
"""Transcribes a vocals stem with faster-whisper and prints one JSON line with timed words.

Usage:
    transcribe.py --input <audio> --language <he|auto> --model-dir <dir> [--device cuda|cpu]

Hebrew uses the ivrit.ai model; anything else uses the multilingual turbo model, switching to the
ivrit.ai model when Whisper itself detects Hebrew. Fails fast when CUDA is requested but unusable.
"""

import argparse
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

from whisper_models import GENERAL_MODEL, HEBREW_MODEL

HEBREW = "he"
RANDOM_SEED = 7
VAD_PARAMETERS = {"threshold": 0.2, "min_silence_duration_ms": 2000, "speech_pad_ms": 400}


def log(message: str) -> None:
    print(f"transcribe.py {message}", file=sys.stderr, flush=True)


def fail(message: str) -> None:
    print(f"transcribe.py ERROR: {message}", file=sys.stderr, flush=True)
    sys.exit(1)


def torch_lib_dir():
    spec = importlib.util.find_spec("torch")
    if spec is None or not spec.submodule_search_locations:
        return None
    lib = Path(list(spec.submodule_search_locations)[0]) / "lib"
    return lib if lib.is_dir() else None


def expose_cuda_dlls() -> None:
    if sys.platform != "win32":
        return
    lib = torch_lib_dir()
    if lib is None:
        return
    os.add_dll_directory(str(lib))
    os.environ["PATH"] = f"{lib}{os.pathsep}{os.environ.get('PATH', '')}"


def assert_cuda() -> str:
    expose_cuda_dlls()
    import ctranslate2

    count = ctranslate2.get_cuda_device_count()
    if count < 1:
        fail(f"ctranslate2 {ctranslate2.__version__} sees no CUDA device")
    return f"ctranslate2 {ctranslate2.__version__} cuda_devices={count}"


def load_model(model_dir: Path, name: str, device: str):
    from faster_whisper import WhisperModel

    path = model_dir / name
    if not (path / "model.bin").is_file():
        fail(f"model {name} is missing from {model_dir}; run scripts/party/setup.ps1")
    compute_type = "float16" if device == "cuda" else "int8"
    started = time.monotonic()
    model = WhisperModel(str(path), device=device, compute_type=compute_type)
    log(f"loaded {name} on {model.model.device} compute={compute_type} in {time.monotonic() - started:.1f}s")
    return model


def decode(path: str):
    from faster_whisper import decode_audio

    return decode_audio(path, sampling_rate=16000)


def detect_language(model, audio) -> str:
    from faster_whisper.vad import VadOptions

    language, probability, _ = model.detect_language(
        audio, vad_filter=True, vad_parameters=VadOptions(**VAD_PARAMETERS), language_detection_segments=3
    )
    log(f"detected language={language} probability={probability:.2f}")
    return language


def pick_model(model_dir: Path, hint: str, audio, device: str):
    if hint == HEBREW:
        return load_model(model_dir, HEBREW_MODEL, device), HEBREW, "hint"
    general = load_model(model_dir, GENERAL_MODEL, device)
    detected = detect_language(general, audio)
    if detected == HEBREW:
        del general
        return load_model(model_dir, HEBREW_MODEL, device), HEBREW, "detected"
    return general, detected, "detected"


def transcribe_words(model, audio, language: str) -> list:
    import ctranslate2

    ctranslate2.set_random_seed(RANDOM_SEED)
    segments, _ = model.transcribe(
        audio,
        language=language,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=VAD_PARAMETERS,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
    )
    return [to_word(word) for segment in segments for word in (segment.words or [])]


def to_word(word) -> dict:
    return {
        "text": word.word,
        "start": round(word.start, 3),
        "end": round(word.end, 3),
        "probability": round(word.probability, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    args = parser.parse_args()

    if not Path(args.input).is_file():
        fail(f"input file does not exist: {args.input}")
    if args.device == "cuda":
        log(assert_cuda())

    started = time.monotonic()
    audio = decode(args.input)
    model, language, language_source = pick_model(Path(args.model_dir), args.language, audio, args.device)
    words = [w for w in transcribe_words(model, audio, language) if w["text"].strip()]
    log(f"transcribed {len(words)} words language={language} in {time.monotonic() - started:.1f}s")
    print(json.dumps({
        "language": language,
        "languageSource": language_source,
        "device": str(model.model.device),
        "durationSeconds": round(len(audio) / 16000, 2),
        "words": words,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
