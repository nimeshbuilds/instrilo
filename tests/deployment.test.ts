import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { saveSpec } from '../src/core.js';
import { buildProject, createProject, manifestName } from '../src/workbench.js';

const repository = fileURLToPath(new URL('../', import.meta.url));

test('deploy requires explicit execution and refuses stale source before launching any script', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nb-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { dir, spec } = await createProject(root, { name: 'delivery-test' });
  spec.connections.gateway = { kind: 'gateway', model: 'test-fixture', baseUrl: 'https://provider.invalid/v1', auth: { type: 'none' } };
  spec.roles.runtime = 'gateway';
  spec.delivery.target = 'docker';
  spec.security.inbound = { mode: 'jwt', issuer: 'https://identity.invalid/', audience: 'delivery-test', jwksUrl: 'https://identity.invalid/jwks', algorithms: ['RS256'] };
  const manifest = join(dir, manifestName);
  await saveSpec(manifest, spec);
  await buildProject(manifest);
  const binaries = join(root, 'bin'), marker = join(root, 'launcher.json');
  await mkdir(binaries);
  // This inert bash replacement records dispatch only; no Docker/cloud command runs.
  await writeFile(join(binaries, 'bash'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.NB_DEPLOY_TEST_MARKER,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n`, { mode: 0o755 });
  const invoke = (execute: boolean) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(repository, 'node_modules/tsx/dist/cli.mjs'), join(repository, 'src/cli.ts'), 'deploy', dir, ...(execute ? ['--execute'] : [])], {
      cwd: repository, shell: false, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PATH: `${binaries}:${process.env.PATH}`, NB_DEPLOY_TEST_MARKER: marker },
    });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Deployment test timed out')); }, 10000);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stderr }); });
  });
  let result = await invoke(false);
  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  result = await invoke(true);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), {
    args: [join(dir, 'generated/deploy/docker.sh')], cwd: await realpath(join(dir, 'generated')),
  });
  await rm(marker);
  spec.agent.systemPrompt = 'Changed instructions that are absent from the generated runtime.';
  await saveSpec(manifest, spec);
  result = await invoke(true);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /configuration changed|rebuild/i);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  await buildProject(manifest, undefined, true);
  await writeFile(join(dir, 'generated/guidance.md'), 'Tampered generated instructions.');
  result = await invoke(true);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /guidance.*changed|rebuild/i);
  await assert.rejects(access(marker), { code: 'ENOENT' });
});
