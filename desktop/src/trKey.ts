// Marks Chinese source text held in a constant or logic module so the
// ui-text coverage test can find it; screens render it through tr(). Kept
// dependency-free so pure modules can use it without loading i18n.
export const trKey = (source: string): string => source;
