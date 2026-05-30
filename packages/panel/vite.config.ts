import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

// Built to a self-contained static bundle (base "./") so @engram/core can
// serve it from any mount path. In dev, /api is proxied to the running core
// HTTP server on loopback:4319.
export default defineConfig({
  plugins: [react() as PluginOption],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4319",
        changeOrigin: false,
      },
    },
  },
});
