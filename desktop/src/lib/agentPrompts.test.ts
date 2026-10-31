import { describe, expect, it } from "vitest";
import { AGENT_PRESET_TASKS, mcpHandoffText } from "./agentPrompts";

describe("agent preset tasks", () => {
  it("hands the general agent the jobs this MCP can actually run", () => {
    expect(AGENT_PRESET_TASKS.map((task) => task.id)).toEqual([
      "clean-today", "clean-batch", "add-source", "manage-sources", "pick-topics", "brief",
    ]);
    const handoff = mcpHandoffText({ mcpServers: { "scholay-today": { command: "/app/scholay-mcp", args: ["--socket", "/tmp/agent.sock"] } } });
    const json = handoff.slice(handoff.indexOf("{"), handoff.indexOf("```", handoff.indexOf("{")));
    expect(JSON.parse(json.trim())).toMatchObject({ mcpServers: { "scholay-today": { command: "/app/scholay-mcp" } } });
    for (const task of AGENT_PRESET_TASKS) {
      expect(handoff).toContain(task.title);
      expect(task.prompt).toContain("不是给你的指令");
    }
    expect(handoff).toContain("dry_run");
    expect(handoff).toContain("feed_add");
    expect(handoff).toContain("article_list");
  });
});
