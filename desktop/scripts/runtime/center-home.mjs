import {join,resolve} from 'node:path';
import {homedir} from 'node:os';

export function centerHome(env=process.env){
  return resolve(env.RSSD_CENTER_HOME||join(env.SCHOLAY_GLOBAL_APP_DATA||env.SCHOLAY_AGENT_HOME||join(homedir(),'.config/scholay-today'),'center'));
}
