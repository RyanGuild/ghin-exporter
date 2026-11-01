import { defineConfig } from "vite";

// Project Pages URL: https://<user>.github.io/ghin-exporter/
export default defineConfig({
  base: process.env.VITE_BASE || "/ghin-exporter/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
