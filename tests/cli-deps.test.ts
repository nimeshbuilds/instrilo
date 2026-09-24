import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDependencyCommand } from '../src/cli-quality.js';
import { createProject, buildProject, manifestName } from '../src/workbench.js';
import { withGenerationLock } from '../src/regeneration.js';
const repository=fileURLToPath(new URL('../',import.meta.url));
const cli=join(repository,'src/cli.ts'),tsx=join(repository,'node_modules/tsx/dist/cli.mjs');
async function waitFor<T>(fn:()=>Promise<T|undefined>):Promise<T>{const until=Date.now()+5000;while(Date.now()<until){const value=await fn();if(value!==undefined)return value;await new Promise(r=>setTimeout(r,15));}throw new Error('Dependency fixture did not become ready');}
async function absent(pid:number){assert.ok(pid>1);try{process.kill(pid,0);return undefined;}catch(e:any){if(e.code==='ESRCH')return true;throw e;}}
async function fixture(t:{after(fn:()=>Promise<void>):void}){
 const root=await mkdtemp(join(tmpdir(),'instrilo-deps-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const project=await createProject(root,{name:'dependency-agent'});await buildProject(join(project.dir,manifestName));
 return {root,project:project.dir,generated:join(project.dir,'generated')};
}
const fakeManager=`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync(process.env.INSTRILO_TEST_DEP_PIDS,JSON.stringify([process.pid,child.pid]));
process.on('SIGTERM',()=>{writeFileSync(process.env.INSTRILO_TEST_DEP_STOPPING,'stopping');setTimeout(()=>process.exit(0),150);});
setInterval(()=>{},1000);`;

test('dependency timeout waits for process closure before releasing generation ownership', {skip:process.platform==='win32'}, async t=>{
 const {root,generated}=await fixture(t),script=join(root,'fake-manager.mjs'),pidsFile=join(root,'pids.json');
 await writeFile(script,`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 const operation=withGenerationLock(generated,async()=>{
  try{await runDependencyCommand([process.execPath,script],generated,{timeoutMs:500});}
  finally{
   await access(join(generated,'.instrilo/write.lock'));
   const pids=JSON.parse(await readFile(pidsFile,'utf8'));assert.ok(pids.every((p:number)=>p>1));
   assert.equal(await absent(pids[0]),true,'Package manager must already be reaped while the caller still owns its lock.');
  }
 });
 await assert.rejects(operation,/timed out/);
 const pids=JSON.parse(await readFile(pidsFile,'utf8'));for(const pid of pids)await waitFor(()=>absent(pid));
 await assert.rejects(access(join(generated,'.instrilo/write.lock')),{code:'ENOENT'});
});

test('CLI SIGINT forwards cancellation and keeps the generation lock until the fake package manager exits', {skip:process.platform==='win32',timeout:15000}, async t=>{
 const {root,project,generated}=await fixture(t),bin=join(root,'bin'),pidsFile=join(root,'pids.json'),stopping=join(root,'stopping');
 await mkdir(bin);const executable=join(bin,'npm');await writeFile(executable,'#!/usr/bin/env node\n'+fakeManager);await chmod(executable,0o755);
 const child=spawn(process.execPath,[tsx,cli,'deps','lock',project],{cwd:repository,env:{...process.env,PATH:bin+':'+process.env.PATH,INSTRILO_TEST_DEP_PIDS:pidsFile,INSTRILO_TEST_DEP_STOPPING:stopping},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',c=>stderr+=c);child.stdout.resume();
 const outcome=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 let pids:number[]=[];let cleaned=false;
 t.after(async()=>{if(!cleaned){child.kill('SIGKILL');for(const pid of pids)if(pid>1)try{process.kill(pid,'SIGKILL');}catch{}}});
 pids=await waitFor(async()=>{try{const value=JSON.parse(await readFile(pidsFile,'utf8'));return value.every((pid:number)=>pid>1)?value:undefined;}catch{return undefined;}});
 await access(join(generated,'.instrilo/write.lock'));child.kill('SIGINT');
 await waitFor(async()=>{try{return await readFile(stopping,'utf8')==='stopping'?true:undefined;}catch{return undefined;}});
 await access(join(generated,'.instrilo/write.lock'));
 assert.equal(await outcome,1);assert.match(stderr,/cancelled/);
 for(const pid of pids)await waitFor(()=>absent(pid));cleaned=true;
 await assert.rejects(access(join(generated,'.instrilo/write.lock')),{code:'ENOENT'});
});

test('recorded-run CLI cancellation stops a trusted generated runtime and its child, then releases both locks', {skip:process.platform==='win32',timeout:15000}, async t=>{
 const {root,project,generated}=await fixture(t),pidsFile=join(root,'runtime-pids.json');
 await writeFile(join(generated,'agent.ts'),`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 const child=spawn(process.execPath,[tsx,cli,'runs','start',project,'--input','Wait for local cancellation fixture','--record-content'],{cwd:repository,env:process.env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const outcome=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 let pids:number[]=[];let cleaned=false;
 t.after(async()=>{if(!cleaned){child.kill('SIGKILL');for(const pid of pids)if(pid>1)try{process.kill(pid,'SIGKILL');}catch{}}});
 pids=await waitFor(async()=>{try{const value=JSON.parse(await readFile(pidsFile,'utf8'));return value.every((pid:number)=>pid>1)?value:undefined;}catch{return undefined;}});
 child.kill('SIGINT');assert.equal(await outcome,1,stderr);const recorded=JSON.parse(stdout);
 assert.equal(recorded.status,'failed');assert.match(recorded.error,/cancelled/i);
 for(const pid of pids)await waitFor(()=>absent(pid));cleaned=true;
 await assert.rejects(access(join(generated,'.instrilo/write.lock')),{code:'ENOENT'});
 await assert.rejects(access(join(project,'.instrilo/runs',recorded.id+'.json.lock')),{code:'ENOENT'});
});

test('locked-install CLI invokes frozen npm arguments and rejects stale locks before spawning', {skip:process.platform==='win32',timeout:15000}, async t=>{
 const {root,project,generated}=await fixture(t),bin=join(root,'bin'),invocation=join(root,'npm-args.json');
 await mkdir(bin);const executable=join(bin,'npm');await writeFile(executable,'#!/usr/bin/env node\n'+`require('node:fs').writeFileSync(${JSON.stringify(invocation)},JSON.stringify(process.argv.slice(2)));`);await chmod(executable,0o755);
 const pkg=JSON.parse(await readFile(join(generated,'package.json'),'utf8'));
 const lock=JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,packages:{'':pkg}});await writeFile(join(generated,'package-lock.json'),lock);
 const run=()=>new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[tsx,cli,'deps','install',project],{cwd:repository,env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});let stderr='';child.stdout.resume();child.stderr.on('data',c=>stderr+=c);child.once('error',reject);child.once('close',code=>resolve({code,stderr}));
 });
 const installed=await run();assert.equal(installed.code,0,installed.stderr);assert.deepEqual(JSON.parse(await readFile(invocation,'utf8')),['ci','--ignore-scripts']);
 assert.equal(await readFile(join(generated,'package-lock.json'),'utf8'),lock);
 await rm(invocation);const stale=JSON.parse(lock);stale.packages[''].dependencies={};await writeFile(join(generated,'package-lock.json'),JSON.stringify(stale));
 const rejected=await run();assert.equal(rejected.code,1);assert.match(rejected.stderr,/Lock is stale/);await assert.rejects(access(invocation),{code:'ENOENT'});
});
