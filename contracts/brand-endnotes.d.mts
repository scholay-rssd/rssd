type BrandLike={id:string;name:string;slogan?:string;description?:string;endnotes:{id:string;label:string;text:string}[]};
export function brandEndnoteText(brand:BrandLike,preset:{text:string}):string;
export function refreshBrandIdentity<T extends BrandLike>(brand:T):T;
export function siteBrandLine(text:string,origin?:string):string|null;
