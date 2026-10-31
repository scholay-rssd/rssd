import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToasts } from "../toast";
import Icon from "./Icon";

/** Mounted outside workspace panels so a notice survives switching workspaces. */
export default function ToastViewport() {
  const { t } = useTranslation();
  const current = useToasts((state) => state.current);
  const dismiss = useToasts((state) => state.dismiss);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => dismiss(current.id), current.duration);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);

  return <div className="toast-viewport">
    {current && <div className={`toast${current.tone === "error" ? " toast-error" : ""}`} key={current.id} role={current.tone === "error" ? "alert" : "status"} aria-atomic="true">
      <span className="toast-ico" aria-hidden="true"><Icon name={current.tone === "error" ? "alert" : "check"} size={17}/></span>
      <span className="toast-text">{current.text}</span>
      {current.kbd && <kbd aria-hidden="true">{current.kbd}</kbd>}
      {current.action && <button className="toast-action" onClick={() => { current.action!.run(); dismiss(current.id); }}>{current.action.label}</button>}
      <button className="toast-dismiss" aria-label={t("common.close")} onClick={() => dismiss(current.id)}><Icon name="x" size={14}/></button>
    </div>}
  </div>;
}
