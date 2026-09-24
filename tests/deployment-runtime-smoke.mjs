/** Optional real-framework validation for deployment fixture/server/driver contracts.
 * First install SDKs using generator-runtime-smoke.mjs --install with the same AGENT_SMOKE_ROOT.
 * Run: AGENT_SMOKE_ROOT=/path/to/framework-smoke node --import tsx tests/deployment-runtime-smoke.mjs
 * Engine lifecycle is a fake fixture; HTTP, JWT, model mock and all seven frameworks execute on this host.
 * No provider credentials, model calls or cloud accounts are used. This does not validate real containers.
 */
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import os, { tmpdir } from 'node:os';
import { mock } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const source=process.cwd();
const {defaultSpec}=await import(source+'/src/core.ts');
const {createProject,buildProject,manifestName}=await import(source+'/src/workbench.ts');
const {deploymentTest}=await import(source+'/src/deployment-testing.ts');
const deps=resolve(process.env.AGENT_SMOKE_ROOT ?? join(tmpdir(),'nb-agent-framework-smoke'));
const testSource=await readFile(source+'/tests/deployment-testing.test.ts','utf8');
const fake=testSource.split('const fake = `')[1].split('\n`;')[0].replace('${process.execPath}',process.execPath);
const root=await mkdtemp(join(tmpdir(),'instrilo-host-contract-')),bin=join(root,'bin'),testHome=join(root,'home');await mkdir(bin);await mkdir(testHome);await writeFile(join(bin,'docker'),fake,{mode:0o700});
const homedirMock=mock.method(os,'homedir',()=>testHome);syncBuiltinESMExports();
const oldPath=process.env.PATH;process.env.PATH=bin;
let assertions=0;
const children=[];
function stop(child){try{if(child.pid)process.kill(-child.pid,'SIGKILL');}catch{} child.stdout?.destroy();child.stderr?.destroy();}
function start(exe,args,cwd,env={}){const child=spawn(exe,args,{cwd,detached:true,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',XDG_CACHE_HOME:join(testHome,'cache'),XDG_DATA_HOME:join(testHome,'data'),XDG_CONFIG_HOME:join(testHome,'config'),CREWAI_STORAGE_DIR:join(testHome,'crewai'),INSTRILO_TEST_MODEL_KEY:'instrilo-mock-only',INSTRILO_TEST_TOOL_KEY:'instrilo-mock-only',OTEL_SDK_DISABLED:'true',CREWAI_TRACING_ENABLED:'false',CREWAI_TELEMETRY_OPT_OUT:'true',DO_NOT_TRACK:'1',...env},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err=(err+c).slice(-4000));children.push(child);return {child,result:()=>new Promise((resolve,reject)=>{const t=setTimeout(()=>{stop(child);reject(Error('timeout'));},90000);child.once('error',reject);child.once('close',code=>{clearTimeout(t);resolve({code,out,err});});})};}
async function freeport(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
try{for(const [language,framework] of [['typescript','native'],['typescript','langgraph'],['typescript','openai-agents'],['python','native'],['python','langgraph'],['python','openai-agents'],['python','crewai']]){
 const spec=defaultSpec('host-'+language+'-'+framework);spec.language=language;spec.framework=framework;spec.delivery.target='aws-agentcore';spec.connections.demo={kind:framework==='crewai'?'openai':'gateway',model:'mock',baseUrl:'https://unused.example/v1',auth:{type:'api-key',env:'NEVER_USE'}};spec.security={inbound:{mode:'jwt',issuer:'https://unused.example',audience:'test',jwksUrl:'https://unused.example/jwks',algorithms:['RS256']},requiredScopes:['test:invoke']};
 const {dir}=await createProject(root,{name:spec.name,spec});await buildProject(join(dir,manifestName));const report=await deploymentTest(dir,{execute:true,keep:true});assert.equal(report.status,'passed',JSON.stringify(report));
 const context=join(dirname(report.reportPath),'context'),ext=language==='python'?'py':'mjs',fp=await freeport(),ap=await freeport();
 const testSpec=JSON.parse(await readFile(join(context,'agent-spec.json'),'utf8'));testSpec.connections.runtime.baseUrl='http://127.0.0.1:'+fp+'/v1';testSpec.security.inbound.jwksUrl='http://127.0.0.1:'+fp+'/jwks';await writeFile(join(context,'agent-spec.json'),JSON.stringify(testSpec));
 for(const name of ['fixture','driver']){const p=join(context,'instrilo-test-'+name+'.'+ext);let contents=await readFile(p,'utf8');contents=contents.replaceAll('/app/instrilo-test-data.json',join(context,'instrilo-test-data.json')).replaceAll('18080',String(fp)).replaceAll('8080',String(ap));await writeFile(p,contents);}
 const py=join(deps,language+'-'+framework,'.venv/bin/python'),exe=language==='python'?py:process.execPath;
 if(language==='typescript')await symlink(join(deps,language+'-'+framework,'node_modules'),join(context,'node_modules'));
 const fixture=start(exe,['instrilo-test-fixture.'+ext],context),agent=start(exe,language==='python'?['server.py']:[join(source,'node_modules/tsx/dist/cli.mjs'),'server.ts'],context,{HOST:'127.0.0.1',PORT:String(ap)});
 const driver=start(exe,['instrilo-test-driver.'+ext],context);const result=await driver.result();assert.equal(result.code,0,result.err);const checks=JSON.parse(result.out).checks;assert.ok(checks.every(c=>c.passed),JSON.stringify(checks));assertions+=checks.length;console.log(language+'/'+framework+': '+checks.length+' real HTTP/JWT/model-fixture checks passed');
 stop(fixture.child);stop(agent.child);
 }}finally{for(const child of children)stop(child);homedirMock.mock.restore();syncBuiltinESMExports();if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;await rm(root,{recursive:true,force:true});}
console.log(assertions+' actual host HTTP/JWT/model fixture assertions passed. Container engine lifecycle is simulated; no images or cloud services were run.');
