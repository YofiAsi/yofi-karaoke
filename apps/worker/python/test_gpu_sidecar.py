"""Unit tests for the gpu_sidecar.py request loop. Run: python -m unittest discover -s apps/worker/python"""

import io
import json
import sys
import unittest
from unittest import mock

from gpu_sidecar import Sidecar, serve
from separation import SeparationError, use_fast_chunk_tensors


class StubSeparation:
    def __init__(self):
        self.calls = 0

    def separate(self, input_path, output_dir, model, backend, model_dir, bitrate):
        self.calls += 1
        if input_path == "missing.wav":
            raise SeparationError("input file does not exist: missing.wav")
        if input_path == "crash.wav":
            raise RuntimeError("CUDA error: an illegal memory access was encountered")
        if input_path == "keyerror.wav":
            raise KeyError("mdx_dim_f_set")
        return {"instrumentalPath": f"{output_dir}/i.mp3", "vocalsPath": f"{output_dir}/v.mp3"}

    def prepare(self, model, backend, model_dir, bitrate):
        return {"loadMs": 1}


class StubTranscription:
    def transcribe(self, input_path, language, model_dir, device):
        words = [{"text": " x", "start": 0.0, "end": 1.0, "probability": float("nan")}] if input_path == "nan.mp3" else []
        return {"language": language, "device": device, "words": words}


def transcribe_request(request_id: int, input_path: str) -> str:
    params = {"input": input_path, "language": "he", "modelDir": "/m", "device": "cuda"}
    return json.dumps({"id": request_id, "op": "transcribe", "params": params}) + "\n"


def separate_request(request_id: int, input_path: str) -> str:
    params = {"input": input_path, "outputDir": "/w", "model": "m", "backend": "cuda", "modelDir": "/m", "bitrate": "192k"}
    return json.dumps({"id": request_id, "op": "separate", "params": params}) + "\n"


def run(lines: str):
    protocol = io.StringIO()
    code = serve(Sidecar(StubSeparation(), StubTranscription()), io.StringIO(lines), protocol)
    return code, [json.loads(line) for line in protocol.getvalue().splitlines()]


class SidecarTest(unittest.TestCase):
    def test_answers_each_request_in_order(self):
        transcribe = json.dumps({"id": 2, "op": "transcribe", "params": {"input": "v.mp3", "language": "he", "modelDir": "/m", "device": "cuda"}})
        code, responses = run(separate_request(1, "a.wav") + "\n" + transcribe + "\n")
        self.assertEqual(code, 0)
        self.assertEqual([r["id"] for r in responses], [1, 2])
        self.assertEqual(responses[0]["result"]["vocalsPath"], "/w/v.mp3")
        self.assertEqual(responses[1]["result"]["language"], "he")

    def test_expected_errors_keep_the_process_alive(self):
        code, responses = run(separate_request(1, "missing.wav") + separate_request(2, "a.wav"))
        self.assertEqual(code, 0)
        self.assertFalse(responses[0]["ok"])
        self.assertFalse(responses[0]["fatal"])
        self.assertIn("does not exist", responses[0]["error"])
        self.assertTrue(responses[1]["ok"])

    def test_unexpected_errors_are_fatal(self):
        code, responses = run(separate_request(1, "crash.wav") + separate_request(2, "a.wav"))
        self.assertEqual(code, 1)
        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0]["fatal"])
        self.assertIn("illegal memory access", responses[0]["error"])

    def test_a_key_error_inside_a_library_is_fatal(self):
        code, responses = run(separate_request(1, "keyerror.wav") + separate_request(2, "a.wav"))
        self.assertEqual(code, 1)
        self.assertTrue(responses[0]["fatal"])
        self.assertIn("KeyError", responses[0]["error"])

    def test_a_result_that_is_not_valid_json_becomes_an_error_response(self):
        code, responses = run(transcribe_request(1, "nan.mp3") + transcribe_request(2, "v.mp3"))
        self.assertEqual(code, 0)
        self.assertEqual(responses[0]["id"], 1)
        self.assertFalse(responses[0]["ok"])
        self.assertFalse(responses[0]["fatal"])
        self.assertTrue(responses[1]["ok"])

    def test_rejects_unknown_ops_and_bad_lines(self):
        _, responses = run('{"id": 5, "op": "dance"}\nnot json\n{"id": 6, "op": "separate", "params": {}}\n')
        self.assertIn("unknown op", responses[0]["error"])
        self.assertIsNone(responses[1]["id"])
        self.assertIn("missing parameter input, outputDir", responses[2]["error"])
        self.assertTrue(all(not r["fatal"] for r in responses))

    def test_rejects_wrongly_typed_params(self):
        line = json.dumps({"id": 7, "op": "transcribe", "params": {"input": 3, "language": "he", "modelDir": "/m", "device": "cuda"}})
        _, responses = run(line + "\n" + '{"id": 8, "op": "ping", "params": []}\n' + "[1]\n")
        self.assertIn("missing parameter input", responses[0]["error"])
        self.assertTrue(responses[1]["ok"])
        self.assertIn("JSON object", responses[2]["error"])


class FastChunkTensorTest(unittest.TestCase):
    def test_separation_continues_unpatched_when_the_library_layout_changes(self):
        with mock.patch.dict(sys.modules, {"torch": None}):
            note = use_fast_chunk_tensors()
        self.assertIn("unavailable, separating unpatched", note)


if __name__ == "__main__":
    unittest.main()
