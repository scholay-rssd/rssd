import { version } from "../../package.json";

export const APP_NAME = "RSSD";
export const APP_SHORT_NAME = "RSSD";
export const BRAND_WORDMARK = "RSSD";
export const APP_VERSION = version;

/** Display branding only; persisted keys and native app identity stay stable. */
export default function Brand({ className = "", iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  return <div className={`app-brand ${className}`} aria-label={APP_NAME}>
    <span className="app-brand-logo" aria-hidden="true"/>
    {!iconOnly && <span className="app-brand-name">{BRAND_WORDMARK}</span>}
  </div>;
}
