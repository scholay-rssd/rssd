import {verifyWebsite} from './runtime/verify-website.mjs';
try {
  let input = '';
  process.stdin.setEncoding('utf8');for await(const chunk of process.stdin) { input += chunk; if (input.length > 12000) throw Error('Request too large'); if (input.endsWith('\n')) break; }
  const {method, params} = JSON.parse(input);
  if (method !== 'verify') throw Error('Unknown connection operation');
  process.stdout.write(JSON.stringify(await verifyWebsite(params?.token)));
} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
