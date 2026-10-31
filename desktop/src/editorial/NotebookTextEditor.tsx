import {useEffect, useRef} from 'react';
import {EditorContent, useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

// The manuscript contract remains plain text per block. ProseMirror owns input,
// composition, selection, paste and undo; rendering never parses authored HTML.
const documentFor = (text: string) => ({type: 'doc', content: [{type: 'paragraph', content: text ? [{type: 'text', text}] : []}]});
type Props = {id: string; label: string; text: string; disabled: boolean; placeholder: string; onChange: (text: string) => void; onSplit: (before: string, after: string) => void; onSlash: () => void};
export default function NotebookTextEditor(p: Props) {
  const callbacks = useRef(p); callbacks.current = p;
  const incoming = useRef(p.text), emitted = useRef<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit.configure({heading:false, bold:false, italic:false, strike:false, code:false, codeBlock:false, blockquote:false, bulletList:false, orderedList:false, listItem:false, horizontalRule:false, link:false, underline:false, trailingNode:false, dropcursor:false, gapcursor:false, listKeymap:false})],
    content: documentFor(p.text), editable: !p.disabled, enableInputRules:false, enablePasteRules:false,
    editorProps: {
      attributes: {'class':'notebook-text-editor', 'role':'textbox', 'aria-label':p.label, 'aria-multiline':'true', 'data-row-id':p.id, 'data-placeholder':p.placeholder, 'spellcheck':'false'},
      handleKeyDown(view, event) {
        if(event.isComposing || view.composing || event.keyCode===229) return false;
        if(event.key==='/' && !view.state.doc.textContent) {event.preventDefault();callbacks.current.onSlash();return true;}
        if(event.key==='Enter' && !event.shiftKey) {
          event.preventDefault();const {from,to}=view.state.selection;
          callbacks.current.onSplit(view.state.doc.textBetween(0,from,'\n','\n'),view.state.doc.textBetween(to,view.state.doc.content.size,'\n','\n'));return true;
        }
        return false;
      },
      handlePaste(view,event) {const value=event.clipboardData?.getData('text/plain');if(value===undefined)return false;event.preventDefault();view.dispatch(view.state.tr.insertText(value));return true;},
      handleDrop: (_view,event) => !!event.dataTransfer?.files.length,
    },
    onUpdate({editor}) {const text=editor.getText({blockSeparator:'\n'});emitted.current=text;callbacks.current.onChange(text);},
  }, [p.id]);
  useEffect(()=>{
    if(!editor)return;
    if(editor.isEditable!==!p.disabled)editor.setEditable(!p.disabled,false);
    editor.setOptions({editorProps:{...editor.options.editorProps,attributes:{...editor.options.editorProps.attributes as object,'aria-label':p.label,'data-placeholder':p.placeholder}}});
    if(p.text!==incoming.current && p.text!==emitted.current)editor.commands.setContent(documentFor(p.text),{emitUpdate:false});
    incoming.current=p.text;
  },[editor,p.text,p.disabled,p.label,p.placeholder]);
  return <EditorContent editor={editor}/>;
}
