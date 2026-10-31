import {readFile} from 'node:fs/promises';
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const moduleAsset=path=>readFile(new URL(path,import.meta.url));
