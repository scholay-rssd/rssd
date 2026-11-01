import { tr } from "../../uiText";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addDays,
  createPreviewData,
  dayKey,
  demandLabels,
  monday,
  monthDays,
  publicationLabels,
  type PreviewDemand,
  type PreviewPublication,
  type PreviewSpace,
  type PreviewTab,
  type PreviewData,
  type PreviewDestination,
} from "./model";
import ChannelsPreview from "./ChannelsPreview";
import { DestinationIcon, NavigationIcon, WorkspaceIcon } from "./PreviewIcons";
import "./preview.css";

const tabs: Array<[PreviewTab, string]> = [
  ["overview", "全局总览"],
  ["demands", "需求池"],
  ["calendar", "发布日历"],
  ["channels", "发布渠道"],
  ["assistant", "中心助手"],
];
const shortDate = (date: string) => date.slice(5).replace("-", "/");
const Icon = ({
  kind,
}: {
  kind: "arrow" | "plus" | "close" | "send" | "search" | "calendar";
}) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {kind === "arrow" ? (
      <path d="m9 5 7 7-7 7" />
    ) : kind === "plus" ? (
      <path d="M12 5v14M5 12h14" />
    ) : kind === "close" ? (
      <path d="m6 6 12 12M6 18 18 6" />
    ) : kind === "send" ? (
      <path d="m12 20 0-16m-6 6 6-6 6 6" />
    ) : kind === "search" ? (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ) : (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 11h18" />
      </>
    )}
  </svg>
);

function Drawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement as HTMLElement | null;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      dialog.close?.();
      focused?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="center-preview-drawer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div>
        <header>
          <span>{title}</span>
          <button onClick={onClose} aria-label={tr("关闭详情")}>
            <Icon kind="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function TaskDetail({
  task,
  space,
  onClose,
  onUpdate,
  onClaim,
  liveMode=false,
}: {
  liveMode?: boolean;
  task: PreviewDemand;
  space: PreviewSpace;
  onClose: () => void;
  onUpdate: (task: PreviewDemand) => void;
  onClaim: () => void;
}) {
  const [priority, setPriority] = useState(task.priority),
    [due, setDue] = useState(task.due);
  const editable = task.state === "queued";
  return (
    <Drawer title={tr(liveMode?"任务详情":"任务详情 · 示例")} onClose={onClose}>
      <div className="cp-detail-body">
        <div className="cp-eyebrow">
          {space.name} / {task.section}
        </div>
        <h2>{task.title}</h2>
        <div className="cp-detail-meta">
          <span className={"cp-state cp-" + task.state}>
            {tr(demandLabels[task.state])}
          </span>
          <span>{tr(task.kind)}</span>
          <span>{task.languages.join(" / ")}</span>
        </div>
        <dl className="cp-facts">
          <dt>{tr("执行设备")}</dt>
          <dd>{task.owner || "等待设备认领"}</dd>
          <dt>{tr("任务编号")}</dt>
          <dd>{task.id}</dd>
          <dt>{tr("计划交稿")}</dt>
          <dd>{task.due}</dd>
        </dl>
        <section>
          <h3>{tr("写作角度")}</h3>
          <p>{task.angle}</p>
        </section>
        <section>
          <h3>{tr("初始提纲")}</h3>
          <ol>
            {task.outline.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>
        <section>
          <h3>{tr("交付要求")}</h3>
          <p>{task.requirements}</p>
        </section>
        <section>
          <h3>{tr("参考线索")}</h3>
          <ul>
            {task.sources.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (editable) onUpdate({ ...task, priority, due });
          }}
          className="cp-detail-form"
        >
          <h3>{tr("调整任务")}</h3>
          {!editable && (
            <p className="cp-muted">
              {tr("已进入执行的任务保持原要求。本页仍可查看认领时的任务说明。")}
            </p>
          )}
          <div>
            <label>
              {tr("优先级")}
              <select
                disabled={!editable}
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as PreviewDemand["priority"])
                }
              >
                <option value="常规">{tr("常规")}</option>
                <option value="优先">{tr("优先")}</option>
              </select>
            </label>
            <label>
              {tr("计划交稿")}
              <input
                type="date"
                required
                disabled={!editable}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          </div>
          <footer>
            <button type="button" disabled={!editable} onClick={onClaim}>
              {tr(liveMode?"本机认领并执行":"模拟认领")}
            </button>
            <button className="cp-primary" disabled={!editable}>
              {tr(liveMode?"保存到中心":"应用到预览")}
            </button>
          </footer>
        </form>
      </div>
    </Drawer>
  );
}

function PublicationDetail({
  item,
  liveMode=false,
  space,
  onClose,
  onUpdate,
}: {
  liveMode?: boolean;
  item: PreviewPublication;
  space: PreviewSpace;
  onClose: () => void;
  onUpdate: (item: PreviewPublication) => void;
}) {
  const [date, setDate] = useState(item.date),
    [time, setTime] = useState(item.time);
  const editable = item.state === "scheduled" || item.state === "planned";
  return (
    <Drawer title={tr(liveMode?"发布详情":"发布详情 · 示例")} onClose={onClose}>
      <div className="cp-detail-body">
        <div className="cp-eyebrow">
          {space.name} / {item.locale}
        </div>
        <h2>{item.title}</h2>
        <span className={"cp-state cp-" + item.state}>
          {tr(publicationLabels[item.state])}
        </span>
        <dl className="cp-facts">
          <dt>{tr("发布目的地")}</dt>
          <dd>{item.destination}</dd>
          <dt>{tr("作品身份")}</dt>
          <dd>{item.workId}</dd>
          <dt>{tr("计划发布时间")}</dt>
          <dd>
            {item.date} {item.time}
          </dd>
        </dl>
        <p className="cp-muted">
          {liveMode?tr("状态来自中心。请在原发布入口查看完整回执与调整排期。"):item.state === "planned"
            ? tr("这是一项待生产计划，尚未具备可发布成品。")
            : item.state === "blocked"
              ? tr("示例异常：目的地暂不可用，原发布身份保持不变。")
              : item.state === "published"
                ? tr("此处展示已发布记录的详情样式，数据为示例。")
                : tr("成品已准备好，等待计划时间。此状态为界面示例。")}
        </p>
        <form
          className="cp-detail-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (editable || liveMode) onUpdate({ ...item, date, time });
          }}
        >
          <h3>{tr("调整排期")}</h3>
          <div>
            <label>
              {tr("日期")}
              <input
                type="date"
                value={date}
                required
                disabled={!editable || liveMode}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              {tr("时间")}
              <input
                type="time"
                value={time}
                required
                disabled={!editable || liveMode}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          </div>
          <footer>
            <button className="cp-primary" disabled={!editable && !liveMode}>
              {tr(liveMode?"在中心处理原发布":"应用到预览")}
            </button>
          </footer>
        </form>
      </div>
    </Drawer>
  );
}

export interface LiveCenterActions {
  data: PreviewData;
  loading: boolean;
  error: string;
  refresh: () => void;
  updateDemand: (task: PreviewDemand) => Promise<void>;
  claim: (task: PreviewDemand) => Promise<void>;
  manage: (tab: string, workspaceId?: string) => void;
  assistant: ReactNode;
  calendarRange: (from:string,to:string)=>void;
}
export default function CenterPreview({ onExit, live }: { onExit?: () => void; live?: LiveCenterActions }) {
  const [data, setData] = useState(() => live?.data || createPreviewData()),
    [tab, setTab] = useState<PreviewTab>("overview");
  const [scope, setScope] = useState<string[]>(() =>
    (live?.data || createPreviewData()).spaces.map((s) => s.id),
  );
  const [search, setSearch] = useState(""),
    [state, setState] = useState("all"),
    [notice, setNotice] = useState("");
  const [selectedTask, setSelectedTask] = useState<string | null>(null),
    [selectedPublication, setSelectedPublication] = useState<string | null>(
      null,
    ),
    [targetSpace, setTargetSpace] = useState<string | null>(null);
  const [date, setDate] = useState(data.weekStart),
    [calendarView, setCalendarView] = useState<"week" | "month" | "list">(
      "week",
    ),
    [destination, setDestination] = useState("all");
  const [agent, setAgent] = useState("Codex"),
    [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<
    Array<{ id: number; text: string; scope: string; agent: string }>
  >([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDetailsElement>(null);
  const [selectedDestination, setSelectedDestination] =
    useState<PreviewDestination | null>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (scopeRef.current && !scopeRef.current.contains(event.target as Node))
        scopeRef.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && scopeRef.current)
        scopeRef.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    const messages = messagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [conversation]);
  const liveLoaded=useRef(false);
  useEffect(()=>{if(!live)return;setData(live.data);setScope(old=>{const ids=live.data.spaces.map(s=>s.id);if(!liveLoaded.current&&ids.length){liveLoaded.current=true;return ids;}return old.filter(id=>ids.includes(id));});},[live?.data]);
  useEffect(()=>{if(live&&targetSpace){live.manage('goals',targetSpace);setTargetSpace(null);}},[targetSpace,live]);
  const scopeName =
    scope.length === data.spaces.length
      ? tr("全部工作空间")
      : scope.length === 1
        ? data.spaces.find((s) => s.id === scope[0])?.name || tr("工作空间")
        : scope.length
          ? tr("{{count}} 个工作空间", { count: scope.length })
          : tr("未选择工作空间");
  const spaces = data.spaces.filter((s) => scope.includes(s.id));
  const spaceById = Object.fromEntries(data.spaces.map((s) => [s.id, s]));
  const demands = data.demands.filter((d) => scope.includes(d.workspaceId));
  const demandCount=(state:string)=>data.demandCounts?data.demandCounts.filter(r=>scope.includes(r.workspaceId)&&(state==='all'?r.state!=='cancelled':r.state===state)).reduce((n,r)=>n+r.count,0):demands.filter(d=>state==='all'||d.state===state).length;
  const publications = data.publications.filter((p) =>
    scope.includes(p.workspaceId),
  );
  const filteredDemands = demands.filter(
    (d) =>
      (state === "all" || d.state === state) &&
      [d.title, d.section, spaceById[d.workspaceId].name]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const days = useMemo(
    () =>
      calendarView === "month"
        ? monthDays(date)
        : Array.from({ length: 7 }, (_, i) => addDays(date, i)),
    [calendarView, date],
  );
  useEffect(()=>{if(live)live.calendarRange(days[0],addDays(days[days.length-1],1));},[days]);
  const calendarItems = publications
    .filter(
      (p) =>
        days.includes(p.date) &&
        (destination === "all" ||
          p.destination === destination ||
          data.destinations.some(
            (d) => d.name === p.destination && d.kind === destination,
          )),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const task = data.demands.find((d) => d.id === selectedTask),
    publication = data.publications.find((p) => p.id === selectedPublication);
  const total = spaces.reduce((n, s) => n + s.target, 0),
    completed = spaces.reduce((n, s) => n + s.completed, 0);
  const changeTab = (value: PreviewTab) => {
    setTab(value);
    setNotice("");
    setSearch("");
    setState("all");
  };
  const taskView = (value: string) => {
    changeTab("demands");
    setState(value);
  };
  const moveCalendar = (direction: number) => {
    if (calendarView === "month") {
      const next = new Date(date + "T12:00:00");
      next.setDate(1);
      next.setMonth(next.getMonth() + direction);
      setDate(dayKey(next));
    } else setDate(addDays(date, direction * 7));
  };
  const reset = () => {
    if(live){live.refresh();return;}
    setData(createPreviewData());
    setScope(createPreviewData().spaces.map((s) => s.id));
    setConversation([]);
    setMessage("");
    setDate(data.weekStart);
    setDestination("all");
    setState("all");
    setSearch("");
    setNotice(tr("示例数据已重置。"));
  };
  return (
    <main className="center-preview">
      <div className="cp-preview-bar">
        <span>
          <b>{tr(live?"线上中心":"界面预览")}</b>
          {tr(live?"真实数据 · 操作由中心校验":"示例数据 · 操作仅在本页生效")}
        </span>
        <div>
          <button disabled={live?.loading} onClick={reset}>{tr(live?"刷新":"重置预览")}</button>
          {onExit && (
            <button onClick={onExit}>
              {tr("返回当前中心")}
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </div>
      {live?.error&&<p role="alert" className="cp-notice">{live.error}</p>}
      {live?.loading&&<p role="status" className="cp-notice">{tr("正在读取中心…")}</p>}
      <header className="cp-header">
        <div>
          <div className="cp-eyebrow">{tr("RSSD / 工作中心")}</div>
          <h1>{tr("内容调度")}</h1>
          <p>{tr("目标、生产与发布，在同一个视图中查看。")}</p>
        </div>
        <div className="cp-header-actions">
          <details ref={scopeRef} className="cp-scope">
            <summary>
              {scopeName}
              <span aria-hidden="true">⌄</span>
            </summary>
            <div className="cp-scope-menu">
              <header>
                <strong>{tr("查看范围")}</strong>
                <button onClick={() => setScope(data.spaces.map((s) => s.id))}>
                  {tr("全选")}
                </button>
                <button onClick={() => setScope([])}>{tr("清除")}</button>
              </header>
              {data.spaces.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={scope.includes(s.id)}
                    onChange={(e) =>
                      setScope((old) =>
                        e.target.checked
                          ? [...old, s.id]
                          : old.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <WorkspaceIcon workspaceId={s.id} size={22} />
                  {s.name}
                </label>
              ))}
            </div>
          </details>
          <button className="cp-primary" onClick={() => changeTab("assistant")}>
            <NavigationIcon tab="assistant" />
            {tr("向助手下指令")}
          </button>
        </div>
      </header>
      <nav className="cp-tabs" aria-label={tr("新版中心功能")}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => changeTab(id)}
          >
            <NavigationIcon tab={id} />
            {tr(label)}
            {id === "demands" && (
              <span>{demandCount("queued")}</span>
            )}
          </button>
        ))}
        <span className="cp-tab-context">{scopeName}</span>
      </nav>
      {notice && (
        <p className="cp-notice" role="status">
          {notice}
          <button aria-label={tr("关闭提示")} onClick={() => setNotice("")}>
            <Icon kind="close" />
          </button>
        </p>
      )}
      <div className="cp-content" key={tab}>
        {tab === "overview" && (
          <>
            <div className="cp-section-heading">
              <div>
                <h2>{tr("生产概览")}</h2>
                <p>{tr("演示周期 · 2026 年 11 月 2 日—8 日")}</p>
              </div>
              <button onClick={() => changeTab("calendar")}>
                {tr("查看发布日历")}
                <Icon kind="arrow" />
              </button>
            </div>
            <div className="cp-metrics">
              <div>
                <span>{tr("本周期交稿 / 目标")}</span>
                <strong>
                  {completed}
                  <small> / {total}</small>
                </strong>
                <p>{tr("按作品计数，分发次数单独记录")}</p>
              </div>
              <button onClick={() => taskView("queued")}>
                <span>{tr("待领取")}</span>
                <strong>
                  {demandCount("queued")}
                </strong>
                <p>{tr("已准备任务说明")}</p>
              </button>
              <button onClick={() => taskView("claimed")}>
                <span>{tr("生产中")}</span>
                <strong>
                  {demandCount("claimed")}
                </strong>
                <p>{tr("由已认领设备继续执行")}</p>
              </button>
              <button onClick={() => taskView("blocked")}>
                <span>{tr("需要处理")}</span>
                <strong>
                  {demandCount("blocked")}
                </strong>
                <p>{tr("保留任务与已有结果")}</p>
              </button>
            </div>
            <div className="cp-overview-columns">
              <section>
                <div className="cp-section-heading">
                  <h2>{tr("各工作空间")}</h2>
                  <span className="cp-muted">
                    {spaces.length}
                    {tr("个空间 · 交稿进度")}
                  </span>
                </div>
                <div className="cp-table-wrap">
                  <table className="cp-space-table">
                    <thead>
                      <tr>
                        <th>{tr("工作空间")}</th>
                        <th>{tr("本周期目标")}</th>
                        <th>{tr("完成进度")}</th>
                        <th>{tr("待领取")}</th>
                        <th>
                          <span className="cp-sr-only">{tr("操作")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {spaces.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <button
                              className="cp-space-name"
                              onClick={() => {
                                setScope([s.id]);
                                taskView("all");
                              }}
                            >
                              <WorkspaceIcon workspaceId={s.id} />
                              <span>
                                {s.name}
                                <small>{s.sections.join(" · ")}</small>
                              </span>
                            </button>
                          </td>
                          <td>
                            {s.target}
                            {tr("篇")}
                          </td>
                          <td>
                            <div className="cp-progress">
                              <progress
                                value={s.completed}
                                max={Math.max(1, s.target)}
                              />
                              <span>
                                {s.completed} / {s.target}
                              </span>
                            </div>
                          </td>
                          <td>
                            {
                              demands.filter(
                                (d) =>
                                  d.workspaceId === s.id &&
                                  d.state === "queued",
                              ).length
                            }
                          </td>
                          <td>
                            <button
                              className="cp-text-button"
                              onClick={() => setTargetSpace(s.id)}
                            >
                              {tr("调整目标")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!spaces.length && (
                    <Empty
                      title={tr("请选择工作空间")}
                      text={tr("从右上角选择一个或多个工作空间。")}
                    />
                  )}
                </div>
              </section>
              <aside className="cp-overview-aside">
                <div className="cp-section-heading">
                  <h2>{tr("优先关注")}</h2>
                  <span className="cp-dot" />
                </div>
                {demands
                  .filter(
                    (d) =>
                      d.state === "blocked" ||
                      (d.priority === "优先" && d.state === "queued"),
                  )
                  .slice(0, 3)
                  .map((d) => (
                    <button
                      className="cp-attention"
                      key={d.id}
                      onClick={() => setSelectedTask(d.id)}
                    >
                      <span className={"cp-state cp-" + d.state}>
                        {tr(demandLabels[d.state])}
                      </span>
                      <strong>{d.title}</strong>
                      <small>
                        {spaceById[d.workspaceId].name} · {d.section}
                      </small>
                      <span>
                        {d.state === "blocked"
                          ? tr("查看原因与保留结果")
                          : tr("查看写作角度与任务说明")}{" "}
                        <span aria-hidden="true">↗</span>
                      </span>
                    </button>
                  ))}
                {!demands.some(
                  (d) =>
                    d.state === "blocked" ||
                    (d.priority === "优先" && d.state === "queued"),
                ) && (
                  <p className="cp-muted">
                    {tr("当前范围没有需要优先关注的任务。")}
                  </p>
                )}
                <div className="cp-aside-note">
                  <span>{tr("线上管理助手")}</span>
                  <strong>{tr("按目标维护需求池")}</strong>
                  <p>
                    {tr(
                      "这里预留最近巡检、调整理由与运行状态。实际服务由中心接入。",
                    )}
                  </p>
                  <button onClick={() => changeTab("assistant")}>
                    {tr("查看助手界面")}
                    <Icon kind="arrow" />
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
        {tab === "demands" && (
          <>
            <div className="cp-section-heading">
              <div>
                <h2>{tr("需求池")}</h2>
                <p>{tr("每条需求包含初始写法，认领后按原要求执行。")}</p>
              </div>
              <button
                className="cp-primary"
                onClick={() => {
                  changeTab("assistant");
                  setMessage(tr("根据当前目标，检查需求缺口并准备新的选题。"));
                }}
              >
                {tr("让助手补充选题")}
                <Icon kind="plus" />
              </button>
            </div>
            <div className="cp-filter-row">
              <div
                className="cp-state-filters"
                aria-label={tr("按任务状态筛选")}
              >
                {[["all", "全部"], ...Object.entries(demandLabels)].map(
                  ([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={state === id}
                      onClick={() => setState(id)}
                    >
                      {tr(label)}
                      <span>
                        {id === "all"
                          ? demandCount("all")
                          : demandCount(id)}
                      </span>
                    </button>
                  ),
                )}
              </div>
              <label className="cp-search">
                <Icon kind="search" />
                <input
                  aria-label={tr("搜索需求")}
                  type="search"
                  placeholder={tr("搜索选题、栏目…")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            <div className="cp-table-wrap">
              <table className="cp-demands-table">
                <thead>
                  <tr>
                    <th>{tr("选题与栏目")}</th>
                    <th>{tr("任务")}</th>
                    <th>{tr("状态")}</th>
                    <th>{tr("计划交稿")}</th>
                    <th>{tr("执行设备")}</th>
                    <th>{tr("优先级")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDemands.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <button
                          className="cp-task-title"
                          onClick={() => setSelectedTask(d.id)}
                        >
                          {d.title}
                        </button>
                        <small>
                          {spaceById[d.workspaceId].name} / {d.section} ·{" "}
                          {d.languages.join(" / ")}
                        </small>
                      </td>
                      <td>{tr(d.kind)}</td>
                      <td>
                        <span className={"cp-state cp-" + d.state}>
                          {tr(demandLabels[d.state])}
                        </span>
                      </td>
                      <td>
                        <time dateTime={d.due}>{shortDate(d.due)}</time>
                      </td>
                      <td>
                        {d.owner || (
                          <span className="cp-muted">{tr("等待认领")}</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={d.priority === "优先" ? "cp-priority" : ""}
                        >
                          {tr(d.priority)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredDemands.length && (
                <Empty
                  title={tr("没有匹配的需求")}
                  text={tr("试试其他工作空间、状态或搜索词。")}
                />
              )}
            </div>
          </>
        )}
        {tab === "calendar" && (
          <>
            <div className="cp-section-heading">
              <div>
                <h2>{tr("发布日历")}</h2>
                <p>
                  {tr("自家站点与外部渠道统一查看，每次发布关联同一件作品。")}
                </p>
              </div>
              <label className="cp-destination">
                {tr("目的地")}
                <select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="all">{tr("全部目的地")}</option>
                  <option value="owned">{tr("自家站点")}</option>
                  <option value="external">{tr("外部平台")}</option>
                  {[
                    ...new Set(data.publications.map((p) => p.destination)),
                  ].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="cp-calendar-toolbar">
              <div className="cp-calendar-date">
                <button
                  aria-label={tr("上一时段")}
                  onClick={() => moveCalendar(-1)}
                >
                  ‹
                </button>
                <strong>
                  {calendarView === "month"
                    ? `${date.slice(0, 4)} / ${Number(date.slice(5, 7))}`
                    : `${shortDate(days[0])} — ${shortDate(days[6])}`}
                </strong>
                <button
                  aria-label={tr("下一时段")}
                  onClick={() => moveCalendar(1)}
                >
                  ›
                </button>
                <button onClick={() => setDate(data.weekStart)}>
                  {tr("演示周")}
                </button>
              </div>
              <div className="cp-view-switch" aria-label={tr("日历视图")}>
                {[
                  ["week", "周"],
                  ["month", "月"],
                  ["list", "列表"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={calendarView === id}
                    onClick={() => {
                      setCalendarView(id as typeof calendarView);
                      if (id !== "month") setDate(monday(date));
                    }}
                  >
                    {tr(label)}
                  </button>
                ))}
              </div>
            </div>
            {calendarView === "list" ? (
              <div className="cp-calendar-list">
                {calendarItems.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPublication(p.id)}
                  >
                    <time>
                      {shortDate(p.date)}
                      <b>{p.time}</b>
                    </time>
                    <span>
                      <strong>{p.title}</strong>
                      <small className="cp-destination-label">
                        <DestinationIcon
                          name={p.destination}
                          workspaceId={p.workspaceId}
                          size={20}
                        />
                        {p.destination} · {p.locale}
                      </small>
                    </span>
                    <span className={"cp-state cp-" + p.state}>
                      {tr(publicationLabels[p.state])}
                    </span>
                  </button>
                ))}
                {!calendarItems.length && (
                  <Empty
                    title={tr("当前时段没有发布安排")}
                    text={tr("可切换日期、目的地或工作空间。")}
                  />
                )}
              </div>
            ) : (
              <div className="cp-calendar-scroll">
                <div className={"cp-calendar cp-calendar-" + calendarView}>
                  <div className="cp-weekdays">
                    {[
                      "周一",
                      "周二",
                      "周三",
                      "周四",
                      "周五",
                      "周六",
                      "周日",
                    ].map((day) => (
                      <span key={day}>{tr(day)}</span>
                    ))}
                  </div>
                  <div className="cp-calendar-grid">
                    {days.map((day) => (
                      <section
                        key={day}
                        className={
                          day.slice(0, 7) !== date.slice(0, 7)
                            ? "cp-outside-month"
                            : ""
                        }
                        aria-label={day}
                      >
                        <header>
                          <time dateTime={day}>{Number(day.slice(8))}</time>
                          <span>
                            {calendarItems.filter((p) => p.date === day)
                              .length || ""}
                          </span>
                        </header>
                        {calendarItems
                          .filter((p) => p.date === day)
                          .map((p) => (
                            <button
                              className={"cp-event cp-event-" + p.state}
                              key={p.id}
                              onClick={() => setSelectedPublication(p.id)}
                            >
                              <span>
                                <time>{p.time}</time>
                                <small>{tr(publicationLabels[p.state])}</small>
                              </span>
                              <strong>{p.title}</strong>
                              <small className="cp-destination-label">
                                <DestinationIcon
                                  name={p.destination}
                                  workspaceId={p.workspaceId}
                                  size={20}
                                />
                                {p.destination}
                              </small>
                              <em>{p.locale}</em>
                            </button>
                          ))}
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="cp-calendar-legend">
              <span>
                <i className="planned" />
                {tr("待生产")}
              </span>
              <span>
                <i />
                {tr("已排期")}
              </span>
              <span>
                <i className="published" />
                {tr("已发布")}
              </span>
              <span>
                <i className="blocked" />
                {tr("待处理")}
              </span>
              <small>{tr("展示时区：Asia/Shanghai · 数据为示例")}</small>
            </div>
          </>
        )}
        {tab === "channels" && (
          <ChannelsPreview
            liveMode={Boolean(live)}
            spaces={spaces}
            destinations={data.destinations}
            publications={publications}
            onManage={setSelectedDestination}
            onCalendar={(name) => {
              changeTab("calendar");
              setDestination(name);
              setDate(data.weekStart);
            }}
          />
        )}
        {tab === "assistant" && live?.assistant}
        {tab === "assistant" && !live && (
          <div className="cp-assistant">
            <section className="cp-conversation">
              <div className="cp-section-heading">
                <div>
                  <h2>{tr("中心助手")}</h2>
                  <p>{tr("用本机智能体查看和调整同一个线上中心。")}</p>
                </div>
                <span className="cp-state">{tr("交互预览")}</span>
              </div>
              <div ref={messagesRef} className="cp-messages" aria-live="polite">
                {conversation.length === 0 ? (
                  <div className="cp-assistant-welcome">
                    <div className="cp-assistant-mark">
                      <NavigationIcon tab="assistant" />
                    </div>
                    <h3>{tr("从目标开始安排生产")}</h3>
                    <p>
                      {tr("可以查看各站进度、调整选题方向，或检查下一次发布。")}
                    </p>
                    <div className="cp-suggestions">
                      {[
                        "看看各栏目这周还缺多少内容",
                        "研究方法站优先安排两篇统计方法",
                        "检查明天自家站点和外部渠道的排期",
                      ].map((text) => (
                        <button key={text} onClick={() => setMessage(tr(text))}>
                          {tr(text)}
                          <Icon kind="arrow" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  conversation.map((item) => (
                    <div className="cp-conversation-turn" key={item.id}>
                      <div className="cp-user-message">
                        <small>
                          {tr("你 · {{scope}}", { scope: item.scope })}
                        </small>
                        <p>{item.text}</p>
                      </div>
                      <div className="cp-agent-message">
                        <small>
                          {tr("{{agent}} · 示例回复", { agent: item.agent })}
                        </small>
                        <p>
                          {tr(
                            "这条指令已显示在预览中。正式接通后，会在这里展示查询范围、工具调用和中心返回的结果。",
                          )}
                        </p>
                        <details>
                          <summary>{tr("查看执行过程的展示样例")}</summary>
                          <ol>
                            <li>{tr("读取当前目标与已有作品")}</li>
                            <li>
                              {tr("核对尚未领取、正在执行和已经完成的任务")}
                            </li>
                            <li>{tr("通过中心接口提交调整，展示实际回执")}</li>
                          </ol>
                          <p>
                            {tr(
                              "以上仅为展示样例，本次没有调用工具或修改中心。",
                            )}
                          </p>
                        </details>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <form
                className="cp-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!message.trim() || !scope.length) return;
                  setConversation((old) => [
                    ...old,
                    {
                      id: old.length + 1,
                      text: message.trim(),
                      scope: scopeName,
                      agent,
                    },
                  ]);
                  setMessage("");
                }}
              >
                <label className="cp-sr-only" htmlFor="cp-instruction">
                  {tr("给中心助手的指令")}
                </label>
                <textarea
                  id="cp-instruction"
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={tr("告诉助手，你想怎样调整内容生产…")}
                />
                <div>
                  <label>
                    {tr("本机智能体")}
                    <select
                      aria-label={tr("预览智能体")}
                      value={agent}
                      onChange={(e) => setAgent(e.target.value)}
                    >
                      <option>Codex</option>
                      <option>Cursor</option>
                    </select>
                  </label>
                  <span>{scopeName}</span>
                  <button
                    className="cp-primary"
                    disabled={!message.trim() || !scope.length}
                  >
                    {tr("预览发送")}
                    <Icon kind="send" />
                  </button>
                </div>
              </form>
              <p className="cp-composer-note">
                {tr("当前只预览对话流程，尚未连接智能体或发送到中心。")}
              </p>
            </section>
            <aside className="cp-assistant-context">
              <h3>{tr("当前上下文")}</h3>
              <dl>
                <dt>{tr("工作范围")}</dt>
                <dd>{scopeName}</dd>
                <dt>{tr("管理对象")}</dt>
                <dd>{tr("目标、需求池、发布安排")}</dd>
                <dt>{tr("中心连接")}</dt>
                <dd>{tr("示例连接")}</dd>
                <dt>{tr("执行位置")}</dt>
                <dd>{tr("本机智能体")}</dd>
              </dl>
              <section>
                <h3>{tr("线上常驻助手")}</h3>
                <p>
                  {tr(
                    "持续维护目标与需求池。桌面发出的调整在中心保存后，线上助手沿用同一份安排。",
                  )}
                </p>
                <span className="cp-muted">{tr("运行状态等待中心接入")}</span>
              </section>
              <section>
                <h3>{tr("操作结果")}</h3>
                <p>
                  {tr(
                    "每次调整保留原因与结果，任务认领和发布状态以中心回执为准。",
                  )}
                </p>
              </section>
            </aside>
          </div>
        )}
      </div>
      {task && (
        <TaskDetail
          key={task.id}
          task={task}
          liveMode={Boolean(live)}
          space={spaceById[task.workspaceId]}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => {
            if(live){void live.updateDemand(updated).then(()=>{setSelectedTask(null);setNotice(tr("需求已保存到中心。"));}).catch(e=>setNotice(String(e)));return;}
            setData((old) => ({
              ...old,
              demands: old.demands.map((d) =>
                d.id === updated.id ? updated : d,
              ),
            }));
            setSelectedTask(null);
            setNotice(tr("任务调整已应用到预览，未提交中心。"));
          }}
          onClaim={() => {
            if(live){void live.claim(task).then(()=>{setSelectedTask(null);setNotice(tr("已请求本机执行，请查看实际认领状态。"));}).catch(e=>setNotice(String(e)));return;}
            setData((old) => ({
              ...old,
              demands: old.demands.map((d) =>
                d.id === task.id
                  ? { ...d, state: "claimed", owner: tr("本机 · 模拟认领") }
                  : d,
              ),
            }));
            setSelectedTask(null);
            setNotice(tr("已模拟认领，仅用于查看界面状态，未启动生产。"));
          }}
        />
      )}
      {publication && (
        <PublicationDetail
          key={publication.id}
          item={publication}
          liveMode={Boolean(live)}
          space={spaceById[publication.workspaceId]}
          onClose={() => setSelectedPublication(null)}
          onUpdate={(updated) => {
            if(live){live.manage("calendar",updated.workspaceId);return;}
            setData((old) => ({
              ...old,
              publications: old.publications.map((p) =>
                p.id === updated.id ? updated : p,
              ),
            }));
            setSelectedPublication(null);
            setNotice(tr("排期已应用到预览，未提交中心。"));
          }}
        />
      )}
      {selectedDestination && (
        <Drawer
          title={tr(live?"渠道详情":"渠道详情 · 示例")}
          onClose={() => setSelectedDestination(null)}
        >
          <div className="cp-detail-body">
            <div className="cp-eyebrow">{selectedDestination.platform}</div>
            <h2>{selectedDestination.name}</h2>
            <dl className="cp-facts">
              <dt>{tr("账号或站点")}</dt>
              <dd>{selectedDestination.account}</dd>
              <dt>{tr("连接方式")}</dt>
              <dd>{selectedDestination.auth}</dd>
              <dt>{tr("内容来源")}</dt>
              <dd>
                {selectedDestination.workspaceIds
                  .map((id) => spaceById[id].name)
                  .join("、")}
              </dd>
            </dl>
            <p>
              {tr(
                "正式使用时，在浏览器中的 RSSD 中心完成账号授权、重新连接和渠道配置。桌面展示同一份渠道状态与发布结果。",
              )}
            </p>
            <p className="cp-muted">
              {tr(live?"连接状态来自中心。账号授权和配置在浏览器中管理。":"当前账号和状态均为示例。此预览没有读取或改变真实授权。")}
            </p>
            <footer>
              <button
                onClick={() => {
                  setSelectedDestination(null);
                  changeTab("calendar");
                  setDestination(selectedDestination.name);
                  setDate(data.weekStart);
                }}
              >
                {tr("查看发布安排")}
              </button>
            </footer>
          </div>
        </Drawer>
      )}
      {targetSpace && (
        <Drawer
          title={tr("生产目标 · 示例")}
          onClose={() => setTargetSpace(null)}
        >
          <form
            className="cp-detail-body cp-detail-form"
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget),
                target = Number(values.get("target"));
              if (!Number.isInteger(target) || target < 0 || target > 1000)
                return;
              setData((old) => ({
                ...old,
                spaces: old.spaces.map((s) =>
                  s.id === targetSpace ? { ...s, target } : s,
                ),
              }));
              setTargetSpace(null);
              setNotice(tr("目标已应用到预览，未创建或修改真实需求。"));
            }}
          >
            <div className="cp-eyebrow">{spaceById[targetSpace].name}</div>
            <h2>{tr("调整生产目标")}</h2>
            <p className="cp-muted">
              {tr("目标按作品交稿数量计算，中英文分发不重复计为多篇。")}
            </p>
            <label>
              {tr("演示周期")}
              <input readOnly value={tr("2026 年 11 月 2 日—8 日")} />
            </label>
            <label>
              {tr("计划交稿数量")}
              <input
                name="target"
                type="number"
                required
                min={0}
                max={1000}
                defaultValue={spaceById[targetSpace].target}
              />
            </label>
            <footer>
              <button className="cp-primary">{tr("应用到预览")}</button>
            </footer>
          </form>
        </Drawer>
      )}
    </main>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="cp-empty">
      <Icon kind="calendar" />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
