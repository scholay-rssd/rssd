import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest covers the dependency-free, pure logic modules: the browser-extension
// feed detection (feature F6) and the highlight re-anchoring algorithm
// (feature F7, `src/lib/anchor.ts`). Both run in a plain node environment —
// Interaction tests opt into jsdom with a per-file environment directive.
export default defineConfig({
  server:{fs:{allow:[fileURLToPath(new URL("..",import.meta.url))]}},
  test: {
    include: [
      "extension/test/**/*.test.{js,ts}",
      "src/lib/**/*.test.ts",
      "src/hot/**/*.test.ts",
      "src/labels/**/*.test.ts",
      "src/calendar/**/*.test.ts",
      "src/library/**/*.test.ts",
      "src/center/**/*.test.{ts,tsx}",
    ],
    environment: "node",
  },
});
