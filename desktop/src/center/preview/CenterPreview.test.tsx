// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CenterPreview from "./CenterPreview";

let host: HTMLDivElement, root: Root;
const buttons = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => (b.getAttribute("aria-label") || b.textContent?.trim()) === text,
  );
const click = async (text: string) =>
  act(async () => {
    const button = buttons(text)[0];
    expect(button, `Button: ${text}`).toBeDefined();
    button.click();
  });
const setValue = async (
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
const submit = async (form: HTMLFormElement) =>
  act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Preview must not contact a service");
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(CenterPreview)));
});
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("filters all four views by the selected workspaces, including an empty scope", async () => {
  expect(host.querySelectorAll(".cp-space-table tbody tr")).toHaveLength(10);
  await click("清除");
  expect(host.querySelectorAll(".cp-space-table tbody tr")).toHaveLength(0);
  const academic = [
    ...host.querySelectorAll<HTMLLabelElement>(".cp-scope-menu label"),
  ].find((l) => l.textContent === "今日学术")!;
  await act(async () =>
    academic.querySelector<HTMLInputElement>("input")!.click(),
  );
  expect(host.querySelectorAll(".cp-space-table tbody tr")).toHaveLength(1);
  await act(async () =>
    host.querySelectorAll<HTMLButtonElement>(".cp-tabs button")[1].click(),
  );
  expect(host.querySelectorAll(".cp-demands-table tbody tr")).toHaveLength(3);
  expect(host.querySelector(".cp-demands-table")?.textContent).not.toContain(
    "研究方法",
  );
  await click("发布日历");
  expect(host.querySelectorAll(".cp-event")).toHaveLength(3);
  await click("中心助手");
  expect(host.querySelector(".cp-assistant-context dd")?.textContent).toBe(
    "今日学术",
  );
});

it("includes external accounts and filters their schedules separately from owned sites", async () => {
  await click("发布渠道");
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>(".cp-state-filters button")]
      .find((b) => b.textContent?.startsWith("外部平台"))!
      .click(),
  );
  expect(host.querySelectorAll(".cp-channels-table tbody tr")).toHaveLength(5);
  expect(host.querySelector(".cp-channels-table")?.textContent).toContain(
    "Facebook",
  );
  expect(host.querySelector(".cp-channels-table")?.textContent).toContain(
    "未连接",
  );
  await click("发布日历");
  await setValue(
    host.querySelector<HTMLSelectElement>(".cp-destination select")!,
    "external",
  );
  expect(host.querySelectorAll(".cp-event")).toHaveLength(4);
  expect(host.querySelector(".cp-calendar")?.textContent).not.toContain(
    "· 网站",
  );
  await setValue(
    host.querySelector<HTMLSelectElement>(".cp-destination select")!,
    "owned",
  );
  expect(host.querySelectorAll(".cp-event")).toHaveLength(6);
});

it("simulates a claim without an external effect and freezes an active brief", async () => {
  await act(async () =>
    host.querySelectorAll<HTMLButtonElement>(".cp-tabs button")[1].click(),
  );
  await click("开放评审：研究者如何回应公开的质疑");
  await click("模拟认领");
  expect(host.textContent).toContain("未启动生产");
  await click("开放评审：研究者如何回应公开的质疑");
  expect(host.querySelector("dialog")?.textContent).toContain(
    "本机 · 模拟认领",
  );
  expect(buttons("模拟认领")[0].disabled).toBe(true);
  expect(host.querySelector<HTMLSelectElement>("dialog select")?.disabled).toBe(
    true,
  );
  await click("关闭详情");
  await click("重置预览");
  await click("开放评审：研究者如何回应公开的质疑");
  expect(buttons("模拟认领")[0].disabled).toBe(false);
});

it("keeps language and destination schedules linked to one work without changing the delivery target", async () => {
  const metrics = host.querySelector(".cp-metrics")!.textContent;
  await click("发布日历");
  const matching = [
    ...host.querySelectorAll<HTMLButtonElement>(".cp-event"),
  ].filter((b) =>
    /置信区间|Understanding confidence/.test(b.textContent || ""),
  );
  expect(matching).toHaveLength(3);
  for (const button of matching) {
    await act(async () => button.click());
    expect(host.querySelector("dialog")?.textContent).toContain("demo-work-2");
    await click("关闭详情");
  }
  await act(async () => matching[0].click());
  await setValue(
    host.querySelector<HTMLInputElement>("dialog input[type=date]")!,
    "2026-11-05",
  );
  await submit(host.querySelector<HTMLFormElement>("dialog form")!);
  expect(
    host.querySelector('section[aria-label="2026-11-05"]')?.textContent,
  ).toContain("置信区间");
  await click("全局总览");
  expect(host.querySelector(".cp-metrics")!.textContent).toBe(metrics);
});

it("keeps the displayed month when switching from month to week", async () => {
  await click("发布日历");
  await click("月");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="下一时段"]')!.click(),
  );
  await click("周");
  expect(host.querySelector(".cp-calendar-date strong")?.textContent).toBe(
    "11/30 — 12/06",
  );
});

it("preserves each preview message agent and scope when selectors change later", async () => {
  await click("中心助手");
  await setValue(
    host.querySelector<HTMLTextAreaElement>("textarea")!,
    "检查研究方法的选题缺口",
  );
  await click("预览发送");
  await setValue(
    host.querySelector<HTMLSelectElement>('[aria-label="预览智能体"]')!,
    "Cursor",
  );
  expect(host.querySelector(".cp-agent-message small")?.textContent).toBe(
    "Codex · 示例回复",
  );
  await click("清除");
  await setValue(
    host.querySelector<HTMLTextAreaElement>("textarea")!,
    "不可在空范围发送",
  );
  expect(buttons("预览发送")[0].disabled).toBe(true);
  expect(host.querySelector(".cp-user-message small")?.textContent).toBe(
    "你 · 全部工作空间",
  );
});
