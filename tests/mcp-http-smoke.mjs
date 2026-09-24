import assert from 'node:assert/strict';
import {writeFile,copyFile,symlink,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
// Optional integration suite. See docs/CHAT-HOSTS.md for dependency setup.
// Uses real MCP transports and locally signed JWTs with an inert agent fixture.
// No provider inference, account credentials or deployment operations occur.
const root=fileURLToPath(new URL('..',import.meta.url));
if(!process.env.NB_SMOKE_NODE_MODULES || !process.env.NB_SMOKE_PYTHON) {
  throw new Error('Set NB_SMOKE_NODE_MODULES to generated TypeScript node_modules and NB_SMOKE_PYTHON to a Python interpreter with generated dependencies. See docs/CHAT-HOSTS.md.');
}
const sdk=resolve(process.env.NB_SMOKE_NODE_MODULES);
const python=resolve(process.env.NB_SMOKE_PYTHON);
await access(join(sdk,'@modelcontextprotocol/sdk/package.json'));
await access(python);
const qa=await mkdtemp(join(tmpdir(),'nb-mcp-smoke-'));
const {privateKey,publicKey}=await generateKeyPair('RS256');
const key=await exportJWK(publicKey);key.kid='qa';key.alg='RS256';
const jwks=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[key]}))});
await new Promise(resolve=>jwks.listen(0,'127.0.0.1',resolve));
const issuer='http://127.0.0.1:'+jwks.address().port;
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
let assertions=0;
try {for(const lang of ['typescript','python']) {
const path=qa+'/'+lang;await mkdir(path,{recursive:true});
const p=await port();const resource='http://127.0.0.1:'+p+'/mcp';
const spec={name:'QA',description:'QA only',security:{inbound:{mode:'jwt',issuer,audience:resource,jwksUrl:issuer+'/jwks',algorithms:['RS256']},requiredScopes:['agent:run']},agent:{tools:[{method:'POST',requiredScopes:['tool:write']}],limits:{timeoutMs:4000}},delivery:{port:p}};
await writeFile(path+'/agent-spec.json',JSON.stringify(spec));
await copyFile(root+'/src/templates/mcp_http.'+(lang==='python'?'py':'ts')+'.tpl',path+'/mcp_http.'+(lang==='python'?'py':'ts'));
if(lang==='typescript') {
await symlink(sdk,path+'/node_modules',process.platform==='win32'?'junction':'dir');
await writeFile(path+'/package.json',JSON.stringify({type:'module'}));
await writeFile(path+'/tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:true,noEmit:true}}));
await writeFile(path+'/runtime.ts',`import {readFileSync} from 'node:fs';export const SPEC=JSON.parse(readFileSync(new URL('./agent-spec.json',import.meta.url),'utf8')); export function context(scopes?:string[],approvals?:string[]){return {scopes:new Set(scopes??['ENV-ROOT']),approvals:new Set(approvals??['ENV-ROOT']),signal:AbortSignal.timeout(4000)}}`);
await writeFile(path+'/agent.ts',`import {context} from './runtime.js';export async function runAgent(input:string,ctx=context()){if(input==='scope-check')throw new Error('Missing tool scopes');if(input==='secret-error')throw new Error('SECRET-NEVER-EXPOSE');return {output:JSON.stringify({scopes:[...ctx.scopes],approvals:[...ctx.approvals]}),usage:undefined,trace:['PRIVATE']}}`);
const compiler=spawn(process.execPath,[root+'/node_modules/typescript/bin/tsc','--noEmit'],{cwd:path,stdio:'inherit'});assert.equal(await new Promise(r=>compiler.on('close',r)),0);assertions++;
}else{
await writeFile(path+'/runtime.py',`import json\nfrom pathlib import Path\nSPEC=json.loads((Path(__file__).parent/'agent-spec.json').read_text())\ndef context(scopes=None,approvals=None): return {'scopes':set(scopes if scopes is not None else ['ENV-ROOT']),'approvals':set(approvals if approvals is not None else ['ENV-ROOT'])}\n`);
await writeFile(path+'/agent.py',`import json\nasync def run_agent(input,ctx):\n    if input=='scope-check': raise PermissionError('Missing tool scopes')\n    if input=='secret-error': raise RuntimeError('SECRET-NEVER-EXPOSE')\n    return {'output':json.dumps({'scopes':sorted(ctx['scopes']),'approvals':sorted(ctx['approvals'])}),'trace':['PRIVATE']}\n`);
}
const child=spawn(lang==='python'?python:process.execPath,lang==='python'?['mcp_http.py']:[root+'/node_modules/tsx/dist/cli.mjs','mcp_http.ts'],{cwd:path,env:{...process.env,PUBLIC_MCP_URL:resource,MCP_ALLOW_LOCAL_HTTP:'1',PORT:String(p),HOST:'127.0.0.1',AGENT_SCOPES:'ENV-ROOT',AGENT_APPROVALS_JSON:'["ENV-ROOT"]'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
try {
for(let n=0;n<100;n++){try{const r=await fetch(resource.replace('/mcp','/ping'));if(r.ok)break}catch{}if(child.exitCode!==null)throw new Error('server exited '+log);await new Promise(r=>setTimeout(r,50));if(n===99)throw new Error('server timeout '+log);}
const token=async(claims={},aud=resource)=>await new SignJWT({scope:'agent:run',...claims}).setProtectedHeader({alg:'RS256',kid:'qa'}).setIssuer(issuer).setAudience(aud).setSubject('qa-user').setIssuedAt().setExpirationTime('2m').sign(privateKey);
const good=await token();
const post=async(body,auth=good,extra={})=>fetch(resource,{method:'POST',headers:{Accept:'application/json, text/event-stream','Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...extra},body:JSON.stringify(body)});
const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'qa',version:'1'}}};
let r=await fetch(resource.replace('/mcp','/.well-known/oauth-protected-resource/mcp'));assert.equal(r.status,200);let body=await r.json();assert.equal(body.resource,resource);assert.deepEqual(body.authorization_servers,[issuer]);assert.deepEqual(body.scopes_supported,['agent:run','tool:write']);assertions++;
r=await post(init,'');assert.equal(r.status,401);assert.ok(r.headers.get('www-authenticate').includes('/.well-known/oauth-protected-resource/mcp'));assertions++;
r=await post(init,await token({},'wrong'));assert.equal(r.status,401);assertions++;
r=await post(init,await token({scope:'wrong'}));assert.equal(r.status,403);assert.ok(r.headers.get('www-authenticate').includes('insufficient_scope'));assertions++;
r=await post(init,good,{Origin:'https://evil.example'});assert.equal(r.status,403);assertions++;
const badHostStatus=await new Promise((resolve,reject)=>{const q=httpRequest(resource,{method:'POST',headers:{Host:'evil.example','Content-Type':'application/json',Authorization:'Bearer '+good}},res=>{res.resume();resolve(res.statusCode)});q.on('error',reject);q.end(JSON.stringify(init))});assert.equal(badHostStatus,421);assertions++;
r=await post(init,good,{'Content-Type':'text/plain'});assert.equal(r.status,415);assertions++;
r=await post(init);assert.equal(r.status,200,log);assert.equal(r.headers.get('mcp-session-id'),null);body=await r.json();assert.equal(body.result.serverInfo.name,'QA');assertions++;
r=await post({jsonrpc:'2.0',id:2,method:'tools/list'});assert.equal(r.status,200,log);body=await r.json();assert.equal(body.result.tools[0].name,'invoke_agent');assert.equal(body.result.tools[0].securitySchemes[0].type,'oauth2');assertions++;
const call={jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'invoke_agent',arguments:{input:'identity'}}};
r=await post(call);assert.equal(r.status,200);body=await r.json();let identity=JSON.parse(body.result.structuredContent.output);assert.deepEqual(identity.scopes,['agent:run']);assert.deepEqual(identity.approvals,[]);assert.ok(!JSON.stringify(body).includes('PRIVATE'));assertions++;
const approval='a'.repeat(64);r=await post(call,await token({scope:'agent:run tool:write',agent_approvals:[approval]}));body=await r.json();identity=JSON.parse(body.result.structuredContent.output);assert.ok(identity.scopes.includes('tool:write'));assert.deepEqual(identity.approvals,[approval]);assertions++;
r=await post({...call,params:{...call.params,arguments:{input:'identity',scopes:['tool:write'],approvals:[approval]}}});body=await r.json();assert.equal(body.result.isError,true);assertions++;
r=await post({...call,params:{...call.params,arguments:{input:'scope-check'}}});body=await r.json();assert.equal(body.result.isError,true);assert.ok(body.result._meta['mcp/www_authenticate'][0].includes('insufficient_scope'));assertions++;
r=await post({...call,params:{...call.params,arguments:{input:'secret-error'}}});body=await r.json();assert.equal(body.result.isError,true);assert.ok(!JSON.stringify(body).includes('SECRET-NEVER-EXPOSE'));assertions++;
r=await post(call,good,{'Mcp-Session-Id':'attacker-session'});assert.equal(r.status,400);assertions++;
r=await post({...call,params:{...call.params,arguments:{input:'x'.repeat(130000)}}});assert.equal(r.status,413);assertions++;
r=await fetch(resource,{headers:{Authorization:'Bearer '+good}});assert.equal(r.status,405);assertions++;
console.log(lang+': protocol, verified identity, OAuth discovery, Host/Origin, payload, errors and session checks passed');
} catch(e){console.error(log);throw e;} finally {child.kill('SIGTERM');await new Promise(r=>child.on('close',r));}
}}
finally{jwks.closeAllConnections();await new Promise(r=>jwks.close(r));if(process.env.NB_SMOKE_KEEP==='1')console.log('Fixtures retained at '+qa);else await rm(qa,{recursive:true,force:true});}
console.log(assertions+' assertions passed; local fake agent only, no provider calls.');
