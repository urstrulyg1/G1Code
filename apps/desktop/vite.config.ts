import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "apps/desktop",
  // Critical for the packaged Electron app: when the window loads the built
  // index.html via `file://`, every asset URL must be relative. An absolute
  // `/assets/...` or `/src/...` path resolves against the filesystem root and
  // fails, leaving the window blank (React never mounts).
  base: "./",
  // Vite's default public dir is `apps/desktop/public`, which doesn't exist.
  // The actual static assets (icon.png etc.) live in the repo-root `public/`.
  publicDir: "../../public",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3131",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "../../dist", emptyOutDir: true },
});
