import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron",
      rollupOptions: { input: "electron/main.ts" },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      emptyOutDir: false,
      outDir: "dist-electron",
      rollupOptions: { input: "electron/preload.ts" },
    },
  },
  renderer: {
    root: ".",
    plugins: [
      react(),
      {
        name: "development-csp",
        apply: "serve",
        transformIndexHtml: {
          order: "post",
          handler: (html) =>
            html.replace(
              "script-src 'self'",
              "script-src 'self' 'unsafe-inline'",
            ),
        },
      },
    ],
    build: { outDir: "dist", rollupOptions: { input: "index.html" } },
  },
});
