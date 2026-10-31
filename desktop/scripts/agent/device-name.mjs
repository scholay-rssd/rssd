import {execFile} from 'node:child_process';
import {hostname} from 'node:os';

const clean=value=>typeof value==='string'&&value.trim()&&!/[\x00-\x1f\x7f]/.test(value.trim())?value.trim().slice(0,120):null;
let cached;
/** The producing computer's display name, recorded only in private model records. */
export function deviceName({env=process.env,platform=process.platform,run=execFile,host=hostname}={}){
 const override=clean(env.SCHOLAY_DEVICE_NAME);if(override)return Promise.resolve(override);
 if(platform!=='darwin')return Promise.resolve(clean(host()));
 return new Promise(done=>run('/usr/sbin/scutil',['--get','ComputerName'],{timeout:2000},(error,stdout)=>done(!error&&clean(String(stdout))||clean(host()))));
}
export const producerDevice=()=>cached??=deviceName().catch(()=>null);
