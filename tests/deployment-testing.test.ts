import test, { type TestContext } from 'node:test';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultSpec } from '../src/core.js';
import { createProject, buildProject, manifestName } from '../src/workbench.js';
import { deploymentTest, deploymentTestReports, deploymentTestCleanup } from '../src/deployment-testing.js';

const fake = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,file=path.join(root,'engine-state.json'),scenarioFile=path.join(root,'scenario.json');
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{resources:[],commands:[]};
const scenario=fs.existsSync(scenarioFile)?JSON.parse(fs.readFileSync(scenarioFile)):{};
let args=process.argv.slice(2);state.commands.push([...args]);if(['--context','--host','--connection'].includes(args[0]))args=args.slice(2);if(args[0]==='--remote=false')args=args.slice(1);state.leakedSecret=process.env.INSTRILO_FAKE_SECRET??null;
const save=()=>fs.writeFileSync(file,JSON.stringify(state));save();
const fail=(text='No such object')=>{console.error(text);process.exit(1);};
const labels=()=>Object.fromEntries(args.map((a,i)=>a==='--label'?args[i+1]:null).filter(Boolean).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const id=()=>crypto.randomBytes(32).toString('hex');
function add(kind,name,extra={}){const item={kind,Name:name,Id:kind==='image'?'sha256:'+id():id(),Labels:labels(),...extra};state.resources.push(item);save();console.log(item.Id);return item;}
if(args[0]==='--version'){console.log('fixture 1.0');process.exit(0);}
if(args[0]==='context'&&args[1]==='inspect'){console.log(JSON.stringify([{Name:'default',Endpoints:{docker:{Host:scenario.endpoint??'unix:///fixture/docker.sock'}}}]));process.exit(0);}
if(args[0]==='system'&&args[1]==='connection'){console.log('[]');process.exit(0);}
if(args[0]==='info'){console.log(JSON.stringify({host:{remoteSocket:{path:'/fixture/podman.sock'}}}));process.exit(0);}
if(args[0]==='build'){
 const dir=args.at(-1);state.testSpec=JSON.parse(fs.readFileSync(path.join(dir,'agent-spec.json')));state.dockerfile=fs.readFileSync(path.join(dir,'Dockerfile'),'utf8');save();
 add('image',args[args.indexOf('--tag')+1],{Os:'linux',Architecture:scenario.wrongArchitecture?'amd64':args[args.indexOf('--platform')+1].split('/')[1]});
 if(scenario.hangBuild){setInterval(()=>{},1000);}else if(scenario.failBuild)fail('Build failure fixture');else process.exit(0);
}else if(args[0]==='network'&&args[1]==='create'){add('network',args.at(-1));}
else if(args[0]==='run'){
 const name=args[args.indexOf('--name')+1];add('container',name);
 if(scenario.failAgent&&name.endsWith('-agent'))fail('Startup fixture failed');
}else if(['container','image','network'].includes(args[0])&&args[1]==='inspect'){
 if(scenario.failInspectTransport)fail('error during connect: dial unix /fixture/docker.sock: connect: no such file or directory');
 const item=state.resources.find(x=>x.Id===args[2]||x.Name===args[2]);if(!item)fail();console.log(JSON.stringify([item]));
}else if(['container','image','network'].includes(args[0])&&args[1]==='rm'){
 const wanted=args.at(-1);const index=state.resources.findIndex(x=>x.Id===wanted);if(index<0)fail();state.resources.splice(index,1);save();
}else if(args[0]==='exec'){
 console.log(JSON.stringify({checks:['Health endpoint','Unknown route','Missing bearer token','Invalid signature','Expired token','Selected framework invocation','Untrusted permissions in body','Content type boundary','Local model fixture used'].map(name=>({name,passed:!(scenario.failProbe&&name==='Health endpoint'),detail:'Fake engine lifecycle fixture; no real container was executed.'}))}));
}else fail('Unsupported fixture command '+args.join(' '));
`;
async function fixture(t: TestContext, framework: 'native' | 'langgraph' | 'openai-agents' | 'crewai' = 'native', language: 'typescript' | 'python' = 'typescript') {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-deployment-')), bin = join(root, 'bin'), testHome = join(root, 'home'); await mkdir(bin); await mkdir(testHome);
  const homedirMock = t.mock.method(os, 'homedir', () => testHome); syncBuiltinESMExports();
  for (const engine of ['docker', 'podman']) await writeFile(join(bin, engine), fake, { mode: 0o700 });
  const old = { PATH: process.env.PATH, INSTRILO_FAKE_SECRET: process.env.INSTRILO_FAKE_SECRET, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT, CONTAINER_HOST: process.env.CONTAINER_HOST };
  process.env.PATH = bin; process.env.INSTRILO_FAKE_SECRET = 'this-must-not-reach-the-container-engine'; delete process.env.DOCKER_HOST; delete process.env.DOCKER_CONTEXT; delete process.env.CONTAINER_HOST;
  const spec = defaultSpec('deployment-fixture'); spec.framework = framework; spec.language = language;
  spec.connections = { demo: { kind: 'gateway', model: 'real-production-model', baseUrl: 'https://never-contact.example/v1', auth: { type: 'api-key', env: 'PRODUCTION_MODEL_SECRET' } } };
  spec.delivery.target = 'aws-agentcore'; spec.delivery.port = 8080;
  spec.security = { inbound: { mode: 'jwt', issuer: 'https://identity.example', jwksUrl: 'https://identity.example/jwks', audience: 'production-agent', algorithms: ['RS256'] }, requiredScopes: ['agent:run'] };
  const { dir } = await createProject(root, { name: spec.name, spec }); await buildProject(join(dir, manifestName));
  return { root, dir, bin, scenario: (value: unknown) => writeFile(join(bin, 'scenario.json'), JSON.stringify(value)), state: async () => JSON.parse(await readFile(join(bin, 'engine-state.json'), 'utf8')), saveState: (value: unknown) => writeFile(join(bin, 'engine-state.json'), JSON.stringify(value)), close: async () => { homedirMock.mock.restore(); syncBuiltinESMExports(); for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); } };
}
test('deployment preview is read-only and rejects unsupported local container target', async t => {
  const f = await fixture(t); try {
    const result = await deploymentTest(f.dir); assert.equal(result.kind, 'deployment-test-plan'); assert.equal(result.architecture, 'linux/arm64');
    await assert.rejects(access(join(f.dir, '.instrilo/deployment-tests'))); await assert.rejects(access(join(f.bin, 'engine-state.json')));
    assert.match(JSON.stringify(result), /mock|fixture/); assert.match(JSON.stringify(result), /IAM/);
  } finally { await f.close(); }
});
test('actual execution orchestration preserves selected framework, isolates credentials and retains reports after exact cleanup', async t => {
  const f = await fixture(t, 'langgraph'); try {
    const result = await deploymentTest(f.dir, { execute: true }); assert.equal(result.kind, 'deployment-test-report'); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'passed', JSON.stringify(result)); assert.equal(result.cleanup.complete, true); assert.equal(result.resources.length, 4); assert.ok(result.resources.every(r => r.id && r.removed));
    const state = await f.state(); assert.equal(state.resources.length, 0); assert.equal(state.leakedSecret, null); assert.equal(state.testSpec.framework, 'langgraph');
    assert.equal(state.testSpec.connections.runtime.kind, 'gateway'); assert.match(state.testSpec.connections.runtime.baseUrl, /127\.0\.0\.1/); assert.ok(!JSON.stringify(state.testSpec).includes('production-model')); assert.match(state.dockerfile, /CMD \["node", "dist\/server.js"\]/);
    assert.ok(state.commands.some((a: string[]) => a.includes('--internal'))); assert.ok(!state.commands.flat().includes('--publish')); assert.ok(!state.commands.flat().includes('--volume'));
    assert.equal((await deploymentTestReports(f.dir)).length, 1); assert.match(await readFile(result.reportPath, 'utf8'), /Not verified/);
    await assert.rejects(access(join(f.dir, '.instrilo/deployment-tests', result.id, 'context')));
  } finally { await f.close(); }
});
test('architecture mismatch fails before startup, with report and image cleanup', async t => {
  const f = await fixture(t); try {
    await f.scenario({ wrongArchitecture: true }); const result = await deploymentTest(f.dir, { execute: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'failed'); assert.match(result.error!, /architecture.*linux\/arm64/); assert.equal(result.cleanup.complete, true); assert.equal((await f.state()).resources.length, 0);
  } finally { await f.close(); }
});
test('startup failure recovers exact pending container names and cleans all owned resources', async t => {
  const f = await fixture(t); try {
    await f.scenario({ failAgent: true }); const result = await deploymentTest(f.dir, { execute: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'failed'); assert.equal(result.cleanup.complete, true); assert.equal((await f.state()).resources.length, 0);
  } finally { await f.close(); }
});
test('retained resources require explicit cleanup and mismatched ownership is refused', async t => {
  const f = await fixture(t, 'openai-agents', 'python'); try {
    const result = await deploymentTest(f.dir, { engine: 'docker', execute: true, keep: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'passed', JSON.stringify(result)); assert.equal(result.cleanup.complete, false);
    const before = await f.state(), preview = await deploymentTestCleanup(f.dir, result.id); assert.equal(preview.execute, false); assert.equal((await f.state()).commands.length, before.commands.length);
    const agent = before.resources.find((r: any) => r.Name.endsWith('-agent')); const original = agent.Labels['io.instrilo.deployment-test']; agent.Labels['io.instrilo.deployment-test'] = 'foreign'; await f.saveState(before);
    const refused = await deploymentTestCleanup(f.dir, result.id, { execute: true }); assert.ok('complete' in refused && !refused.complete); assert.match(JSON.stringify(refused), /ownership labels/);
    const after = await f.state(); assert.ok(after.resources.some((r: any) => r.Id === agent.Id)); after.resources.find((r: any) => r.Id === agent.Id).Labels['io.instrilo.deployment-test'] = original; await f.saveState(after);
    const complete = await deploymentTestCleanup(f.dir, result.id, { execute: true }); assert.ok('complete' in complete && complete.complete); assert.equal((await f.state()).resources.length, 0);
    const again = await deploymentTestCleanup(f.dir, result.id, { execute: true }); assert.ok('complete' in again && again.complete); await access(result.reportPath);
  } finally { await f.close(); }
});
test('cancellation terminates a pending build and cleans an image created before command exit', async t => {
  const f = await fixture(t); try {
    await f.scenario({ hangBuild: true }); const control = new AbortController();
    const pending = deploymentTest(f.dir, { execute: true, signal: control.signal });
    let seen = false;
    for (let i = 0; i < 200; i++) { try { if ((await f.state()).resources.length) { seen = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.ok(seen); control.abort(); const result = await pending; if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'cancelled'); assert.equal(result.cleanup.complete, true); assert.equal((await f.state()).resources.length, 0);
  } finally { await f.close(); }
});
test('modified generated source is rejected before engine operations, with retained evidence', async t => {
  const f = await fixture(t); try {
    await writeFile(join(f.dir, 'generated/server.ts'), 'modified'); const result = await deploymentTest(f.dir, { execute: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'failed'); assert.match(result.error!, /changed after generation/); assert.equal(result.resources.length, 0); await access(result.reportPath); await assert.rejects(access(join(f.bin, 'engine-state.json')));
  } finally { await f.close(); }
});
test('failed HTTP probes produce a failed result rather than a false successful deployment claim', async t => {
  const f = await fixture(t); try {
    await f.scenario({ failProbe: true }); const result = await deploymentTest(f.dir, { execute: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'failed'); assert.ok(result.checks.some(c => c.name === 'Health endpoint' && !c.passed)); assert.equal(result.cleanup.complete, true);
  } finally { await f.close(); }
});

test('cleanup refuses a changed engine identity and leaves the original resource inventory intact', async t => {
  const f = await fixture(t); try {
    const result = await deploymentTest(f.dir, { execute: true, keep: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'passed'); assert.match(result.engineIdentity!, /^[a-f0-9]{64}$/);
    await f.scenario({ endpoint: 'unix:///different-engine/docker.sock' });
    await assert.rejects(deploymentTestCleanup(f.dir, result.id, { execute: true }), /endpoint identity changed/);
    assert.equal((await f.state()).resources.length, 4);
    const saved = (await deploymentTestReports(f.dir))[0]; assert.ok(saved.resources.every(r => !r.removed));
    await f.scenario({}); const cleaned = await deploymentTestCleanup(f.dir, result.id, { execute: true }); assert.ok('complete' in cleaned && cleaned.complete);
  } finally { await f.close(); }
});

test('cleanup is a successful no-op without any engine when a test created no resources', async t => {
  const f = await fixture(t); try {
    await rm(join(f.bin, 'docker')); const result = await deploymentTest(f.dir, { execute: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'failed'); assert.equal(result.resources.length, 0);
    const cleanup = await deploymentTestCleanup(f.dir, result.id, { execute: true }); assert.ok('complete' in cleanup && cleanup.complete);
    assert.equal((await deploymentTestReports(f.dir))[0].status, 'failed');
  } finally { await f.close(); }
});

test('missing engine socket is a cleanup failure, while an explicitly absent resource is already clean', async t => {
  const f = await fixture(t); try {
    const result = await deploymentTest(f.dir, { execute: true, keep: true }); if (result.kind !== 'deployment-test-report') return;
    assert.equal(result.status, 'passed');
    await f.scenario({ failInspectTransport: true });
    const unavailable = await deploymentTestCleanup(f.dir, result.id, { execute: true });
    assert.ok('complete' in unavailable && !unavailable.complete);
    assert.ok('resources' in unavailable && unavailable.resources.every(resource => !resource.removed));
    assert.equal((await f.state()).resources.length, 4);
    assert.ok('errors' in unavailable && unavailable.errors.length === 4);
    const persisted = (await deploymentTestReports(f.dir))[0]; assert.ok(persisted.resources.every(resource => !resource.removed));
    // A resource removed outside Instrilo produces an actual "No such object" reply.
    await f.scenario({}); const state = await f.state(); state.resources.pop(); await f.saveState(state);
    const cleaned = await deploymentTestCleanup(f.dir, result.id, { execute: true });
    assert.ok('complete' in cleaned && cleaned.complete); assert.equal((await f.state()).resources.length, 0);
  } finally { await f.close(); }
});
