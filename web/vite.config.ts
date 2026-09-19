import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8080", changeOrigin: false },
      "/mcp": { target: "http://127.0.0.1:8080", changeOrigin: false }
    }
  },
  build: { outDir: "../dist/web", emptyOutDir: true }
});
