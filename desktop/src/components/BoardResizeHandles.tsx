import ResizeHandle from "./ResizeHandle";
import { BOARD_PANE_BOUNDS } from "../lib/boardPanes";
import type { useBoardPanes } from "../hooks/useBoardPanes";

import { tr } from "../uiText";
export default function BoardResizeHandles({ panes, hasList, label, visible = false }: {
  panes: ReturnType<typeof useBoardPanes>; hasList: boolean; label: string; visible?: boolean;
}) {
  return <>
    {panes.widths.sidebarWidth > 0 && <div className="resize-handle-slot board-resize-slot" data-pane="sidebar" style={{ left: panes.widths.sidebarWidth }}>
      <ResizeHandle visible={visible} width={panes.widths.sidebarWidth} side="right" min={BOARD_PANE_BOUNDS.sidebar.min}
        max={panes.sidebarMax} onResize={width => panes.resize("sidebar", width)} label={tr("调整{{label}}侧栏宽度", {label})}/>
    </div>}
    {hasList && <div className="resize-handle-slot board-resize-slot" style={{ left: panes.widths.sidebarWidth + panes.widths.listWidth }}>
      <ResizeHandle visible={visible} width={panes.widths.listWidth} side="right" min={BOARD_PANE_BOUNDS.list.min}
        max={panes.listMax} onResize={width => panes.resize("list", width)} label={tr("调整{{label}}列表宽度", {label})}/>
    </div>}
  </>;
}
