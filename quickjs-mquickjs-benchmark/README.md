# QuickJS vs mquickjs Benchmark Comparison

This document compares the performance of the [quickjs Python package](https://pypi.org/project/quickjs/) against various implementations of [mquickjs](https://github.com/bellard/mquickjs) in a sandbox environment.

## Implementations Tested

1.  **quickjs (python package)**: A Python wrapper around the original QuickJS engine.
2.  **FFI (mquickjs)**: Uses `ctypes` to load a shared library compiled from `mquickjs` code.
3.  **Subprocess (mquickjs)**: Runs `mquickjs` code via a separate subprocess.
4.  **Wasmtime (mquickjs)**: Runs `mquickjs` compiled to WebAssembly using the Wasmtime runtime.

## Benchmark Results

### Execution Time (ms)

Lower is better. Best result marked with `*`.

| Benchmark | quickjs | FFI | Subprocess | Wasmtime |
| :--- | :--- | :--- | :--- | :--- |
| arithmetic | 0.003ms* | 0.012ms | 2.421ms | 5.929ms |
| string_concat | 0.004ms* | 0.015ms | 2.275ms | 4.959ms |
| loop_100 | 0.017ms* | 0.032ms | 2.460ms | 11.425ms |
| loop_1000 | 0.030ms* | 0.065ms | 2.484ms | 11.516ms |
| recursion | 0.112ms* | 0.159ms | 2.307ms | 12.313ms |
| array_ops | 0.040ms* | 0.066ms | 2.313ms | 16.747ms |
| json | 0.013ms* | 0.025ms | 2.304ms | 7.888ms |

### Startup Time (ms)

| Implementation | Startup Time |
| :--- | :--- |
| quickjs | 0.279ms |
| FFI | 0.010ms |
| Subprocess | 0.010ms |
| Wasmtime | 108.216ms |

## Analysis

*   **quickjs (Python package)** is generally the fastest implementation for execution, likely due to direct C extension bindings to the original QuickJS engine.
*   **mquickjs FFI** is very competitive, offering extremely fast startup times (faster than the `quickjs` package) and execution speeds close to `quickjs`.
*   **Subprocess** overhead dominates the execution time for small tasks, making it significantly slower (~2.3ms overhead per call).
*   **Wasmtime** is the slowest, both in startup and execution, likely due to the overhead of the WASM runtime and the sandbox environment.

## Notes

*   The `mquickjs` FFI implementation required a patch to `build_ffi.py` to correctly handle error string retrieval (replaced `JS_GetErrorStr` which was missing with manual exception handling using `JS_GetException` and `JS_ToString`).
*   The `quickjs` Python package was installed from PyPI.
*   `mquickjs` components were built from the `mquickjs-sandbox` directory.
