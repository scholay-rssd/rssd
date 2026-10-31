type Option={id:string;category?:string;type?:string;currentValue?:string;current_value?:string;options?:any[]};
export function getOptionCurrentValue(option?:Option|null):string|null;
export function findConfigOption(options:Option[]|null|undefined,category:string,fallbackIds?:string[]):Option|null;
export function deriveSelectOption(options:Option[]|null|undefined,category:string,fallbackIds?:string[]):{id:string;category:string;currentValue:string|null;options:{value:string;label:string;description?:string}[]}|null;
