import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdtemp,realpath,readFile,rm,stat,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runCalibrationPrototype,validateCalibrationInput} from '../scripts/rssd-calibration-prototype.mjs';
const input={predictedProbabilities:[0,0.2,0.7,1],observedOutcomes:[0,1,0,1],binCount:2};
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){const dir=await mkdtemp(join(await realpath(tmpdir()),'rssd-calibration-fixture-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('fixed numerical result and chart specification derive from the same explicit input with a reproducible receipt',async t=>{
 const directory=await fixture(t),record=await runCalibrationPrototype({input,directory});
 assert.equal(record.output.sampleCount,4);assert.equal(record.output.bins.length,2);
 assert.deepEqual(record.output.bins.map(x=>[x.sampleCount,x.events,x.observedProportion]),[[2,1,0.5],[2,1,0.5]]);
 assert.ok(Math.abs(record.output.bins[0].meanPrediction-0.1)<1e-12);
 assert.ok(Math.abs(record.output.bins[1].meanPrediction-0.85)<1e-12);
 assert.ok(Math.abs(record.output.brierScore-0.2825)<1e-12);
 assert.equal(record.seed,null);assert.equal(record.randomness,'none');assert.equal(record.environment.limits.cpuSeconds,3);
 const figure=await readFile(join(directory,record.figure)),source=await readFile(join(directory,record.source));
 assert.equal(sha(figure),record.figureSha256);assert.equal(sha(source),record.sourceSha256);
 const chart=JSON.parse(String(figure));assert.equal(record.figureType,'vega-lite-spec-not-rendered');
 assert.equal(chart.$schema,'https://vega.github.io/schema/vega-lite/v5.json');
 assert.deepEqual(chart.layer[1].data.values,record.output.bins);
 assert.equal((await stat(join(directory,'calibration-record.json'))).mode&0o077,0);
 assert.equal((await runCalibrationPrototype({input,directory})).reused,true);
});

test('rejects unbounded, malformed, arbitrary-code and nonbinary inputs before any process is run',()=>{
 for(const value of [{...input,code:'print(1)'},{...input,predictedProbabilities:[NaN]}, {...input,observedOutcomes:[0,1,0,2]}, {...input,binCount:1}, {...input,predictedProbabilities:Array(5001).fill(.5),observedOutcomes:Array(5001).fill(0)}])assert.throws(()=>validateCalibrationInput(value));
});

test('same receipt cannot be reused for different input or altered result, code or image',async t=>{
 const directory=await fixture(t),record=await runCalibrationPrototype({input,directory});
 await assert.rejects(runCalibrationPrototype({input:{...input,binCount:3},directory}),/different input/);
 await writeFile(join(directory,record.figure),'changed');
 await assert.rejects(runCalibrationPrototype({input,directory}),/evidence changed/);
});

test('resume rejects altered saved input, seed, plot declaration, and execution environment',async t=>{
 const changes=[r=>{r.input.observedOutcomes[0]=1;},r=>{r.seed=12;},r=>{r.randomness='pseudo';},r=>{r.figureType='rendered';},r=>{r.environment.python='3.0.0';},r=>{r.environment.limits.cpuSeconds=20;}];
 for(const change of changes){
  const directory=await fixture(t);await runCalibrationPrototype({input,directory});
  const path=join(directory,'calibration-record.json'),record=JSON.parse(await readFile(path));change(record);await writeFile(path,JSON.stringify(record));
  await assert.rejects(runCalibrationPrototype({input,directory}),/evidence changed/);
 }
});

test('refuses nonprivate and symlinked output locations',async t=>{
 const directory=await fixture(t),parent=await fixture(t),alias=join(parent,'link');await symlink(directory,alias);
 await assert.rejects(runCalibrationPrototype({input,directory:alias}),/not symlinked/);
 await chmod(directory,0o755);await assert.rejects(runCalibrationPrototype({input,directory}),/private/);await chmod(directory,0o700);
});
