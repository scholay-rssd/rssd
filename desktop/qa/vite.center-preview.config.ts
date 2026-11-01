import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Build a public-only fixture first. The preview server never serves the workspace.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../.local/center-preview", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./center-preview.html", import.meta.url)),
    },
  },
  preview: { host: "127.0.0.1", port: 1432, strictPort: true },
});
