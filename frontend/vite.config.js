import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const saasBuild = mode === "saas";
  const webBuild = mode === "web" || saasBuild;

  return {
    plugins: [react()],
    build: {
      // Keep the supported evergreen-browser floor explicit so upgrades do
      // not silently narrow Chrome/Edge/Firefox/Safari compatibility.
      target: ["chrome109", "edge109", "firefox115", "safari16.4"],
      rollupOptions: {
        // The administrator surface requires the privileged Electron preload
        // bridge. Keep it in desktop builds and omit it from public web builds.
        input: {
          main: resolve(__dirname, "index.html"),
          methodology: resolve(__dirname, "methodology.html"),
          ...(saasBuild ? { organization: resolve(__dirname, "organization.html") } : {}),
          ...(!webBuild ? { admin: resolve(__dirname, "admin.html") } : {}),
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
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test-setup.js",
      clearMocks: true,
    },
  };
});
