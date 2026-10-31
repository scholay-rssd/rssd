// Render the approved orthogonal master on rounded tiles, then package it.
// Run from the repository root: node desktop/scripts/gen-branding.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const cli = "node_modules/@tauri-apps/cli/tauri.js";
const master = readFileSync("public/rssd-mark.svg", "utf8");
const mark = master.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1];
const markViewBox = master.match(/\bviewBox="([^"]+)"/)?.[1];
if (!mark || !markViewBox) throw new Error("RSSD vector master is missing");
const scratch = mkdtempSync(join(tmpdir(), "rssd-branding-"));
const render = (source, size, destination) => {
  const output = join(scratch, `${size}-${destination.replace(/[^a-z0-9]/gi, "-")}`);
  run(process.execPath, [cli, "icon", source, "--png", String(size), "--output", output]);
  copyFileSync(join(output, `${size}x${size}.png`), destination);
};
const tile = (background, foreground, edge) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <!-- No surrounding frame: larger letters and open gaps survive small sizes. -->
  <rect x="64" y="64" width="896" height="896" rx="208" fill="${background}" stroke="${edge}" stroke-width="2"/>
  <g transform="translate(44.8 44.8) scale(7.3)" color="${foreground}">${mark}</g>
</svg>\n`;
try {
  if (!process.argv.includes("--tray-only")) {
    mkdirSync("public/branding", { recursive: true });
    const palettes = {
      dark: ["#20242C", "#F8F6F2", "#606773"],
      light: ["#F8F5EE", "#242B36", "#D6D0C5"],
      blue: ["#1758C6", "#FFFFFF", "#447DDF"],
      amber: ["#F3BE4B", "#262B34", "#D79F2F"],
    };
    for (const [name, colors] of Object.entries(palettes)) {
      const source = `public/branding/rssd-icon-${name}.svg`;
      writeFileSync(source, tile(...colors));
      render(source, 1024, `public/branding/rssd-icon-${name}.png`);
    }
    copyFileSync("public/branding/rssd-icon-dark.svg", "public/rssd-icon.svg");
    copyFileSync("public/branding/rssd-icon-dark.png", "public/rssd-icon.png");
    run(process.execPath, [cli, "icon", "public/rssd-icon.svg", "--output", "src-tauri/icons"]);
  }
  // macOS uses just the alpha of this glyph, so the system can tint it for
  // either menu-bar appearance. Other platforms retain the neutral app tile.
  const traySource = "src-tauri/icons/rssd-tray.svg";
  writeFileSync(traySource, `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="${markViewBox}" color="#000000">${mark}</svg>\n`);
  render(traySource, 44, "src-tauri/icons/tray-macos.png");
  copyFileSync("src-tauri/icons/32x32.png", "src-tauri/icons/tray.png");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
