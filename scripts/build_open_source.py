#!/usr/bin/env python3
"""Build the public open-source snapshot from a lark-cli Base export."""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


PUBLIC_EXTRA = {
    "Academic Research Skills", "Hyperresearch", "alphaXiv OpenResearch",
    "CoAutoResearch", "Google AX", "StatsPAI", "Polaris", "OpenQuantum",
    "NVIDIA Medical AI Skills", "Open Science Assistant", "LabMCP",
    "Zotero Agents", "DeepTutor", "SmolDataEnvs", "Isaac ROS 5.0",
}

GROUPS = {
    "文献与写作": {
        "Academic Research Skills", "Hyperresearch", "Zotero Agents", "DeepTutor",
        "AIPOCH Open-Science", "Zotero MCP", "MinerU", "PaperQA2",
        "Paper2Agent", "PDFMathTranslate", "Jupyter AI", "Hister",
    },
    "科研 Agent": {
        "alphaXiv OpenResearch", "CoAutoResearch", "Polaris", "OpenQuantum",
        "Open Science Assistant", "Atria Dawn", "Scientific Agent Skills",
        "AutoResearch", "DeepAgents", "Reef",
    },
    "数据与评测": {
        "StatsPAI", "SmolDataEnvs", "Terminal-Bench-Science", "AgentSociety",
        "LimiX-2",
    },
    "实验与仪器": {"LabMCP", "Isaac ROS 5.0", "Instro", "fairchem"},
    "生命与医学": {"NVIDIA Medical AI Skills", "RADAR", "BioNeMo Agent Toolkit"},
    "基础设施": {"Google AX", "CliffCompaction"},
}


def url(value):
    if not value:
        return None
    match = re.search(r"https?://[^\s)\]；;]+", value)
    return match.group(0) if match else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON saved from lark-cli base +record-list")
    parser.add_argument("--output", type=Path, default=Path("open-source.json"))
    args = parser.parse_args()
    source = json.loads(args.input.read_text())["data"]
    rows = [dict(zip(source["fields"], row)) for row in source["data"]]
    names = {row["项目"] for row in rows}
    if not PUBLIC_EXTRA <= names:
        raise SystemExit(f"Missing public entries: {sorted(PUBLIC_EXTRA - names)}")
    groups = {name: group for group, items in GROUPS.items() for name in items}
    result = []
    for row in rows:
        name = row["项目"]
        if row["选用"] is not True and name not in PUBLIC_EXTRA:
            continue
        if name not in groups:
            raise SystemExit(f"Uncategorized public entry: {name}")
        project_url = url(row["仓库地址"])
        if not project_url:
            raise SystemExit(f"Missing project URL: {name}")
        result.append({
            "title": name,
            "date": row["日期"][:10],
            "summary": row["摘要"],
            "value": row["科研价值"],
            "url": project_url,
            "relatedUrl": url(row["相关链接"]),
            "category": groups[name],
            "status": "公开收录" if name in PUBLIC_EXTRA else "往期精选",
        })
    result.sort(key=lambda item: (item["date"], item["title"]), reverse=True)
    snapshot = {
        "exportedAt": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"),
        "source": "Scholay 学术开源项目表；项目链接来自原表",
        "items": result,
    }
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(result)} public entries to {args.output}")


if __name__ == "__main__":
    main()
