"""Vocals transcription with faster-whisper, keeping each loaded Whisper model for later requests.

Hebrew uses the ivrit.ai model; anything else uses the multilingual turbo model, switching to the
ivrit.ai model when Whisper itself detects Hebrew.
"""

import importlib.util
import os
import sys
import time
from pathlib import Path

from whisper_models import GENERAL_MODEL, HEBREW_MODEL

HEBREW = "he"
RANDOM_SEED = 7
SAMPLE_RATE = 16000
VAD_PARAMETERS = {"threshold": 0.2, "min_silence_duration_ms": 2000, "speech_pad_ms": 400}


class TranscriptionError(Exception):
    pass


def stderr_log(message: str) -> None:
    print(f"transcribe.py {message}", file=sys.stderr, flush=True)


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
        raise TranscriptionError(f"ctranslate2 {ctranslate2.__version__} sees no CUDA device")
    return f"ctranslate2 {ctranslate2.__version__} cuda_devices={count}"


def decode(path: str):
    from faster_whisper import decode_audio

    return decode_audio(path, sampling_rate=SAMPLE_RATE)


def to_word(word) -> dict:
    return {
        "text": word.word,
        "start": round(word.start, 3),
        "end": round(word.end, 3),
        "probability": round(word.probability, 3),
    }


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


class TranscriptionEngine:
    def __init__(self, log=stderr_log):
        self.models = {}
        self.cuda_checked = False
        self.log = log

    def check_device(self, device: str) -> None:
        if device == "cuda" and not self.cuda_checked:
            self.log(assert_cuda())
            self.cuda_checked = True

    def model(self, model_dir: Path, name: str, device: str):
        key = (str(model_dir), name, device)
        if key not in self.models:
            self.models[key] = self.load_model(model_dir, name, device)
        return self.models[key]

    def load_model(self, model_dir: Path, name: str, device: str):
        from faster_whisper import WhisperModel

        path = model_dir / name
        if not (path / "model.bin").is_file():
            raise TranscriptionError(f"model {name} is missing from {model_dir}; run scripts/party/setup.ps1")
        compute_type = "float16" if device == "cuda" else "int8"
        started = time.monotonic()
        model = WhisperModel(str(path), device=device, compute_type=compute_type)
        self.log(f"loaded {name} on {model.model.device} compute={compute_type} in {time.monotonic() - started:.1f}s")
        return model

    def detect_language(self, model, audio) -> str:
        from faster_whisper.vad import VadOptions

        language, probability, _ = model.detect_language(
            audio, vad_filter=True, vad_parameters=VadOptions(**VAD_PARAMETERS), language_detection_segments=3
        )
        self.log(f"detected language={language} probability={probability:.2f}")
        return language

    def pick_model(self, model_dir: Path, hint: str, audio, device: str):
        if hint == HEBREW:
            return self.model(model_dir, HEBREW_MODEL, device), HEBREW, "hint"
        general = self.model(model_dir, GENERAL_MODEL, device)
        detected = self.detect_language(general, audio)
        if detected == HEBREW:
            return self.model(model_dir, HEBREW_MODEL, device), HEBREW, "detected"
        return general, detected, "detected"

    def transcribe(self, input_path: str, language: str, model_dir: str, device: str) -> dict:
        if not Path(input_path).is_file():
            raise TranscriptionError(f"input file does not exist: {input_path}")
        self.check_device(device)
        started = time.monotonic()
        audio = decode(input_path)
        model, picked, language_source = self.pick_model(Path(model_dir), language, audio, device)
        words = [w for w in transcribe_words(model, audio, picked) if w["text"].strip()]
        self.log(f"transcribed {len(words)} words language={picked} in {time.monotonic() - started:.1f}s")
        return {
            "language": picked,
            "languageSource": language_source,
            "device": str(model.model.device),
            "durationSeconds": round(len(audio) / SAMPLE_RATE, 2),
            "words": words,
        }
