// Source-text translation for the screens written Chinese-first. The Chinese
// string itself is the key: zh renders it unchanged, en / ja look it up in
// locales/ui.<lang>.json (ja falls back to en, then to the source). Keyed
// i18next text (t("section.key")) remains the pattern for the reader screens.
//
// tr() is a plain function so module helpers, callbacks and render code can
// share it. WorkspaceApp subscribes to language changes, which re-renders the
// whole tree; memo() components that call tr() subscribe themselves.
// The shared i18next instance that ./i18n initialises; importing it directly
// keeps pure modules and their tests free of the app's i18n side effects.
import i18n from "i18next";
import en from "./locales/ui.en.json";
import ja from "./locales/ui.ja.json";
export { trKey } from "./trKey";

type Table = Record<string, string>;
const TABLES: Record<string, Table[]> = { en: [en], ja: [ja, en] };

/** Translate Chinese source text. `{{name}}` placeholders are filled from
 *  `vars`; when `vars.count === 1` a `<source>_one` entry is preferred. */
export function tr(source: string, vars?: Record<string, unknown>): string {
  let text = source;
  const one = vars?.count === 1 ? source + "_one" : null;
  for (const table of TABLES[i18n.language] ?? []) {
    const hit = (one && table[one]) || table[source];
    if (hit) { text = hit; break; }
  }
  return vars ? text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

const LOCALES: Record<string, string> = { zh: "zh-CN", en: "en-US", ja: "ja-JP" };
/** BCP 47 locale for dates and numbers in the active interface language. */
export const uiLocale = (): string => LOCALES[i18n.language] ?? "zh-CN";

/** Translate a message produced by the native backend. Exact source strings
 *  translate directly; "<known prefix>：<detail>" keeps the detail verbatim.
 *  Anything else (data, file paths, third-party text) passes through. */
export function trNative(message: string): string {
  if (!/[㐀-鿿]/.test(message)) return message;
  const exact = tr(message);
  if (exact !== message) return exact;
  const colon = message.indexOf("：");
  if (colon > 0) {
    const key = message.slice(0, colon + 1) + "{{detail}}";
    const translated = tr(key, { detail: message.slice(colon + 1).trim() });
    if (!translated.startsWith(message.slice(0, colon + 1))) return translated;
  }
  return message;
}
