import type { KeyboardEventHandler } from "react";
import Icon from "./Icon";
import "./reader-tabs.css";

/** The fixed first tab belongs to the workspace, never to its closeable pages. */
export default function WorkspaceHomeTab({ label, active, onSelect, panelId, id, onKeyDown }: {
  label: string;
  active: boolean;
  onSelect: () => void;
  panelId?: string;
  id?: string;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}) {
  return <div className={`reader-tab reader-home-tab${active ? " is-active" : ""}`}>
    <button type="button" role="tab" id={id} aria-label={label} title={label}
      aria-selected={active} aria-controls={panelId} tabIndex={active ? 0 : -1}
      onClick={onSelect} onKeyDown={onKeyDown}><Icon name="home" size={16}/></button>
  </div>;
}
