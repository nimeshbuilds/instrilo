import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { containerEngineCleanupPlan, containerEngineInstallPlan, containerEngineInvocation, containerEngineStartPlan, containerEngineStatus, cleanupContainerEngine, installContainerEngine, startContainerEngine } from '../src/container-engines.js';

const MACHINE = 'instrilo-deployment-tests';
const providerScript = `
if(args[0]==='--version'){console.log('podman version 5.6.1 PRIVATE-IDENTITY');}
else if(args[0]==='machine'&&args[1]==='list'){console.log(JSON.stringify(state.machines));}
else if(args[0]==='machine'&&args[1]==='inspect'){
 const m=state.machines.find(m=>m.Name===args[2]);
 if(!m)process.exitCode=1;else console.log(JSON.stringify([{...m,Created:state.created||'2026-09-24T10:00:00Z',SSHConfig:{Port:43219,IdentityPath:'/private/key',RemoteUsername:'core'}}]));
}
else if(args[0]==='machine'&&args[1]==='init'){state.machines.push({Name:args.at(-1),Running:false});save();}
else if(args[0]==='machine'&&args[1]==='start'){state.machines.find(m=>m.Name===args.at(-1)).Running=true;save();}
else if(args[0]==='machine'&&args[1]==='rm'){state.machines=state.machines.filter(m=>m.Name!==args.at(-1));save();}
else if(args.slice(0,3).join(' ')==='system connection list'){
 console.log(JSON.stringify(state.connections||state.machines.flatMap(m=>[{Name:m.Name,IsMachine:true,Identity:'/private/key',URI:'ssh://core@127.0.0.1:43219/run/user/1000/podman/podman.sock'},{Name:m.Name+'-root',IsMachine:true,Identity:'/private/key',URI:'ssh://root@127.0.0.1:43219/run/podman/podman.sock'}])));
}
else {
 const effective=args[0]==='--url'?args.slice(4):args[0]==='--connection'||args[0]==='--context'||args[0]==='--host'?args.slice(2):args[0]==='--remote=false'?args.slice(1):args[0]==='machine'&&args[1]==='ssh'?args.slice(args.indexOf('podman')+1):args;
 if(effective[0]==='info'){
  if(state.unavailable||(!state.unmanaged&& !state.machines.some(m=>m.Running))){console.error('PRIVATE error');process.exitCode=125;}
  else console.log(JSON.stringify({host:{os:state.os||'linux'},store:{graphRoot:state.graphRoot||'/test/podman/storage',runRoot:'/test/podman/run'},OSType:state.os||'linux',privateToken:'PRIVATE-TOKEN'}));
 }else if(effective[0]==='context'&&effective[1]==='inspect'){console.log(JSON.stringify([{Name:state.contextName||'default',Endpoints:{docker:{Host:state.dockerHost||'unix:///test/docker.sock'}},...(state.tls?{TLSMaterial:{docker:['ca.pem','cert.pem','key.pem']}}:{})}]));
 }else if(effective[0]==='ps'){if(state.containers)console.log(state.containers);}
 else if(effective[0]==='images'){if(state.images)console.log(state.images);}
 else if(effective[0]==='volume'){if(state.volumes)console.log(state.volumes);}
 else if(effective[0]==='network'){console.log(state.networks||'podman');}
 else {console.error('PRIVATE unsupported');process.exitCode=99;}
}
`;
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(os.tmpdir(), 'instrilo-engines-')), bin = join(root, 'bin'), statePath = join(root, 'fixture.json'), callsPath = join(root, 'calls.jsonl');
  await mkdir(bin); await writeFile(statePath, JSON.stringify({ machines: [], installed: false }));
  t.mock.method(os, 'homedir', () => root);
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'darwin' });
  const keys = ['PATH', 'ENGINE_FIX_STATE', 'ENGINE_FIX_LOG', 'ENGINE_FIX_TEMPLATE', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'CONTAINER_HOST', 'CONTAINER_CONNECTION'];
  const previous = new Map(keys.map(key => [key, process.env[key]])); for (const key of keys) delete process.env[key];
  process.env.PATH = bin; process.env.ENGINE_FIX_STATE = statePath; process.env.ENGINE_FIX_LOG = callsPath;
  const receipt = join(root, '.local/share/instrilo/container-engines/podman.json');
  t.after(async () => { t.mock.restoreAll(); Object.defineProperty(process, 'platform', platformDescriptor); for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  const prelude = "const fs=require('node:fs'); const args=process.argv.slice(2); const state=JSON.parse(fs.readFileSync(process.env.ENGINE_FIX_STATE,'utf8')); const save=()=>fs.writeFileSync(process.env.ENGINE_FIX_STATE,JSON.stringify(state)); fs.appendFileSync(process.env.ENGINE_FIX_LOG,JSON.stringify({binary:require('node:path').basename(process.argv[1]),args})+'\\n');\n";
  async function binary(name: string, body: string) { const path = join(bin, name); await writeFile(path, '#!' + process.execPath + '\n' + prelude + body); await chmod(path, 0o755); return path; }
  async function state(patch: object) { const previous = JSON.parse(await readFile(statePath, 'utf8')); await writeFile(statePath, JSON.stringify({ ...previous, ...patch })); }
  async function calls(): Promise<{binary:string;args:string[]}[]> { try { return (await readFile(callsPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; } }
  const template = join(root, 'podman-template'); await writeFile(template, '#!' + process.execPath + '\n' + prelude + providerScript); process.env.ENGINE_FIX_TEMPLATE = template;
  async function brew(body?: string) { return binary('brew', body ?? `
if(args[0]==='list'){if(state.installed)console.log('podman 5.6.1');else process.exitCode=1;}
else if(args[0]==='install'){state.installed=true;save();const target=require('node:path').join(require('node:path').dirname(process.argv[1]),'podman');fs.copyFileSync(process.env.ENGINE_FIX_TEMPLATE,target);fs.chmodSync(target,0o755);console.error('PRIVATE installer output');}
else if(args[0]==='uses'){if(state.dependent)console.log('foreign-formula');}
else if(args[0]==='uninstall'){fs.unlinkSync(require('node:path').join(require('node:path').dirname(process.argv[1]),'podman'));state.installed=false;save();}
else process.exitCode=2;
`); }
  return { root, bin, receipt, binary, state, calls, brew, platform: (value: string) => Object.defineProperty(process, 'platform', { ...platformDescriptor, value }) };
}

test('engine plans identify host prerequisites, reviewed commands, and platform limits', async t => {
  const f = await fixture(t);
  const podman = containerEngineInstallPlan('podman'); assert.deepEqual(podman.args, ['install', 'podman']); assert.equal(podman.requiresConsent, true); assert.ok(podman.impact.some(line => /community/.test(line)));
  assert.deepEqual(containerEngineInstallPlan('docker').args, ['install', '--cask', 'docker-desktop']);
  assert.equal(containerEngineStartPlan('podman').commands?.[1].args.join(' '), 'machine start --update-connection=false ' + MACHINE);
  f.platform('linux'); assert.equal(containerEngineInstallPlan('podman').supported, false); assert.ok(containerEngineInstallPlan('podman').steps.some(line => /apt-get/.test(line))); assert.ok(containerEngineInstallPlan('docker').steps.some(line => /Buildx/.test(line)));
  f.platform('win32'); assert.ok(containerEngineInstallPlan('docker').steps.some(line => /WSL2/.test(line))); assert.equal(containerEngineStartPlan('podman').supported, false);
  f.platform('freebsd'); assert.equal(containerEngineInstallPlan('docker').supported, false);
  assert.throws(() => containerEngineInstallPlan('podman; rm' as any), /Choose/);
  assert.deepEqual(await f.calls(), []);
});

test('status distinguishes CLI availability from Linux server readiness without exposing raw diagnostics', async t => {
  const f = await fixture(t); assert.equal((await containerEngineStatus('podman')).installed, false);
  f.platform('linux');
  await f.binary('podman', providerScript);
  const installed = await containerEngineStatus('podman'); assert.equal(installed.installed, true); assert.equal(installed.ready, false); assert.equal(installed.version, '5.6.1'); assert.ok(!JSON.stringify(installed).includes('PRIVATE'));
  await f.state({ unmanaged: true }); assert.equal((await containerEngineStatus('podman')).ready, true);
  await f.state({ os: 'windows' }); assert.equal((await containerEngineStatus('podman')).ready, false);
  await f.binary('docker', "if(args[0]==='--version')console.log('Docker version 27.2.1');else{console.error('PRIVATE daemon error');process.exitCode=1;}");
  assert.equal((await containerEngineStatus('docker')).ready, false);
  const invocation = await containerEngineInvocation('podman'); assert.equal(invocation.executable, join(f.bin, 'podman')); assert.deepEqual(invocation.args, ['--remote=false']); assert.match(invocation.identity, /^[a-f0-9]{64}$/);
});

test('mutations require consent; install does not replace or adopt an existing runtime', async t => {
  const f = await fixture(t);
  for (const operation of [installContainerEngine, startContainerEngine, cleanupContainerEngine]) await assert.rejects(operation('podman', { consent: false }), /explicit consent/);
  assert.deepEqual(await f.calls(), []);
  await f.binary('podman', providerScript); await f.state({ unmanaged: true });
  assert.equal((await installContainerEngine('podman', { consent: true })).installed, true);
  assert.equal((await containerEngineCleanupPlan('podman')).owned, false);
  await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /Pre-existing/);
  await assert.rejects(access(f.receipt), { code: 'ENOENT' });
  assert.ok((await f.calls()).every(call => !['install', 'uninstall'].includes(call.args[0])));
});

test('new package and dedicated VM are recorded, selected explicitly, and cleaned without shared prune', async t => {
  const f = await fixture(t); await f.brew(); const messages: string[] = [];
  const installed = await installContainerEngine('podman', { consent: true, onProgress: message => messages.push(message) });
  assert.equal(installed.installed, true); assert.equal(installed.ready, false);
  assert.ok(JSON.parse(await readFile(f.receipt, 'utf8')).installation);
  const ready = await startContainerEngine('podman', { consent: true }); assert.equal(ready.ready, true); assert.equal(ready.connection, MACHINE);
  assert.deepEqual((await containerEngineInvocation('podman')).args, ['--url', 'ssh://core@127.0.0.1:43219/run/user/1000/podman/podman.sock', '--identity', '/private/key']);
  const plan = await containerEngineCleanupPlan('podman'); assert.equal(plan.supported, true); assert.equal(plan.commands?.length, 2);
  const result = await cleanupContainerEngine('podman', { consent: true }); assert.equal(result.removed.length, 2); assert.ok(result.retained.some(value => /shared dependencies/.test(value)));
  await assert.rejects(access(f.receipt), { code: 'ENOENT' }); assert.equal((await containerEngineStatus('podman')).installed, false);
  const calls = await f.calls(); assert.ok(calls.some(call => call.args.join(' ') === 'machine ssh --username root ' + MACHINE + ' podman volume ls --quiet'));
  assert.ok(calls.every(call => !call.args.includes('prune') && !call.args.includes('reset') && !call.args.includes('autoremove')));
  assert.ok(!messages.join(' ').includes('PRIVATE'));
});

test('owned VM cleanup preserves a pre-existing package and refuses foreign stored resources', async t => {
  const f = await fixture(t); await f.binary('podman', providerScript); await startContainerEngine('podman', { consent: true });
  for (const field of ['containers', 'images', 'volumes']) {
    await f.state({ [field]: 'foreign-resource' });
    await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /foreign or unclassified/);
    await f.state({ [field]: '' });
  }
  await f.state({ networks: 'podman\nuser-network' }); await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /unknown network/); await f.state({ networks: 'podman' });
  const result = await cleanupContainerEngine('podman', { consent: true }); assert.deepEqual(result.removed, ['Podman VM ' + MACHINE]); assert.ok(result.retained.includes('The pre-existing Podman installation'));
  assert.equal((await containerEngineStatus('podman')).installed, true);
  assert.ok(!(await f.calls()).some(call => call.binary === 'brew'));
});

test('unowned machine, other running machine, and replaced machine never become cleanup targets', async t => {
  const f = await fixture(t); await f.binary('podman', providerScript);
  await f.state({ machines: [{ Name: MACHINE, Running: false }] }); await assert.rejects(startContainerEngine('podman', { consent: true }), /without an ownership receipt/);
  await f.state({ machines: [{ Name: 'user-machine', Running: true }] }); await assert.rejects(startContainerEngine('podman', { consent: true }), /Another Podman VM/);
  await f.state({ machines: [] }); await startContainerEngine('podman', { consent: true });
  await f.state({ created: '2026-09-25T10:00:00Z' });
  await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /replaced/);
  await assert.rejects(startContainerEngine('podman', { consent: true }), /replaced/);
  await assert.rejects(containerEngineInvocation('podman'), /replaced/);
  assert.ok(!(await f.calls()).some(call => call.args[0] === 'machine' && call.args[1] === 'rm'));
});

test('managed connection redirection is rejected before deployment commands can use it', async t => {
  const f = await fixture(t); await f.binary('podman', providerScript); await startContainerEngine('podman', { consent: true });
  await f.state({ connections: [{ Name: MACHINE, IsMachine: true, Identity: '/private/key', URI: 'ssh://core@remote.invalid:43219/run/podman.sock' }] });
  await assert.rejects(containerEngineInvocation('podman'), /no longer matches its local VM/);
  assert.equal((await containerEngineStatus('podman')).ready, false);
});

test('foreign VMs, connections, and Homebrew dependents prevent removal of an owned package', async t => {
  const f = await fixture(t); await f.brew(); await installContainerEngine('podman', { consent: true });
  await f.state({ machines: [{ Name: 'foreign', Running: false }] }); await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /Other Podman VMs/);
  await f.state({ machines: [], connections: [{ Name: 'foreign' }] }); await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /Other or unrecognized/);
  await f.state({ connections: [], dependent: true }); await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /depend on Podman/);
  assert.ok(!(await f.calls()).some(call => call.args[0] === 'uninstall'));
});

test('changed runtime executable and unsafe receipts cannot authorize cleanup', async t => {
  const f = await fixture(t); await f.brew(); await installContainerEngine('podman', { consent: true });
  await rename(join(f.bin, 'podman'), join(f.bin, 'old-podman')); await f.binary('podman', providerScript);
  await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /executable changed/);
  const originalReceipt = await readFile(f.receipt, 'utf8'); await rm(f.receipt); const elsewhere = join(f.root, 'receipt-copy'); await writeFile(elsewhere, originalReceipt); await symlink(elsewhere, f.receipt);
  await assert.rejects(containerEngineCleanupPlan('podman'));
  assert.ok(!(await f.calls()).some(call => call.args[0] === 'uninstall'));
});

test('Homebrew pre-existing package is not adopted, and failure logs remain private', async t => {
  const f = await fixture(t); await f.brew(); await f.state({ installed: true });
  await assert.rejects(installContainerEngine('podman', { consent: true }), /already installed by Homebrew/); await assert.rejects(access(f.receipt), { code: 'ENOENT' });
  await f.brew("if(args[0]==='list')process.exitCode=1;else{console.error('PRIVATE brew failure');process.exitCode=5;}");
  await assert.rejects(installContainerEngine('podman', { consent: true }), error => /installation did not complete/.test(String(error)) && !String(error).includes('PRIVATE'));
  await assert.rejects(access(f.receipt), { code: 'ENOENT' });
});

test('installation cancellation kills the installer, releases its lock, and does not invent ownership', async t => {
  const f = await fixture(t); const started = join(f.root, 'started'), childMarker = join(f.root, 'child-survived');
  await f.brew(`if(args[0]==='list')process.exitCode=1;else{fs.writeFileSync(${JSON.stringify(started)},'started');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify('setTimeout(()=>require("node:fs").writeFileSync(' + JSON.stringify(childMarker) + ',"survived"),1000);')}],{stdio:'ignore'});setInterval(()=>{},1000);}`);
  const controller = new AbortController(); const installation = installContainerEngine('podman', { consent: true, signal: controller.signal });
  for (let count = 0; count < 200; count++) { try { await access(started); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  await access(started); await assert.rejects(installContainerEngine('podman', { consent: true }), /Another container engine operation/);
  controller.abort(); await assert.rejects(installation, /cancelled/);
  await assert.rejects(access(f.receipt), { code: 'ENOENT' }); await assert.rejects(access(join(f.root, '.local/share/instrilo/container-engines/podman.lock')), { code: 'ENOENT' });
  await new Promise(resolve => setTimeout(resolve, 1100)); await assert.rejects(access(childMarker), { code: 'ENOENT' });
});

test('Docker shared cleanup remains an explicit manual workflow', async t => {
  await fixture(t); const plan = await containerEngineCleanupPlan('docker'); assert.equal(plan.supported, false); assert.equal(plan.owned, false);
  await assert.rejects(cleanupContainerEngine('docker', { consent: true }), /Pre-existing/);
});

test('Docker invocation rejects remote contexts and environment endpoints, pins local selection, and fingerprints endpoint changes', async t => {
  const f = await fixture(t); await f.binary('docker', providerScript); await f.state({ unmanaged: true });
  const local = await containerEngineInvocation('docker'); assert.deepEqual(local.args, ['--host', 'unix:///test/docker.sock']); assert.match(local.identity, /^[a-f0-9]{64}$/);
  for (const dockerHost of ['ssh://prod.example', 'tcp://prod.example:2375', 'http://127.0.0.1:2375', 'unix://remote/docker.sock', 'tcp://user:SECRET@localhost:2375']) {
    await f.state({ dockerHost }); await assert.rejects(containerEngineInvocation('docker'), error => /remote or could not be verified/.test(String(error)) && !String(error).includes('SECRET'));
  }
  await f.state({ dockerHost: 'unix:///test/another.sock' }); assert.notEqual((await containerEngineInvocation('docker')).identity, local.identity);
  process.env.DOCKER_HOST = 'ssh://prod.example'; await assert.rejects(containerEngineInvocation('docker'), /remote DOCKER_HOST/);
  process.env.DOCKER_HOST = 'tcp://127.0.0.1:2375'; assert.deepEqual((await containerEngineInvocation('docker')).args, ['--host', 'tcp://127.0.0.1:2375']);
  process.env.DOCKER_CONTEXT = 'default'; process.env.DOCKER_HOST = 'ssh://ignored.example'; assert.deepEqual((await containerEngineInvocation('docker')).args, ['--host', 'unix:///test/another.sock']);
  assert.equal((await containerEngineStatus('docker')).ready, true);
  await f.state({ dockerHost: 'tcp://127.0.0.1:2376', tls: true }); await assert.rejects(containerEngineInvocation('docker'), /TCP context uses TLS settings/);
});

test('Podman Linux forces local execution and rejects remote environment overrides', async t => {
  const f = await fixture(t); f.platform('linux'); await f.binary('podman', providerScript); await f.state({ unmanaged: true });
  const local = await containerEngineInvocation('podman'); assert.deepEqual(local.args, ['--remote=false']);
  await f.state({ graphRoot: '/another/storage' }); assert.notEqual((await containerEngineInvocation('podman')).identity, local.identity);
  process.env.CONTAINER_HOST = 'ssh://prod.example'; await assert.rejects(containerEngineInvocation('podman'), /Unset CONTAINER_HOST/); delete process.env.CONTAINER_HOST;
  process.env.CONTAINER_CONNECTION = 'production'; await assert.rejects(containerEngineInvocation('podman'), /Unset CONTAINER_HOST/);
  assert.equal((await containerEngineStatus('podman')).ready, false);
});

test('explicit whole-machine cleanup inventories and removes only the owned VM disk including retained test caches', async t => {
  const f = await fixture(t); await f.binary('podman', providerScript); await startContainerEngine('podman', { consent: true });
  await f.state({ images: 'sha256:base-image-cache', volumes: 'extra-work', containers: 'container-id', networks: 'podman\nproject-network' });
  const plan = await containerEngineCleanupPlan('podman', { removeMachineData: true });
  assert.equal(plan.supported, true); assert.equal(plan.machineStorage?.machine, MACHINE); assert.deepEqual(plan.machineStorage?.rootless.images, ['sha256:base-image-cache']); assert.deepEqual(plan.machineStorage?.rootful.volumes, ['extra-work']);
  assert.ok(plan.impact.some(line => /entire owned VM disk/.test(line)));
  await assert.rejects(cleanupContainerEngine('podman', { consent: true }), /foreign or unclassified/);
  const result = await cleanupContainerEngine('podman', { consent: true, removeMachineData: true });
  assert.deepEqual(result.removed, ['Podman VM ' + MACHINE]); assert.ok(result.message.includes('disk were removed'));
  assert.ok(result.retained.includes('The pre-existing Podman installation'));
  assert.ok((await f.calls()).every(call => !call.args.includes('prune') && !call.args.includes('reset')));
});

test('whole-machine removal cannot target unowned data or proceed with unreadable inventory', async t => {
  const f = await fixture(t); await f.binary('podman', providerScript);
  assert.equal((await containerEngineCleanupPlan('podman', { removeMachineData: true })).supported, false);
  await assert.rejects(cleanupContainerEngine('podman', { consent: true, removeMachineData: true }), /Pre-existing/);
  await startContainerEngine('podman', { consent: true }); await f.state({ volumes: 'unrecognized value with spaces' });
  await assert.rejects(containerEngineCleanupPlan('podman', { removeMachineData: true }), /inventory is unrecognized/);
  await assert.rejects(cleanupContainerEngine('podman', { consent: true, removeMachineData: true }), /inventory is unrecognized/);
  assert.ok(!(await f.calls()).some(call => call.args[1] === 'rm'));
});
