// Resolves an error thrown by a Tauri command into a localised message.
//
// The Rust `AppError` serialises to `{ code, detail }`: `code` selects an
// `error.<code>` translation key, `detail` carries inner text. Anything that
// is not a coded error falls back to its plain string form.

// Startup initializes this shared instance; formatting an error must not boot
// the native settings/tray bridge when used by an isolated workspace.
import i18n from "i18next";

interface CodedError {
  code: string;
  detail?: string | null;
}

function isCoded(e: unknown): e is CodedError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string"
  );
}

/** A user-facing, localised message for any caught error. */
export function errorText(e: unknown): string {
  if (isCoded(e)) {
    const detail = e.detail ?? "";
    const key = `error.${e.code}`;
    const msg = i18n.t(key, { detail });
    if (msg && msg !== key) return msg;
    return detail || i18n.t("error.unknown");
  }
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
