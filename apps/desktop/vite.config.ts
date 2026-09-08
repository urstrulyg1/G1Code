import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "apps/desktop",
  plugins: [react()],
  server: {
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
