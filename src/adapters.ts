import { writeFile, mkdir, opendir, open, rm, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { z } from 'zod';
import { safeChild } from './workbench.js';
import { providerCapabilities } from './providers.js';
import { frameworkCapabilities } from './generators.js';
import type { Artifact, GuidanceReport, ProjectSpec } from './types.js';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/);
const MAX_BYTES = 2_000_000;
const reservedEnvironment = /^(?:NODE_|INSTRILO_|LD_|DYLD_|PYTHON)|^(?:PATH|PATHEXT|HOME|USERPROFILE|COMSPEC|ENV|BASH_ENV|OPENSSL_CONF|OPENSSL_MODULES|SSL_CERT_FILE|SSL_CERT_DIR)$/;
const bundlePath = z.string().max(512).refine(p => Buffer.byteLength(p)<=512 && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0') && p.split('/').every(part => !!part && part !== '..' && !part.startsWith('.')), 'Invalid bundle path');
async function readBounded(path: string, maximum = MAX_BYTES): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Adapter bundles must contain only regular files.');
    if (stat.size > maximum) throw new Error('Adapter file exceeds its size limit.');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
    let size = 0;
    while (size < buffer.length) { const { bytesRead } = await file.read(buffer, size, buffer.length - size, null); if (!bytesRead) break; size += bytesRead; }
    if (size > maximum || size > stat.size) throw new Error('Adapter file changed or exceeds its size limit.');
    return buffer.subarray(0, size);
  } finally { await file.close(); }
}
function safeAdapterError(value: unknown, secrets: string[]) {
  let message = String(value instanceof Error ? value.message : value);
  for (const secret of secrets.filter(Boolean).sort((a,b) => b.length-a.length)) message = message.split(secret).join('[REDACTED]');
  return message.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').replace(/\b(?:sk|ghp|github_pat)-[a-zA-Z0-9_-]{8,}/g, '[REDACTED]').slice(0, 1000);
}
export const adapterManifestSchema = z.object({
  schemaVersion: z.literal('1'), apiVersion: z.literal('1'), id: slug, version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  kind: z.enum(['provider', 'framework', 'target', 'host']), description: z.string().min(1).max(2000),
  entry: z.string().max(512).regex(/^[a-zA-Z0-9_/-]+\.mjs$/), operations: z.array(z.enum(['complete','generate'])).min(1).max(2),
  languages: z.array(z.enum(['python','typescript'])).min(1).max(2),
  permissions: z.object({ environment: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/).refine(key => !reservedEnvironment.test(key), 'Runtime and process-control environment variables cannot be forwarded.')).max(30), network: z.boolean(), filesystem: z.boolean() }).strict(),
}).strict().superRefine((m,c) => { if (m.entry.split('/').some(p => p === '..') || m.entry.startsWith('/')) c.addIssue({ code:'custom',message:'Entry must stay inside the adapter.' }); if(m.kind !== 'provider' && m.operations.includes('complete')) c.addIssue({code:'custom',message:'Only providers may complete model requests.'}); if(new Set(m.operations).size!==m.operations.length) c.addIssue({code:'custom',message:'Operations must be unique.'}); });
export type AdapterManifest = z.infer<typeof adapterManifestSchema>;
interface InstalledAdapter { manifest: AdapterManifest; directory: string; sha256: string; files: Record<string,string>; installedAt: string; }
const registrySchema = z.object({schemaVersion:z.literal('1'), adapters:z.array(z.object({manifest:adapterManifestSchema,directory:z.string().max(256),sha256:z.string().regex(/^[a-f0-9]{64}$/),files:z.record(bundlePath,z.string().regex(/^[a-f0-9]{64}$/)).refine(files=>Object.keys(files).length<=100),installedAt:z.string().datetime()}).strict().refine(a => a.directory === '.instrilo/adapters/'+a.manifest.id+'/'+a.sha256, 'Invalid installed bundle directory')).max(30)}).strict().refine(r=>new Set(r.adapters.map(a=>a.manifest.id)).size===r.adapters.length,'Duplicate adapter ids');
async function registry(root:string) { try { return registrySchema.parse(JSON.parse((await readBounded(safeChild(root,'.instrilo/adapters.json'))).toString('utf8'))); } catch(e:any){if(e.code==='ENOENT')return {schemaVersion:'1' as const,adapters:[] as InstalledAdapter[]};throw e;} }
async function adapterFiles(root:string) { const files:Record<string,string>={}; let total=0, entries=0;
  async function walk(prefix='',depth=0){
    if(depth>16)throw new Error('Adapter bundle exceeds 16 directory levels.');
    for await(const item of await opendir(safeChild(root,prefix||'.'))) {
      if(++entries>200)throw new Error('Adapter bundle exceeds 200 filesystem entries.');
      const path=prefix?prefix+'/'+item.name:item.name;
      if(item.isSymbolicLink())throw new Error('Adapter bundles cannot contain symbolic links.');
      if(item.name.startsWith('.')||item.name==='node_modules')throw new Error('Adapter bundles cannot contain hidden files or node_modules. Bundle dependencies into entry.mjs.');
      bundlePath.parse(path);
      if(item.isDirectory())await walk(path,depth+1);
      else {
        if(!item.isFile())throw new Error('Adapter bundles must contain only regular files.');
        if(Object.keys(files).length>=100)throw new Error('Adapter bundle exceeds 100 files.');
        const body=await readBounded(safeChild(root,path),MAX_BYTES-total);total+=body.length;files[path]=digest(body);
      }
    }
  }
  await walk();return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export async function inspectAdapter(directory:string) { const root=resolve(directory);const files=await adapterFiles(root);const body=await readBounded(safeChild(root,'adapter.json'),64_000);if(digest(body)!==files['adapter.json'])throw new Error('Adapter manifest changed during inspection.');const manifest=adapterManifestSchema.parse(JSON.parse(body.toString('utf8')));if(!files[manifest.entry])throw new Error('Adapter entry is missing.');return {manifest,files,sha256:digest(JSON.stringify(files))}; }
/** Serializes registry mutations with extension generation and its exact pin snapshot. Not reentrant. */
export async function withAdapterRegistryLock<T>(project:string,action:()=>Promise<T>):Promise<T>{
  const lock=safeChild(resolve(project),'.instrilo/adapters.lock');await mkdir(dirname(lock),{recursive:true,mode:0o700});
  try{await writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});}
  catch(error:any){if(error.code==='EEXIST')throw Object.assign(new Error('Adapter registry is busy or has an unrecovered lock. Retry after its build/install/remove operation ends.'),{code:'EEXIST'});throw error;}
  try{return await action();}finally{await rm(lock,{force:true});}
}
export async function installAdapter(project:string,directory:string,options:{trustCode:boolean;replace?:boolean}) {
  if(!options.trustCode)throw new Error('Adapters execute local code. Inspect the bundle and explicitly pass --trust-code to install it.');
  const root=resolve(project), source=resolve(directory), inspected=await inspectAdapter(source);
  return withAdapterRegistryLock(root,async()=>{
  const tmp=safeChild(root,'.instrilo/adapter-staging-'+randomUUID());
  try {const data=await registry(root);if(data.adapters.some(a=>a.manifest.id===inspected.manifest.id)&&!options.replace)throw new Error('Adapter is already installed; use --replace after inspecting the new version.');
    const folder='.instrilo/adapters/'+inspected.manifest.id+'/'+inspected.sha256;
    await mkdir(tmp,{mode:0o700});let copied=0;for(const [path,hash]of Object.entries(inspected.files)){const content=await readBounded(safeChild(source,path),MAX_BYTES-copied);copied+=content.length;if(digest(content)!==hash)throw new Error('Source adapter changed during installation.');const dest=safeChild(tmp,path);await mkdir(dirname(dest),{recursive:true,mode:0o700});await writeFile(dest,content,{flag:'wx',mode:0o600});}
    const destination=safeChild(root,folder);await mkdir(dirname(destination),{recursive:true,mode:0o700});try{await rename(tmp,destination);}catch(e:any){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;const existing=await inspectAdapter(destination);if(existing.sha256!==inspected.sha256)throw new Error('Installed adapter directory has been modified.');}
    const entry={...inspected,directory:folder,installedAt:new Date().toISOString()};data.adapters=data.adapters.filter(a=>a.manifest.id!==entry.manifest.id).concat(entry);registrySchema.parse(data);const serialized=JSON.stringify(data,null,2)+'\n';if(Buffer.byteLength(serialized)>MAX_BYTES)throw new Error('Adapter registry exceeds 2 MB.');const path=safeChild(root,'.instrilo/adapters.json'),pending=path+'.'+randomUUID();try{await writeFile(pending,serialized,{flag:'wx',mode:0o600});await rename(pending,path);}finally{await rm(pending,{force:true});}return entry;
  }finally{await rm(tmp,{recursive:true,force:true});}
  });
}
export async function listAdapters(project:string){return (await registry(resolve(project))).adapters;}
export async function removeAdapter(project:string,id:string){
  slug.parse(id);const root=resolve(project);
  return withAdapterRegistryLock(root,async()=>{let pending:string|undefined;
  try {
    const fresh=await registry(root);
    if(!fresh.adapters.some(a=>a.manifest.id===id))throw new Error('Adapter is not installed.');
    fresh.adapters=fresh.adapters.filter(a=>a.manifest.id!==id);const file=safeChild(root,'.instrilo/adapters.json');pending=file+'.'+randomUUID();
    await writeFile(pending,JSON.stringify(fresh,null,2)+'\n',{flag:'wx',mode:0o600});await rename(pending,file);
    return {removed:id,note:'Pinned bundle retained on disk; it will no longer run during builds. Rebuild the project.'};
  }finally{if(pending)await rm(pending,{force:true});}
  });
}
export async function adapterFingerprint(project:string){return (await listAdapters(project)).map(a=>({id:a.manifest.id,version:a.manifest.version,sha256:a.sha256})).sort((a,b)=>a.id.localeCompare(b.id));}
async function checkedAdapter(project:string,id:string){const a=(await listAdapters(project)).find(x=>x.manifest.id===id);if(!a)throw new Error('Adapter is not installed: '+id);const dir=safeChild(resolve(project),a.directory);const actual=await inspectAdapter(dir);if(actual.sha256!==a.sha256||JSON.stringify(actual.manifest)!==JSON.stringify(a.manifest))throw new Error('Adapter content no longer matches its installed pin. Inspect and reinstall explicitly.');return {...a,absolute:dir};}
export async function invokeAdapter(project:string,id:string,request:unknown,options:{timeoutMs?:number;signal?:AbortSignal;fixture?:boolean}={}){
  const timeoutMs=options.timeoutMs??15000;if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new Error('Adapter timeout must be 1–120000 ms.');
  const adapter=await checkedAdapter(project,id);let body:string;try{body=JSON.stringify(request);if(typeof body!=='string')throw new Error();}catch{throw new Error('Adapter request must be JSON serializable.');}if(Buffer.byteLength(body)>MAX_BYTES)throw new Error('Adapter request exceeds 2 MB.');
  const env:Record<string,string>={PATH:process.env.PATH||'',NODE_ENV:'production',INSTRILO_ADAPTER_FIXTURE:options.fixture?'1':'0'};
  const secrets=adapter.manifest.permissions.environment.map(key=>process.env[key]||'');
  if(!options.fixture)for(const key of adapter.manifest.permissions.environment)if(process.env[key])env[key]=process.env[key]!;
  return new Promise<any>((yes,no)=>{if(options.signal?.aborted)return no(new Error('Adapter cancelled.'));const child=spawn(process.execPath,[fileURLToPath(new URL('./adapter-worker.mjs',import.meta.url)),safeChild(adapter.absolute,adapter.manifest.entry)],{cwd:adapter.absolute,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});const output:Buffer[]=[];let outputSize=0,errorSize=0,failure:Error|undefined,done=false;
    const kill=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{child.kill('SIGKILL');}};
    const stop=(reason:string)=>{failure??=new Error(reason);kill();};
    const abort=()=>stop('Adapter cancelled.');const timer=setTimeout(()=>stop('Adapter timed out.'),timeoutMs);options.signal?.addEventListener('abort',abort,{once:true});
    const end=(error?:Error,result?:any)=>{if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);kill();error?no(error):yes(result);};
    child.stdout.on('data',(c:Buffer)=>{outputSize+=c.length;if(outputSize>MAX_BYTES)return stop('Adapter output exceeds 2 MB.');if(!failure)output.push(c);});
    child.stderr.on('data',(c:Buffer)=>{errorSize+=c.length;if(errorSize>MAX_BYTES)stop('Adapter diagnostics exceed 2 MB.');});
    child.stdin.on('error',()=>{});child.on('error',e=>end(new Error(safeAdapterError(e,secrets))));
    child.on('close',code=>{if(failure)return end(failure);let envelope:any;try{envelope=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{return end(new Error('Adapter returned invalid JSON.'));}if(code!==0||!envelope||envelope.ok!==true)return end(new Error('Adapter failed: '+safeAdapterError(envelope?.error||'invalid response',secrets)));end(undefined,envelope.result);});
    // Close the process group when the worker exits, including children that kept its pipes open.
    child.on('exit',kill);child.stdin.end(body);
  });
}
function generatedFiles(id:string,result:any):Artifact[]{if(!result||!Array.isArray(result.artifacts)||result.artifacts.length>100)throw new Error('Generate response must contain at most 100 artifacts.');let total=0;const paths=new Set<string>();return result.artifacts.map((a:any)=>{if(!a||typeof a.path!=='string'||!a.path.startsWith('extensions/'+id+'/')||!bundlePath.safeParse(a.path).success||typeof a.content!=='string'||a.executable)throw new Error('Adapter artifacts must be non-executable files beneath extensions/'+id+'/; protected runtime files cannot be replaced.');total+=Buffer.byteLength(a.content);if(total>MAX_BYTES||paths.has(a.path))throw new Error('Duplicate or oversized adapter artifacts.');paths.add(a.path);return {path:a.path,content:a.content};});}
export async function generatePluginArtifacts(project:string,spec:ProjectSpec,guidance:GuidanceReport){const artifacts:Artifact[]=[];for(const a of await listAdapters(project)){if(!a.manifest.operations.includes('generate'))continue;if(!a.manifest.languages.includes(spec.language))throw new Error('Adapter '+a.manifest.id+' does not support '+spec.language);const result=await invokeAdapter(project,a.manifest.id,{apiVersion:'1',operation:'generate',spec,guidance:{files:guidance.files,combined:guidance.combined}});artifacts.push(...generatedFiles(a.manifest.id,result));}return artifacts;}
export async function scaffoldAdapter(directory:string,id:string,kind:AdapterManifest['kind']='target'){
  slug.parse(id);const root=resolve(directory);await mkdir(root,{recursive:false});const manifest:AdapterManifest={schemaVersion:'1',apiVersion:'1',id,version:'0.1.0',kind,description:'A local Instrilo '+kind+' adapter.',entry:'entry.mjs',operations:kind==='provider'?['complete']:['generate'],languages:['python','typescript'],permissions:{environment:[],network:false,filesystem:false}};
  await writeFile(join(root,'adapter.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await writeFile(join(root,'entry.mjs'),kind==='provider'?`export default async function(request) {\n  if (request.apiVersion !== '1' || request.operation !== 'complete') throw new Error('Unsupported operation');\n  if (!Array.isArray(request.messages) || !request.messages.length) throw new Error('Messages required');\n  return { model: request.model || 'local-fixture', message: { role: 'assistant', content: 'Adapter fixture response. Replace this provider implementation before live use.' } };\n}\n`:`export default async function(request) {\n  if (request.apiVersion !== '1' || request.operation !== 'generate') throw new Error('Unsupported operation');\n  if (!request.spec || !['python','typescript'].includes(request.spec.language)) throw new Error('Language required');\n  return { artifacts: [{ path: 'extensions/${id}/README.md', content: '# ${id}\\n\\nProject: ' + request.spec.name + '\\nLanguage: ' + request.spec.language + '\\n' }] };\n}\n`,{flag:'wx'});
  await writeFile(join(root,'README.md'),'# '+id+'\n\nAPI v1 adapter. Edit entry.mjs, inspect permissions, install with explicit trust, then run adapters test. Runtime code is trusted local code, not sandboxed. Bundle dependencies; do not include credentials or node_modules. Generation adds files under extensions/'+id+'/ without replacing the built-in runtime.\n',{flag:'wx'});return {directory:root,manifest};
}
const completionSchema=z.object({model:z.string().min(1).max(256),message:z.object({role:z.literal('assistant'),content:z.string().nullable(),tool_calls:z.array(z.object({id:z.string(),type:z.literal('function'),function:z.object({name:z.string(),arguments:z.string()})})).optional()}).strict(),usage:z.object({prompt_tokens:z.number().int().nonnegative(),completion_tokens:z.number().int().nonnegative(),total_tokens:z.number().int().nonnegative()}).optional()}).strict();
export async function testAdapter(project:string,id:string,spec:ProjectSpec){const adapter=await checkedAdapter(project,id);const checks:{name:string;passed:boolean;detail?:string}[]=[];const run=async(name:string,fn:()=>Promise<void>)=>{try{await fn();checks.push({name,passed:true});}catch(e:any){checks.push({name,passed:false,detail:e.message});}};
  if(adapter.manifest.operations.includes('generate'))for(const language of adapter.manifest.languages)await run('generate/'+language,async()=>{generatedFiles(id,await invokeAdapter(project,id,{apiVersion:'1',operation:'generate',spec:{...spec,language},guidance:{files:[],combined:''}},{fixture:true}));});
  if(adapter.manifest.operations.includes('complete'))await run('complete/envelope',async()=>{completionSchema.parse(await invokeAdapter(project,id,{apiVersion:'1',operation:'complete',model:'conformance-fixture',messages:[{role:'user',content:'Return a fixture response; do not call a live model.'}]},{fixture:true}));});
  await run('reject/unknown-operation',async()=>{let rejected=false;try{await invokeAdapter(project,id,{apiVersion:'1',operation:'not-supported'},{fixture:true});}catch{rejected=true;}if(!rejected)throw new Error('Adapter accepted an unknown operation.');});
  await run('reject/invalid-input',async()=>{let rejected=false;try{await invokeAdapter(project,id,{apiVersion:'1',operation:adapter.manifest.operations[0]},{fixture:true});}catch{rejected=true;}if(!rejected)throw new Error('Adapter accepted missing required input.');});
  return {adapter:id,sha256:adapter.sha256,passed:checks.every(c=>c.passed),checks,verification:'Local interface conformance. No remote provider, cloud, SDK semantic or security certification.',note:'Fixture mode withholds declared environment credentials; adapters remain explicitly trusted code, not a network sandbox.'};
}
export async function serveAdapter(project:string,id:string,options:{port:number;tokenEnv:string}){
  if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw new Error('Gateway port must be 0–65535.');
  if(!/^[A-Z][A-Z0-9_]*$/.test(options.tokenEnv))throw new Error('Invalid gateway token environment name.');
  const adapter=await checkedAdapter(project,id);if(!adapter.manifest.operations.includes('complete'))throw new Error('Only completion adapters can serve a gateway.');
  const secret=process.env[options.tokenEnv];if(!secret||secret.length<24)throw new Error('Set the named gateway bearer-token variable to at least 24 characters.');
  let active=0;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const send=(status:number,body:unknown)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status);res.end(JSON.stringify(body));}};
    const host=(req.headers.host||'').split(':')[0];
    if(!['127.0.0.1','localhost'].includes(host))return send(403,{error:'Invalid Host'});
    if(req.headers.origin)return send(403,{error:'Browser origins are not supported'});
    const authorization=String(req.headers.authorization||'');const token=authorization.startsWith('Bearer ')?authorization.slice(7):'';
    if(Buffer.byteLength(token)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(token),Buffer.from(secret)))return send(401,{error:'Bearer token required'});
    if(req.method!=='POST'||req.url!=='/v1/chat/completions')return send(404,{error:'Use POST /v1/chat/completions'});
    if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'])))return send(415,{error:'JSON required'});
    if(active>=8)return send(503,{error:'Adapter gateway is busy'});
    if(Number(req.headers['content-length'])>1_000_000)return send(413,{error:'Request exceeds 1 MB'});
    active++;const controller=new AbortController();const abort=()=>controller.abort();res.once('close',abort);
    const timer=setTimeout(()=>{controller.abort();send(408,{error:'Request timed out'});req.destroy();},30000);
    try {
      const chunks:Buffer[]=[];let size=0;
      for await(const c of req){size+=c.length;if(size>1_000_000)return send(413,{error:'Request exceeds 1 MB'});chunks.push(c);}
      let input:any;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'Invalid JSON'});}
      if(!input||typeof input!=='object'||Array.isArray(input)||input.stream||!Array.isArray(input.messages)||!input.messages.length)return send(400,{error:'Non-streaming messages are required'});
      const result=completionSchema.parse(await invokeAdapter(project,id,{...input,apiVersion:'1',operation:'complete'},{signal:controller.signal}));
      send(200,{id:'instrilo-'+randomUUID(),object:'chat.completion',created:Math.floor(Date.now()/1000),model:result.model,choices:[{index:0,message:result.message,finish_reason:result.message.tool_calls?.length?'tool_calls':'stop'}],...(result.usage?{usage:result.usage}:{})});
    }catch{send(502,{error:'Adapter request failed. Check its local implementation and configuration.'});}
    finally{clearTimeout(timer);res.removeListener('close',abort);active--;}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=32;
  await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(options.port,'127.0.0.1',()=>yes());});return {server,url:'http://127.0.0.1:'+(server.address() as any).port+'/v1'};
}
export function adapterCatalog(){return {apiVersion:'1',providers:providerCapabilities,frameworks:frameworkCapabilities,targets:['local','docker','aws-agentcore','cloud-run','azure-container-apps'],hosts:['codex','claude-code','claude-desktop','chatgpt'],extensionContract:{generation:'Adds pinned artifacts below extensions/ID; does not replace built-in framework/security code.',provider:'Authenticated local OpenAI-compatible bridge; configure as a gateway connection.',permissions:'Explicit trust required. Environment forwarding is allowlisted; arbitrary adapter code is not sandboxed.'}};}
