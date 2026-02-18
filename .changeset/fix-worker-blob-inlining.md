---
"@fideus-labs/fidnii": patch
---

Fix "Worker error" during OME-Zarr conversion by upgrading `@fideus-labs/ngff-zarr` to 0.12.3. The 0.12.1/0.12.2 builds had a broken inline worker blob caused by `$&` in the Emscripten-generated bundle being interpreted as a `String.replace()` back-reference, injecting the original `new Worker(new URL(...))` expression into the blob source as a syntax error. Also pass chunk size through to `itkImageToNgffImage` so user-selected chunk dimensions are respected during conversion.
