// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import WorkspaceHomeTab from "../components/WorkspaceHomeTab";

const styles = ["components/reader-tabs.css", "editorial/library-manager.css", "editorial/image-gallery.css", "hot/hot.css", "workspace.css"]
  .map(file => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", file), "utf8"));

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });

it.each([
  ["作品库", "manager-tabs"],
  ["图库", "gallery-tabs"],
  ["热榜", "reader-tabbar"],
])("fills and centers the fixed home button in %s regardless of stylesheet order", (label, className) => {
  for (const css of [styles, [...styles].reverse()]) {
    const style = document.createElement("style");
    style.textContent = css.join("\n");
    document.head.replaceChildren(style);
    for (const active of [false, true]) {
      document.body.innerHTML = renderToStaticMarkup(createElement("div", { className: "window-pane-toolbar" },
        createElement("div", { className }, createElement(WorkspaceHomeTab, { label, active, onSelect: () => {} })),
      ));
      const home = document.querySelector<HTMLElement>(".reader-home-tab")!;
      const button = home.querySelector<HTMLButtonElement>("[role=tab]")!;
      const homeStyle = getComputedStyle(home), buttonStyle = getComputedStyle(button);
      expect(homeStyle.width).toBe("36px");
      expect(homeStyle.height).toBe("30px");
      expect(buttonStyle.width).toBe("100%");
      expect(buttonStyle.height).toBe("100%");
      expect(buttonStyle.flexGrow).toBe("1");
      expect(buttonStyle.display).toBe("grid");
      expect(buttonStyle.placeItems).toBe("center");
      expect(buttonStyle.padding).toBe("0px");
      expect(buttonStyle.margin).toBe("0px");
      expect(button.querySelector("svg")?.getAttribute("width")).toBe("16");
    }
  }
});
