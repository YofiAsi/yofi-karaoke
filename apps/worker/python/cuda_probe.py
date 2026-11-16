"""Fails unless onnxruntime can run a session on the CUDA execution provider.

Importing torch first loads the CUDA and cuDNN DLLs bundled in its wheel, which onnxruntime then reuses.
"""

import sys


class CudaUnavailable(Exception):
    pass


def preload_cuda_dlls() -> None:
    try:
        import torch  # noqa: F401
    except ImportError:
        pass


def tiny_model_bytes() -> bytes:
    from onnx import TensorProto, helper

    x = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1])
    y = helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])
    node = helper.make_node("Add", ["x", "x"], ["y"])
    graph = helper.make_graph([node], "cuda_probe", [x], [y])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    return model.SerializeToString()


def assert_cuda_session() -> str:
    preload_cuda_dlls()
    import onnxruntime as ort

    session = ort.InferenceSession(tiny_model_bytes(), providers=["CUDAExecutionProvider"])
    active = session.get_providers()
    if active[0] != "CUDAExecutionProvider":
        raise CudaUnavailable(f"onnxruntime {ort.__version__} fell back to {active}")
    return f"onnxruntime {ort.__version__} runs on {active[0]}"


def main() -> None:
    try:
        print(assert_cuda_session())
    except CudaUnavailable as exc:
        print(f"cuda_probe ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
