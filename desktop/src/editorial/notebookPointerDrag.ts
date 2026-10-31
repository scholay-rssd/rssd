import type {DropEdge} from './notebookReorder';

export type NotebookDrop = {id: string; edge: DropEdge};
export type NotebookDragState = {ids: string[]; drop: NotebookDrop | null; deleting?:boolean};
type Options = {
  event: PointerEvent;
  handle: HTMLElement;
  host: HTMLElement;
  units: string[][];
  id: string;
  selectedIds?:string[];
  onChange: (state: NotebookDragState | null) => void;
  onDrop: (drop: NotebookDrop) => void;
  onFinish: (dragged: boolean) => void;
  trash?:()=>HTMLElement|null;
  onDelete?:(ids:string[])=>void;
};

/** Pointer sorting avoids WebKit/ProseMirror's competing native text drags.
 * Only the handle starts it; text selection and inputs retain their behavior. */
export function startNotebookDrag({event, handle, host, units, id, selectedIds,onChange, onDrop, onFinish,trash,onDelete}: Options) {
  const doc = host.ownerDocument, win = doc.defaultView!;
  const ids = selectedIds||units.find(unit => unit.includes(id))!;
  let x = event.clientX, y = event.clientY, active = false, finished = false;
  let frame = 0, drop: NotebookDrop | null = null,deleting=false;
  const scroll = host.closest<HTMLElement>('.notebook-paper') || host;
  const samePointer = (e: PointerEvent) => e.pointerId === event.pointerId;
  const hit = (): NotebookDrop | null => {
    const bounds = scroll.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const rows = new Map([...host.querySelectorAll<HTMLElement>('[data-block-id]')].map(row => [row.dataset.blockId!, row]));
    const boxes = units.flatMap(unit => {
      const first = rows.get(unit[0]), last = rows.get(unit.at(-1)!);
      return first && last ? [{unit, top:first.getBoundingClientRect().top, bottom:last.getBoundingClientRect().bottom}] : [];
    });
    const box = boxes.find(box => y < box.bottom) || boxes.at(-1);
    if (!box || box.unit.some(id=>ids.includes(id))) return null;
    const edge = y < (box.top + box.bottom) / 2 ? 'before' : 'after';
    return {id: edge === 'before' ? box.unit[0] : box.unit.at(-1)!, edge};
  };
  const update = () => {
    const zone=trash?.()?.getBoundingClientRect(),remove=!!zone&&x>=zone.left&&x<=zone.right&&y>=zone.top&&y<=zone.bottom;
    const next = remove?null:hit();
    if (next?.id !== drop?.id || next?.edge !== drop?.edge||remove!==deleting) {
      drop = next;deleting=remove;
      onChange({ids, drop,...(deleting?{deleting:true}:{})});
    }
  };
  const tick = () => {
    if (finished || !active) return;
    if (!handle.isConnected || !host.isConnected) { finish(false); return; }
    const bounds = scroll.getBoundingClientRect();
    const edge = Math.min(48, bounds.height / 4);
    if (!deleting&&x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      const delta = y < bounds.top + edge ? -Math.ceil((bounds.top + edge - y) / 4)
        : y > bounds.bottom - edge ? Math.ceil((y - bounds.bottom + edge) / 4) : 0;
      if (delta) scroll.scrollTop += delta;
    }
    update();
    frame = win.requestAnimationFrame(tick);
  };
  const activate = () => {
    if (finished || active) return;
    active = true;
    for (const menu of host.querySelectorAll<HTMLDetailsElement>('details[data-transient-popover][open]')) menu.open = false;
    onChange({ids, drop});
    frame = win.requestAnimationFrame(tick);
    update();
  };
  const timer = win.setTimeout(activate, 300);
  const move = (e: PointerEvent) => {
    if (!samePointer(e)) return;
    if (e.buttons === 0) { finish(false); return; }
    x = e.clientX; y = e.clientY;
    if (!active && Math.hypot(x - event.clientX, y - event.clientY) >= 6) activate();
    if (active) { e.preventDefault(); update(); }
  };
  const up = (e: PointerEvent) => {
    if (!samePointer(e)) return;
    x = e.clientX; y = e.clientY;
    if (active) { e.preventDefault(); update(); }
    finish(true);
  };
  const cancel = (e: PointerEvent) => { if (samePointer(e)) finish(false); };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  };
  const blur = () => finish(false);
  function finish(commit: boolean) {
    if (finished) return;
    finished = true;
    win.clearTimeout(timer); win.cancelAnimationFrame(frame);
    doc.removeEventListener('pointermove', move, true);
    doc.removeEventListener('pointerup', up, true);
    doc.removeEventListener('pointercancel', cancel, true);
    handle.removeEventListener('lostpointercapture', cancel);
    win.removeEventListener('keydown', key, true);
    win.removeEventListener('blur', blur);
    try { if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch { /* Already released by WebKit. */ }
    onChange(null);
    onFinish(active);
    if(commit&&active&&deleting)onDelete?.(ids);
    else if (commit && active && drop) onDrop(drop);
  }
  doc.addEventListener('pointermove', move, {capture:true, passive:false});
  doc.addEventListener('pointerup', up, true);
  doc.addEventListener('pointercancel', cancel, true);
  handle.addEventListener('lostpointercapture', cancel);
  win.addEventListener('keydown', key, true);
  win.addEventListener('blur', blur);
  try { handle.setPointerCapture?.(event.pointerId); } catch { /* Synthetic tests have no active native pointer. */ }
  return () => finish(false);
}
