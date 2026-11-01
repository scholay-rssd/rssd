import { build, preview } from "vite";
import { fileURLToPath } from "node:url";

const configFile = fileURLToPath(
  new URL("../qa/vite.center-preview.config.ts", import.meta.url),
);
await build({ configFile });
const server = await preview({ configFile });
console.log(
  "RSSD center UI preview: http://127.0.0.1:1432/center-preview.html",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.httpServer.close(() => process.exit(0)));
