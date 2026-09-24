import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.js';
import { createProject, buildProject, manifestName } from '../src/workbench.js';
import { saveSpec } from '../src/core.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(),'instrilo-deploy-api-')), bin = join(root,'bin'), log = join(root,'commands'); await mkdir(bin);
  for(const name of ['docker','podman']) await writeFile(join(bin,name), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');if(process.argv.includes('--version'))console.log('1.2.3');else process.exit(1);`,{mode:0o755});
  const oldPath=process.env.PATH; process.env.PATH=bin;
  const workspace=join(root,'projects'), {dir,spec}=await createProject(workspace,{name:'deploy-api'});
  spec.connections.live={kind:'gateway',model:'fixture',baseUrl:'https://model.invalid/v1',auth:{type:'none'}};spec.roles.runtime='live';spec.delivery.target='aws-agentcore';
  await saveSpec(join(dir,manifestName),spec);await buildProject(join(dir,manifestName));
  const app=await startServer({workspace,port:0});
  t.after(async()=>{app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;await rm(root,{recursive:true,force:true});});
  async function request(path:string,method='GET',body?:unknown,authorized=true){const response=await fetch(`http://127.0.0.1:${app.port}/api`+path,{method,headers:{'content-type':'application/json',...(authorized?{'x-studio-token':app.token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json() as any};}
  return {dir,request,async commands(){return (await readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}};
}
test('deployment APIs authorize before inspection and expose platform-specific guides and read-only test plans',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/projects/deploy-api/deployment/prerequisites','GET',undefined,false)).status,401);
  assert.equal((await f.request('/container-engines/docker','GET',undefined,false)).status,401);assert.deepEqual(await f.commands(),[]);
  const prerequisites=await f.request('/projects/deploy-api/deployment/prerequisites?engine=docker');assert.equal(prerequisites.status,200);assert.equal(prerequisites.data.platform.architecture,'linux/arm64');
  const guide=await f.request('/projects/deploy-api/deployment/guide');assert.equal(guide.status,200);assert.match(guide.data.content,/arm64/i);
  const plan=await f.request('/projects/deploy-api/deployment/test?engine=docker');assert.equal(plan.status,200);assert.equal(plan.data.kind,'deployment-test-plan');assert.equal(plan.data.execute,false);assert.equal(plan.data.architecture,'linux/arm64');
  assert.ok((await f.commands()).every((args:string[])=>!args.some(arg=>['build','run','rm','rmi','start','init','prune'].includes(arg))));
});
test('deployment and engine mutations require explicit bounded choices',async t=>{
  const f=await fixture(t);
  for(const body of [{},{execute:'true'},{execute:true,engine:'sh'},{execute:true,command:'injected'},{execute:true,keep:'yes'}])assert.equal((await f.request('/projects/deploy-api/deployment/test','POST',body)).status,400);
  for(const body of [{},{consent:false},{consent:'true'},{consent:true,args:['anything']}])assert.equal((await f.request('/container-engines/docker/install','POST',body)).status,400);
  assert.equal((await f.request('/projects/deploy-api/deployment/test?engine=sh')).status,400);
  assert.equal((await f.request('/container-engines/docker/install','DELETE')).status,405);
  assert.deepEqual(await f.commands(),[]);
});
test('real deployment CLI previews without running an engine and persists a failed prerequisite report with nonzero exit',async t=>{
  const f=await fixture(t);
  const run=(args:string[])=>exec(process.execPath,['--import',import.meta.resolve('tsx'),cli,...args],{maxBuffer:2_000_000});
  const planned=JSON.parse((await run(['deployment','test',f.dir,'--engine','docker'])).stdout);
  assert.equal(planned.execute,false);assert.equal(planned.architecture,'linux/arm64');assert.deepEqual(await f.commands(),[]);
  assert.match((await run(['help','deployment','test'])).stdout,/--execute/);
  await assert.rejects(run(['deployment','test',f.dir,'--engine','docker','--execute']),(error:any)=>{assert.equal(error.code,1);const report=JSON.parse(error.stdout);assert.equal(report.kind,'deployment-test-report');assert.equal(report.status,'failed');assert.match(report.reportPath,/report\.md$/);return true;});
  const reports=JSON.parse((await run(['deployment','reports',f.dir])).stdout);assert.equal(reports.length,1);assert.equal(reports[0].status,'failed');
  const cleanup=JSON.parse((await run(['deployment','cleanup',reports[0].id,f.dir])).stdout);assert.equal(cleanup.execute,false);assert.deepEqual(cleanup.resources,[]);
});
