// Browser-only UI preview. No IPC, network, credentials or persistent storage.
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import "@fontsource-variable/inter-tight";
import CenterPreview from "../src/center/preview/CenterPreview";
document.documentElement.dataset.mode =
  new URLSearchParams(location.search).get("mode") === "light"
    ? "light"
    : "dark";
createRoot(document.getElementById("root")!).render(<CenterPreview />);
