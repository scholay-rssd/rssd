#!/usr/bin/env python3
"""Build per-section topic briefs from each site's local RSS database (papr.db)."""
import json, os, sqlite3, sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HOME = Path(os.environ.get("SCHOLAY_HEADLESS_HOME", ROOT / ".local/headless"))
OUT = Path(os.environ.get("SCHOLAY_HEADLESS_BRIEFS", HOME / "briefs"))
SPACES = Path(os.environ.get("SCHOLAY_SPACES_ROOT", Path.home() / ".local/share/scholay/spaces"))
OUT.mkdir(parents=True, exist_ok=True)

IMG = (
    "配图优先级：① 有许可的网络原图（CC0/公有领域/CC BY/CC BY-SA，或机构新闻稿明示可用），"
    "图注写明作者/机构、来源与许可；② 确实找不到合规原图时再用 Generate Image 生成示意图，"
    "生成过程写入私有 images，公开图注只说明图表本身；③ 需要结构说明时用代码绘制。"
    "安排 1 个题图位置和 1–2 个正文配图位置，每个图片位置在 requirement 写清画面内容。"
    "每张图片都必须填写 alt：用 20–60 字具体描述画面内容，不写“图片”“配图”这类空话。"
)
BASE = (
    "先核对原始来源（论文、机构原文、官方页面）的发布日期、关键事实和局限，把核实过的来源保存到文章板 sources；"
    "RSS 抓取时间不是发表时间。必要事实、证据边界及是否冒充实测只作作者内部核验，记录进入私有 verification，不写成公开声明。文章板结构：标题、导语（第一段，80–150 字，能单独作为摘要）、"
    "2–4 个正文小节、参考文献（参考文献中的网址写成 Markdown 链接）。"
    "结构化记录（资源/日历/历史）只保留两个固定二级标题，参考文献用三级标题。"
    "不要自行添加品牌尾注，尾注由生产流程按品牌库挂载。"
)

def days_ago(n):
    return (date.today() - timedelta(days=n)).isoformat()

def short(db, folders=None, days=None, limit=30, kw=None):
    days = days or days_ago(14)
    if not Path(db).exists():
        return ""
    c = sqlite3.connect(db)
    q = (
        "select a.title,a.url,substr(a.published_at,1,10) from articles a "
        "join feeds f on f.id=a.feed_id left join folders fo on fo.id=f.folder_id "
        "where a.published_at>? and a.title!=''"
    )
    args = [days]
    if folders:
        q += " and (" + " or ".join("fo.name like ?" for _ in folders) + ")"
        args += [x + "%" for x in folders]
    if kw:
        q += " and (" + " or ".join("lower(a.title) like ?" for _ in kw) + ")"
        args += ["%" + k.lower() + "%" for k in kw]
    q += " order by a.published_at desc limit ?"
    args.append(limit)
    rows = c.execute(q, args).fetchall()
    return "\n".join(f"- {t.strip()} {u} ({d})" for t, u, d in rows)

def sp(space):
    return SPACES / space / "papr.db"

def academic_db():
    return Path(os.environ.get("SCHOLAY_TODAY_DB", ROOT / ".local/rss/academic.db"))

B = []

def add(site, sec, mode, ask, sl):
    txt = ask + "\n" + BASE + "\n" + IMG + (
        "\n本地 RSS 候选（标题 链接 日期），可从中选题，也可联网检索更合适的原始材料：\n" + sl if sl else ""
    )
    (OUT / f"{site}-{sec}.txt").write_text(txt, encoding="utf-8")
    B.append({"site": site, "sectionId": sec, "mode": mode})

A = academic_db()
add("scholay-today", "briefings", "xiwen", "编一期「学界犀闻」资讯汇编：从下面候选中挑选 3 个最近 7 天内发布、彼此独立、都能追溯到原始论文或机构原文的学术事件，每条一个小节，讲清发生了什么、怎么做的与意义，局限由作者内部核验。", short(A, limit=40))
add("scholay-today", "observations", "observation", "写一篇「学者观察」：挑选一个最近 7 天内发布、可追溯到原始论文或机构原文的单一学术事件（优先有公开许可图片的研究），讲清这一件事。", short(A, limit=40, days=days_ago(7)))
add("scholay-today", "calendar", "calendar", "做一条「学术日历」通知公告：找一个尚未截止、面向学者的真实事项（基金申报、学术会议征稿或注册截止、奖项提名等），以官方页面为准，分开核实原文发布日、活动区间和申请截止日。fields.category 只能取站点 yearCategories 之一；provenance 核验官网后写“已核验官网”。", short(A, kw=["call for", "deadline", "conference", "funding", "grant", "award", "征稿", "申报", "会议"], limit=30))
add("scholay-today", "resources", "opensource", "做一条「学术资源」开源介绍：选一个近期有新版本或新进展、对科研人员有用的开源工具/数据集/软件，核对官方仓库、许可证、最近版本日期与归档状态；安装运行情况仅记入私有 verification，不生成公开核验声明。fields.category 只能取站点 sourceCategories 之一。", short(A, kw=["open source", "open-source", "github", "software", "tool", "dataset", "release", "开源", "数据集"], limit=30))

M = sp("metho")
add("metho", "methods", "observation", "为「研究方法」站的「方法百科」板块写一篇方法讲解：选一个具体研究方法或统计概念（可由下面候选触发），讲清它解决什么问题、核心思路、使用前提、常见误用，配一个简短实例；以教材、方法论论文或权威教程为来源。", short(M, ["方法百科"]))
add("metho", "statistics", "observation", "为「研究方法」站的「统计之美」板块写一篇：围绕一个统计思想、可视化或统计史上的经典案例（可由下面候选触发），讲清直觉、数学要点和现实意义，必要时用代码绘制的示意图说明。", short(M, ["统计之美"]))
add("metho", "experiments", "observation", "为「研究方法」站的「实验星球」板块写一篇：选一项近期实验或实验设计案例（可由下面候选触发），重点讲实验设计——随机化、对照、样本量、测量与偏差控制，以及结论能推广到哪里。", short(M, ["实验星球"]))
add("metho", "frontiers", "observation", "为「研究方法」站的「方法前沿」板块写一篇：选一篇最近 30 天内发布的方法学新论文或新工具（可由下面候选触发），讲清它改进了什么及与已有方法的对比，适用边界由作者内部核验。", short(M, ["方法前沿"]))

E = sp("enter")
add("enter", "forums", "observation", "为「学术之门」站的「学术论坛」板块写一篇：介绍一个面向学者的学术社区/论坛/讨论平台的近期动态或一场值得关注的讨论（可由下面候选触发），讲清讨论什么、谁在参与、对学者的参考价值，引用原帖或官方页面。", short(E, ["学术论坛"]))
add("enter", "software", "opensource", "为「学术之门」站的「软件网站」板块做一条资源介绍：选一个对学者有用的软件或网站（优先开源或免费，可由下面候选触发），核对官网、许可证、最近版本日期与归档状态，讲清用途与上手方式，局限由作者内部核验；安装运行情况仅记入私有 verification，不生成公开核验声明。fields.category 只能取站点 sourceCategories 之一。", short(E, ["软件网站"]))
add("enter", "search", "observation", "为「学术之门」站的「学术检索」板块写一篇：介绍一个学术检索工具、数据库或检索功能的近期更新（可由下面候选触发），讲清能搜什么、怎么用、覆盖范围与局限，给出具体检索示例。", short(E, ["学术检索"]))
add("enter", "courses", "observation", "为「学术之门」站的「课程资源」板块写一篇：介绍一门面向学者或研究生的公开课程、培训或工作坊（可由下面候选触发），核实开课方、形式、费用和报名状态；无法核实的记入私有 verification 待办，不推断免费或报名有效。", short(E, ["课程资源"]))

P = sp("pets")
add("pets", "pet-news", "observation", "为「小猪萌宠」站的「宠物资讯」板块写一篇：选一条最近 30 天内的宠物相关新闻或研究（可由下面候选触发），核对原始来源，讲清发生了什么、对养宠人意味着什么。语气亲切，但事实严谨。", short(P, ["宠物资讯"]))
add("pets", "daily-cat", "observation", "为「小猪萌宠」站的「每日一猫」板块写一篇猫品种介绍：选一个猫品种，讲起源、外形、性格、常见健康问题和饲养要点，以品种协会（如 CFA、TICA）或兽医资料为来源。必须有真实猫咪照片（优先 Wikimedia Commons 等合规原图）。", short(P, ["每日一猫"]))
add("pets", "daily-dog", "observation", "为「小猪萌宠」站的「每日一狗」板块写一篇犬种介绍：选一个犬种，讲起源、外形、性格、运动与训练需求、常见健康问题，以犬业协会（如 AKC、FCI）或兽医资料为来源。必须有真实狗狗照片（优先 Wikimedia Commons 等合规原图）。", short(P, ["每日一狗"]))
add("pets", "exotic-pets", "observation", "为「小猪萌宠」站的「异宠大全」板块写一篇：介绍一种异宠（爬宠、小型哺乳动物、鸟类或水族等），讲习性、饲养环境、饮食、健康与合法性/伦理提醒，以兽医或专业饲养资料为来源。必须有真实动物照片（优先 Wikimedia Commons 等合规原图）。", short(P, ["异宠大全"]))

(OUT / "plan.json").write_text(json.dumps(B, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
for row in B:
    path = OUT / f"{row['site']}-{row['sectionId']}.txt"
    print(row["site"], row["sectionId"], row["mode"], len(path.read_text(encoding="utf-8").splitlines()))
