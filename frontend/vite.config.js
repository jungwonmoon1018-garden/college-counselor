import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two pages: the student app (index.html) and the operator setup
      // (setup.html). Keeps the setup UI fully isolated from App.jsx.
      input: {
        main: resolve(__dirname, "index.html"),
        setup: resolve(__dirname, "setup.html"),
        methodology: resolve(__dirname, "methodology.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/dashboard": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
