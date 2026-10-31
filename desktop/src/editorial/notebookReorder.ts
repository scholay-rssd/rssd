import type {NoteBlock, NoteGroup} from '../../scripts/agent/notebook.mjs';

type Notebook = {blocks: NoteBlock[]; groups: NoteGroup[]};
export type DropEdge = 'before' | 'after';

/** A section is one unit. A figure and its captions also travel together in
 * older notes that predate explicit groups. Preserve the original records. */
export function notebookMoveUnits({blocks}: Pick<Notebook, 'blocks'>): NoteBlock[][] {
  const units: NoteBlock[][] = [];
  for (const block of blocks) {
    const last = units.at(-1);
    if (last && block.groupId && last[0].groupId === block.groupId) last.push(block);
    else units.push([block]);
  }
  // Captions normally follow their image; joining the intervening units also
  // keeps legacy layouts intact when an imported caption is farther away.
  for (let index = 0; index < units.length; index++) {
    const linked = new Set(units[index].flatMap(b => [b.id, ...(b.targetId ? [b.targetId] : [])]));
    let end = index;
    for (let next = index + 1; next < units.length; next++) {
      if (units[next].some(b => linked.has(b.id) || !!b.targetId && linked.has(b.targetId))) end = next;
    }
    if (end > index) { units.splice(index, end - index + 1, units.slice(index, end + 1).flat()); index--; }
  }
  return units;
}

/** A no-op returns the same object so it never creates an undo entry. */
export function reorderNotebook<T extends Notebook>(note: T, id: string, target: string, edge: DropEdge): T {
  const units = notebookMoveUnits(note);
  const from = units.findIndex(unit => unit.some(b => b.id === id));
  const to = units.findIndex(unit => unit.some(b => b.id === target));
  if (from < 0 || to < 0 || from === to) return note;
  const insertion = to + (edge === 'after' ? 1 : 0) - (from < to ? 1 : 0);
  if (insertion === from) return note;
  units.splice(insertion, 0, ...units.splice(from, 1));
  return {...note, blocks: units.flat()};
}
