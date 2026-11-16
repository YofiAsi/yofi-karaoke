"""Stem separation with audio-separator, kept loaded per model setup.

Two speedups leave the output byte identical: both stems are encoded concurrently after inference, and the MDX
module builds each chunk tensor with torch.from_numpy instead of torch.tensor on a list, which costs about 5 s on a five minute song.
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

VOCALS_TOKENS = ("(vocals)",)
INSTRUMENTAL_TOKENS = ("(instrumental)", "(no vocals)", "(no_vocals)", "(accompaniment)")


class StemPickError(Exception):
    pass


class SeparationError(Exception):
    pass


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


def probe_openvino() -> str:
    try:
        import openvino as ov

        devices = ov.Core().available_devices
    except Exception as exc:
        raise SeparationError(f"failed to probe OpenVINO GPU: {exc}") from exc
    if "GPU" not in devices:
        raise SeparationError(f"OpenVINO reports no GPU device. available={devices}")
    return f"openvino devices={devices}"


def probe_cuda() -> str:
    try:
        from cuda_probe import assert_cuda_session

        return assert_cuda_session()
    except Exception as exc:
        raise SeparationError(f"CUDA provider unavailable: {exc}") from exc


BACKEND_PROBES = {"openvino": probe_openvino, "cuda": probe_cuda}


class ChunkTensorTorch:
    def __init__(self, torch_module, numpy_module):
        self.torch = torch_module
        self.np = numpy_module

    def __getattr__(self, name):
        return getattr(self.torch, name)

    def is_single_float_chunk(self, data, dtype) -> bool:
        single = isinstance(data, list) and len(data) == 1 and isinstance(data[0], self.np.ndarray)
        return single and dtype is self.torch.float32

    def tensor(self, data, dtype=None, **kwargs):
        if not kwargs and self.is_single_float_chunk(data, dtype):
            return self.torch.from_numpy(self.np.array(data, dtype=self.np.float32))
        return self.torch.tensor(data, dtype=dtype, **kwargs)


def use_fast_chunk_tensors() -> None:
    import numpy
    import torch
    from audio_separator.separator.architectures import mdx_separator

    if getattr(mdx_separator, "torch", None) is torch:
        mdx_separator.torch = ChunkTensorTorch(torch, numpy)


def build_separator(model_dir: str, bitrate: str):
    try:
        from audio_separator.separator import Separator
    except Exception as exc:
        raise SeparationError(f"failed to import audio_separator: {exc}") from exc

    use_fast_chunk_tensors()
    return Separator(
        output_dir=model_dir,
        output_format="mp3",
        output_bitrate=bitrate,
        model_file_dir=model_dir,
    )


def stem_writer(model_instance):
    return model_instance.write_audio_soundfile if model_instance.use_soundfile else model_instance.write_audio_pydub


class ParallelStemWrites:
    def __init__(self, model_instance):
        self.model_instance = model_instance
        self.writer = stem_writer(model_instance)
        self.pending = []

    def __enter__(self):
        self.model_instance.write_audio = self.defer
        return self

    def __exit__(self, *exc):
        del self.model_instance.write_audio
        return False

    def defer(self, stem_path, stem_source):
        self.pending.append((stem_path, stem_source))

    def flush(self) -> None:
        if not self.pending:
            return
        with ThreadPoolExecutor(max_workers=len(self.pending)) as pool:
            futures = [pool.submit(self.writer, path, source) for path, source in self.pending]
        self.pending = []
        for future in futures:
            future.result()


def existing_path(p, label: str):
    if p is None:
        return None
    if not p.exists():
        raise SeparationError(f"{label} path does not exist after separation: {p}")
    return str(p.resolve())


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def stderr_log(message: str) -> None:
    print(f"separate.py {message}", file=sys.stderr, flush=True)


class SeparationEngine:
    def __init__(self, log=stderr_log):
        self.separators = {}
        self.probed = set()
        self.log = log

    def probe(self, backend: str) -> None:
        if backend in self.probed:
            return
        probe = BACKEND_PROBES.get(backend)
        if probe:
            self.log(probe())
        self.probed.add(backend)

    def separator_for(self, model: str, backend: str, model_dir: str, bitrate: str):
        key = (model, backend, model_dir, bitrate)
        if key not in self.separators:
            self.probe(backend)
            Path(model_dir).mkdir(parents=True, exist_ok=True)
            separator = build_separator(model_dir, bitrate)
            separator.load_model(model_filename=model)
            self.separators[key] = separator
        return self.separators[key]

    def prepare(self, model: str, backend: str, model_dir: str, bitrate: str) -> dict:
        started = time.perf_counter()
        self.separator_for(model, backend, model_dir, bitrate)
        return {"loadMs": elapsed_ms(started)}

    def separate(self, input_path: str, output_dir: str, model: str, backend: str, model_dir: str, bitrate: str) -> dict:
        source = Path(input_path)
        if not source.exists():
            raise SeparationError(f"input file does not exist: {source}")
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        started = time.perf_counter()
        separator = self.separator_for(model, backend, model_dir, bitrate)
        load_ms = elapsed_ms(started)
        separator.output_dir = str(out)
        separator.model_instance.output_dir = str(out)

        started = time.perf_counter()
        with ParallelStemWrites(separator.model_instance) as writes:
            output_files = separator.separate(str(source))
            inference_ms = elapsed_ms(started)
            started = time.perf_counter()
            writes.flush()
        encode_ms = elapsed_ms(started)
        self.log(f"outputs: {output_files}")

        try:
            instrumental, vocals = pick_stems(output_files, out)
        except StemPickError as exc:
            raise SeparationError(str(exc)) from exc
        return {
            "instrumentalPath": existing_path(instrumental, "instrumental"),
            "vocalsPath": existing_path(vocals, "vocals"),
            "loadMs": load_ms,
            "inferenceMs": inference_ms,
            "encodeMs": encode_ms,
        }
