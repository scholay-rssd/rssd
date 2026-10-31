import {useEffect, useRef, useState, type PointerEvent, type MouseEvent, type RefObject} from 'react';
import type {Editor} from '@tiptap/core';
import {editNotes, readNotebook} from './notebookEditorModel';
import {notebookMoveUnits, reorderNotebook} from './notebookReorder';
import {startNotebookDrag, type NotebookDragState} from './notebookPointerDrag';
import {removeBlocks,selectedUnitIds} from './notebookBlockActions';

export function useNotebookDrag(editor: Editor | null, host: RefObject<HTMLDivElement | null>, disabled: boolean,trash?:RefObject<HTMLDivElement|null>,selected:string[]=[]) {
  const [state, setState] = useState<NotebookDragState | null>(null);
  const cancel = useRef<(() => void) | null>(null), suppressClick = useRef(0);
  useEffect(() => {
    if (disabled) cancel.current?.();
    // Autosave/AI updates may replace the row DOM. Never drop a stale order.
    const changed = ({transaction}: {transaction: {docChanged: boolean}}) => {
      if (transaction.docChanged) cancel.current?.();
    };
    editor?.on('transaction', changed);
    return () => { cancel.current?.(); editor?.off('transaction', changed); };
  }, [editor, disabled]);
  return {
    state,
    start(event: PointerEvent<HTMLElement>, id: string) {
      if (disabled || !editor?.isEditable || editor.view.composing || !host.current || event.button !== 0 || event.isPrimary === false) return;
      cancel.current?.();
      const note=readNotebook(editor.state.doc),ids=selectedUnitIds(note,selected.includes(id)?selected:[id]),picked=new Set(ids),allUnits=notebookMoveUnits(note);
      const units=allUnits.map(unit=>unit.map(b=>b.id));
      cancel.current = startNotebookDrag({event:event.nativeEvent, handle:event.currentTarget, host:host.current, id,
        units,selectedIds:ids,
        onChange:setState,
        trash:()=>trash?.current||null,
        onDelete:ids=>editNotes(editor,note=>removeBlocks(note,ids)),
        onDrop:drop => editNotes(editor, note => {
          if(ids.length===1)return reorderNotebook(note,id,drop.id,drop.edge);
          const moved=note.blocks.filter(b=>picked.has(b.id)),remaining=note.blocks.filter(b=>!picked.has(b.id)),target=remaining.findIndex(b=>b.id===drop.id);if(target<0)return note;
          const index=target+(drop.edge==='after'?1:0);return {...note,blocks:[...remaining.slice(0,index),...moved,...remaining.slice(index)]};
        }),
        onFinish:dragged => { cancel.current = null; if (dragged) suppressClick.current = Date.now() + 500; },
      });
    },
    click(event: MouseEvent<HTMLElement>) {
      if (Date.now() < suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = 0; }
    },
  };
}
