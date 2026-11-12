// Retired site and space IDs and their replacements. Stored data that still
// carries a retired ID is migrated once; new data never uses it.
export const SITE_RENAMES=Object.freeze({lingxi:'xsime'});
export const renamedSiteId=id=>Object.hasOwn(SITE_RENAMES,id)?SITE_RENAMES[id]:id;
