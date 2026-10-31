// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ToastViewport from "../components/ToastViewport";
import { useToastMessage } from "../hooks/useToastMessage";
import { toast, useToasts, withUndo } from "../toast";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useToasts.getState().dismiss();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(ToastViewport)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useToasts.getState().dismiss();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const card = () => host.querySelector(".toast");

it.each(["show", "error"] as const)("dismisses %s feedback at five seconds", (kind) => {
  act(() => { toast[kind]("官网内容在读取期间发生变化，请重新刷新"); });
  expect(card()?.getAttribute("role")).toBe(kind === "error" ? "alert" : "status");
  advance(4999);
  expect(card()?.textContent).toContain("请重新刷新");
  advance(1);
  expect(card()).toBeNull();
  expect(useToasts.getState().current).toBeNull();
});

it("gives a replacement a full five seconds and ignores the old dismissal", () => {
  let first = 0;
  act(() => { first = toast.error("旧提示"); });
  advance(4000);
  act(() => { toast.error("新提示"); });
  act(() => useToasts.getState().dismiss(first));
  advance(1000);
  expect(card()?.textContent).toContain("新提示");
  advance(3999);
  expect(card()).not.toBeNull();
  advance(1);
  expect(card()).toBeNull();
});

it("can close any notice manually without stealing the current input focus", () => {
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  act(() => { toast.show("已保存"); });
  expect(document.activeElement).toBe(input);
  act(() => host.querySelector<HTMLButtonElement>(".toast-dismiss")!.click());
  expect(card()).toBeNull();
  act(() => { toast.error("稍后的错误"); });
  advance(4999);
  expect(card()?.textContent).toContain("稍后的错误");
  advance(1);
  expect(card()).toBeNull();
  input.remove();
});

function Pane({ name }: { name: string }) {
  const [error, notify] = useToastMessage();
  return createElement("section", { "data-pane": name },
    createElement("span", {}, error ? "正文暂不可用" : "正在载入"),
    createElement("button", { onClick: () => notify(name) }, "失败"),
    createElement("button", { onClick: () => notify("") }, "清除"));
}
const paneButton = (name: string, index = 0) => host.querySelectorAll<HTMLButtonElement>(`[data-pane="${name}"] button`)[index];

it("can repeat an identical error after expiry while retaining the pane failure state", () => {
  act(() => root.render(createElement(Fragment, null, createElement(Pane, { name: "读取失败" }), createElement(ToastViewport))));
  act(() => paneButton("读取失败").click());
  advance(5000);
  expect(card()).toBeNull();
  expect(host.querySelector("section span")?.textContent).toBe("正文暂不可用");
  act(() => paneButton("读取失败").click());
  expect(card()?.textContent).toContain("读取失败");
  advance(4999);
  expect(card()).not.toBeNull();
  advance(1);
  expect(card()).toBeNull();
});

it("does not let another pane clearing its error erase the latest notice", () => {
  act(() => root.render(createElement(Fragment, null, createElement(Pane, { name: "甲" }), createElement(Pane, { name: "乙" }), createElement(ToastViewport))));
  act(() => paneButton("甲").click());
  act(() => paneButton("乙").click());
  act(() => paneButton("甲", 1).click());
  expect(card()?.textContent).toContain("乙");
  act(() => paneButton("乙", 1).click());
  expect(card()).toBeNull();
});

it("keeps the destructive undo deadline aligned with its existing grace period", () => {
  const apply = vi.fn(), commit = vi.fn(), revert = vi.fn();
  act(() => withUndo({ text: "已移除", apply, commit, revert }));
  expect(apply).toHaveBeenCalledOnce();
  advance(5000);
  expect(card()).not.toBeNull();
  expect(commit).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>(".toast-action")!.click());
  advance(1000);
  expect(revert).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
  act(() => withUndo({ text: "再次移除", apply, commit, revert }));
  act(() => host.querySelector<HTMLButtonElement>(".toast-dismiss")!.click());
  advance(5999);
  expect(commit).not.toHaveBeenCalled();
  advance(1);
  expect(commit).toHaveBeenCalledOnce();
});
