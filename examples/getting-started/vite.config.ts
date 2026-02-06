import { defineConfig } from "vite";
import path from "path";

// Resolve zarrita to a single instance to avoid Symbol mismatch between
// the version used by @fideus-labs/ngff-zarr and the one used by fidnii.
// Without this, Vite may pre-bundle two separate zarrita copies, causing
// zarr.get() to fail because the internal context Symbol differs.
const zarritaPath = path.resolve(
  __dirname,
  "node_modules/@fideus-labs/fidnii/node_modules/zarrita"
);

export default defineConfig({
  resolve: {
    alias: {
      zarrita: zarritaPath,
    },
  },
  build: {
    outDir: "dist",
  },
});
