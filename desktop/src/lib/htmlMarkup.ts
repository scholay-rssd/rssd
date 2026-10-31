import { useMemo } from "react";

/** A stable `dangerouslySetInnerHTML` value for `html`.
 *
 *  React 19 compares this prop by object identity and reassigns `innerHTML`
 *  whenever it changes, even when the markup string is identical. An inline
 *  `{{ __html }}` is a new object on every render, so a parent re-rendered by
 *  a background poll rebuilt the whole body: images were torn down and decoded
 *  again (visible flicker), and scroll anchors, selections and injected
 *  highlights were dropped. Keep the object stable until the markup changes. */
export function useHtmlMarkup(html: string): { __html: string } {
  return useMemo(() => ({ __html: html }), [html]);
}
