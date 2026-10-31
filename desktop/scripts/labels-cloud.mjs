import {readCloudLabels} from './runtime/labels-cloud-read.mjs';
import {resolveLabelCloudCredential} from './runtime/labels-cloud-credential.mjs';
const safeErrors = new Set(['请求过大','未知标签操作','请先在设置中绑定官网，以读取云端标签','无法拉取云端标签，已保留本机缓存','官网凭证无读取权限，请检查设置中的官网绑定','云端标签服务尚未上线，已保留本机缓存','云端标签暂时不可用，已保留本机缓存','云端标签数据过大','云端标签格式错误','云端标签响应为空','云端标签传输中断，已保留本机缓存']);
try {
  let input = '';
  process.stdin.setEncoding('utf8');for await(const chunk of process.stdin) { input += chunk; if (input.length > 2048) throw Error('请求过大'); if (input.endsWith('\n')) break; }
  let request;
  try { request = JSON.parse(input); } catch { throw Error('未知标签操作'); }
  if (request?.method !== 'read') throw Error('未知标签操作');
  const token = await resolveLabelCloudCredential();
  process.stdout.write(JSON.stringify(await readCloudLabels(token)));
} catch (error) { process.stderr.write(safeErrors.has(error?.message) ? error.message : '云端标签暂时不可用，已保留本机缓存'); process.exitCode = 1; }
