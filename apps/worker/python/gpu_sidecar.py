#!/usr/bin/env python3
"""Long lived GPU process for the worker: serves separation and transcription over JSON lines, keeping models loaded.

Request:  {"id": 1, "op": "separate" | "prepare_separate" | "transcribe" | "ping", "params": {...}}
Response: {"id": 1, "ok": true, "result": {...}, "ms": 123} or {"id": 1, "ok": false, "error": "...", "fatal": false}
Only protocol lines reach stdout; whatever libraries print goes to stderr. Exits on stdin EOF or after a fatal error.
"""

import json
import os
import sys
import time
import traceback

from separation import SeparationEngine, SeparationError
from transcription import TranscriptionEngine, TranscriptionError


class RequestError(Exception):
    pass


EXPECTED_ERRORS = (RequestError, SeparationError, TranscriptionError, KeyError)


def log(message: str) -> None:
    print(f"gpu_sidecar {message}", file=sys.stderr, flush=True)


def claim_protocol_stream():
    sys.stdout.flush()
    protocol = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return protocol


class Sidecar:
    def __init__(self, separation=None, transcription=None):
        self.separation = separation or SeparationEngine(log)
        self.transcription = transcription or TranscriptionEngine(log)
        self.handlers = {
            "separate": self.separate,
            "prepare_separate": self.prepare_separate,
            "transcribe": self.transcribe,
            "ping": self.ping,
        }

    def separate(self, p: dict) -> dict:
        return self.separation.separate(p["input"], p["outputDir"], p["model"], p["backend"], p["modelDir"], p["bitrate"])

    def prepare_separate(self, p: dict) -> dict:
        return self.separation.prepare(p["model"], p["backend"], p["modelDir"], p["bitrate"])

    def transcribe(self, p: dict) -> dict:
        return self.transcription.transcribe(p["input"], p["language"], p["modelDir"], p["device"])

    def ping(self, _p: dict) -> dict:
        return {"pid": os.getpid()}

    def handle(self, line: str) -> dict:
        request_id = None
        started = time.perf_counter()
        try:
            request = json.loads(line)
            request_id = request.get("id")
            handler = self.handlers.get(request.get("op"))
            if handler is None:
                raise RequestError(f"unknown op {request.get('op')!r}")
            result = handler(request.get("params") or {})
            return {"id": request_id, "ok": True, "result": result, "ms": round((time.perf_counter() - started) * 1000)}
        except json.JSONDecodeError as exc:
            return {"id": None, "ok": False, "error": f"invalid request line: {exc}", "fatal": False}
        except EXPECTED_ERRORS as exc:
            return {"id": request_id, "ok": False, "error": describe(exc), "fatal": False}
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            return {"id": request_id, "ok": False, "error": describe(exc), "fatal": True}


def describe(exc: Exception) -> str:
    if isinstance(exc, KeyError):
        return f"request is missing parameter {exc}"
    return f"{type(exc).__name__}: {exc}"


def respond(stream, response: dict) -> None:
    stream.write(json.dumps(response) + "\n")
    stream.flush()


def serve(sidecar: Sidecar, requests, protocol) -> int:
    for line in iter(requests.readline, ""):
        if not line.strip():
            continue
        response = sidecar.handle(line)
        respond(protocol, response)
        if response.get("fatal"):
            log("fatal error, exiting so the worker starts a fresh process")
            return 1
    return 0


def main() -> None:
    protocol = claim_protocol_stream()
    sys.stdin.reconfigure(encoding="utf-8")
    log(f"ready pid={os.getpid()}")
    sys.exit(serve(Sidecar(), sys.stdin, protocol))


if __name__ == "__main__":
    main()
