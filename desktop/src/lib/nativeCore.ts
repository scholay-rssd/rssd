// App-owned IPC boundary. Tauri's global transport is intentionally immutable;
// plugin internals continue using it directly, while our space-owned commands
// pass through this boundary for draining and stale-request protection.
import {invoke as tauriInvoke} from '@tauri-apps/api/core';
import {trNative} from '../uiText';
export * from '@tauri-apps/api/core';
export const nativeTransport={invoke:tauriInvoke};
// Backend errors are Chinese source text; show them in the interface language.
function localizeError(error:unknown):unknown{
 if(typeof error==='string')return trNative(error);
 if(error instanceof Error)error.message=trNative(error.message);
 return error;
}
export function invoke<T>(...args:Parameters<typeof tauriInvoke>):Promise<T>{
 return nativeTransport.invoke<T>(...args).catch(error=>{throw localizeError(error);});
}
