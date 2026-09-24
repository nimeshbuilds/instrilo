import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateArtifacts, writeArtifacts } from '../src/generators.js';
import type { GuidanceReport, Language, ProjectSpec } from '../src/types.js';

const repository = fileURLToPath(new URL('..', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const pythonProbe = spawnSync(process.env.PYTHON ?? 'python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
const python = pythonProbe.status === 0 ? pythonProbe.stdout.trim() : undefined;
const providers = ['codex', 'claude', 'grok'] as const;
type Provider = typeof providers[number];
const kinds = { codex: 'codex-cli', claude: 'claude-code', grok: 'grok-cli' } as const;
const guidance: GuidanceReport = { root: 'guidance', files: [], combined: 'Use the supplied guidance.', issues: [], missing: [] };

function spec(language: Language): ProjectSpec {
  return {
    schemaVersion: '1', name: 'subscription-runtime-test', description: 'Local provider discovery fixture', language, framework: 'native', guidanceDir: 'guidance',
    connections: { runtime: { kind: 'codex-cli', auth: { type: 'none' }, model: 'test-model' } }, roles: { builder: 'runtime', runtime: 'runtime', judge: 'runtime' },
    agent: { systemPrompt: 'Be concise.', tools: [], limits: { maxSteps: 2, timeoutMs: 5000, maxOutputTokens: 50 } },
    evaluation: { dataset: 'evals/cases.jsonl', rubric: 'evals/rubric.md', threshold: 0.8 },
    security: { inbound: { mode: 'none', algorithms: ['RS256'] }, requiredScopes: [] }, delivery: { target: 'local', hosts: [], port: 8080 },
  };
}

async function fixture(language: Language) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-subscription-runtime-'));
  const project = join(root, 'project'), home = join(root, 'home'), managed = join(root, 'managed providers'), preload = join(root, 'fixture-home.cjs');
  await writeArtifacts(project, generateArtifacts(spec(language), guidance));
  await mkdir(home);
  await writeFile(preload, `require('node:os').homedir = () => ${JSON.stringify(home)};
const childProcess = require('node:child_process'), originalSpawn = childProcess.spawn;
childProcess.spawn = function(command, ...args) {
  if (command !== process.execPath && command !== ${JSON.stringify(join(repository, 'node_modules/@esbuild', process.platform + '-' + process.arch, 'bin/esbuild'))} && !command.startsWith(${JSON.stringify(root)} + require('node:path').sep)) throw new Error('Fixture refused an executable outside its isolated directory');
  return originalSpawn.call(this, command, ...args);
};
require('node:module').syncBuiltinESMExports();`);
  // The exercised CLI branch has no HTTP/schema dependency. Stubs fail closed if
  // dispatch accidentally reaches either instead of executing the fake provider.
  if (language === 'typescript') {
    const ajv = join(project, 'node_modules/ajv'); await mkdir(ajv, { recursive: true });
    await writeFile(join(ajv, 'package.json'), JSON.stringify({ name: 'ajv', type: 'module', exports: './index.js' }));
    await writeFile(join(ajv, 'index.js'), 'export class Ajv { compile() { throw new Error("Unexpected schema validation"); } }');
    await writeFile(join(project, 'fixture.ts'), `import { CONNECTION, context, resolveProviderExecutable, runNative } from './runtime.js';
globalThis.fetch = async () => { throw new Error('Unexpected network call'); };
try {
  if (process.argv[2] === 'resolve') console.log(JSON.stringify({ path: await resolveProviderExecutable(process.argv[3]) }));
  else { CONNECTION.kind = process.argv[3]; console.log(JSON.stringify({ result: await runNative('A local prompt', context([], [])) })); }
} catch (error) { console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
`);
  } else {
    await writeFile(join(project, 'fixture.py'), `import asyncio, json, sys, types
from pathlib import Path
Path.home = classmethod(lambda cls: Path(${JSON.stringify(home)}))
httpx = types.ModuleType('httpx')
def unexpected(*args, **kwargs): raise RuntimeError('Unexpected network or schema validation')
httpx.AsyncClient = unexpected
sys.modules['httpx'] = httpx
jsonschema = types.ModuleType('jsonschema')
jsonschema.Draft7Validator = unexpected
sys.modules['jsonschema'] = jsonschema
from runtime import CONNECTION, context, resolve_provider_executable, run_native
try:
    if sys.argv[1] == 'resolve': print(json.dumps({'path': resolve_provider_executable(sys.argv[2])}))
    else:
        CONNECTION['kind'] = sys.argv[2]
        print(json.dumps({'result': asyncio.run(run_native('A local prompt', context([], [])))}))
except Exception as error:
    print(json.dumps({'error': str(error)}))
    sys.exit(1)
`);
  }
  async function run(mode: 'resolve' | 'invoke', provider: string, changes: Record<string, string | undefined> = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: '', INSTRILO_PROVIDER_HOME: managed, INSTRILO_DURABLE_RUN: '0', INSTRILO_REPLAY: '0', ...changes };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    const command = language === 'typescript' ? process.execPath : python!;
    const args = language === 'typescript' ? ['--require', preload, '--import', tsxLoader, join(project, 'fixture.ts'), mode, provider] : [join(project, 'fixture.py'), mode, provider];
    return new Promise<{ code: number | null; data: { path?: string; result?: string; error?: string } }>((resolve, reject) => {
      const child = spawn(command, args, { cwd: project, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        try { resolve({ code, data: JSON.parse(stdout) }); } catch { reject(new Error('Runtime fixture did not emit JSON: ' + stderr + stdout)); }
      });
    });
  }
  return { root, project, home, managed, run, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function fakeBinary(directory: string, provider: Provider, marker: string, target?: string) {
  const path = join(directory, provider); await mkdir(directory, { recursive: true });
  const file = target ?? path;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2), input = fs.readFileSync(0, 'utf8');
if (process.env.INSTRILO_FIXTURE_CAPTURE) fs.writeFileSync(process.env.INSTRILO_FIXTURE_CAPTURE, JSON.stringify({args,input}));
console.log(JSON.stringify(${JSON.stringify(provider)} === 'codex' ? {type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(marker)}}} : {result:${JSON.stringify(marker)}}));
`, { mode: 0o755 });
  if (target) await symlink(target, path);
  return path;
}

for (const language of ['typescript', 'python'] as const) {
  const options = { skip: process.platform === 'win32' ? 'POSIX fake executable fixtures; Windows command shims explicitly require WSL.' : language === 'python' && !python ? 'Python is not installed.' : false, timeout: 30000 };
  test(`${language} generated runtime invokes all managed subscription CLIs with intact arguments`, options, async t => {
    const f = await fixture(language); t.after(f.cleanup);
    for (const provider of providers) {
      const capture = join(f.root, provider + '.capture.json');
      await fakeBinary(join(f.managed, 'bin'), provider, provider + '-managed', join(f.managed, 'packages', provider + '.cjs'));
      const result = await f.run('invoke', kinds[provider], { INSTRILO_FIXTURE_CAPTURE: capture });
      assert.equal(result.code, 0); assert.equal(result.data.result, provider + '-managed');
      const call = JSON.parse(await readFile(capture, 'utf8')) as { args: string[]; input: string };
      assert.equal(call.args[call.args.indexOf('--model') + 1], 'test-model');
      if (provider === 'grok') { assert.equal(call.input, ''); assert.match(call.args[call.args.indexOf('-p') + 1], /A local prompt/); }
      else assert.match(call.input, /Use the supplied guidance\.[\s\S]*A local prompt/);
      assert.ok(call.args.includes(provider === 'codex' ? '--sandbox' : '--tools'));
    }
  });

  test(`${language} generated discovery follows PATH, managed prefix, local bin, then bun bin`, options, async t => {
    const f = await fixture(language); t.after(f.cleanup);
    const pathDir = join(f.root, 'path bin'), managedBin = join(f.home, '.local/share/instrilo/providers/bin');
    const candidates = [pathDir, managedBin, join(f.home, '.local/bin'), join(f.home, '.bun/bin')];
    for (const [i, directory] of candidates.entries()) await fakeBinary(directory, 'claude', 'location-' + i);
    const env = { INSTRILO_PROVIDER_HOME: undefined, PATH: pathDir };
    for (const [i, directory] of candidates.entries()) {
      const resolved = await f.run('resolve', 'claude', env); assert.equal(resolved.data.path, join(directory, 'claude'));
      const result = await f.run('invoke', 'claude-code', env); assert.equal(result.data.result, 'location-' + i);
      await rm(join(directory, 'claude'));
    }
    const override = await fakeBinary(join(f.managed, 'bin'), 'claude', 'absolute-override');
    assert.equal((await f.run('resolve', 'claude')).data.path, override);
  });

  test(`${language} generated discovery rejects unsafe locations and explains missing providers`, options, async t => {
    const f = await fixture(language); t.after(f.cleanup);
    await fakeBinary(f.project, 'codex', 'must-not-run-current-directory');
    await fakeBinary(join(f.project, 'relative-bin'), 'codex', 'must-not-run-relative-path');
    const nonexec = await fakeBinary(join(f.root, 'not-executable'), 'codex', 'must-not-run-nonexecutable'); await chmod(nonexec, 0o644);
    const directory = join(f.root, 'directory-candidate'); await mkdir(join(directory, 'codex'), { recursive: true });
    const linked = join(f.root, 'linked-directory'); await mkdir(linked); await symlink(directory, join(linked, 'codex'));
    const unsafePath = ['', '.', 'relative-bin', dirname(nonexec), directory, linked, ''].join(delimiter);
    for (const provider of providers) {
      const missing = await f.run('invoke', kinds[provider], { PATH: unsafePath });
      assert.equal(missing.code, 1); assert.match(missing.data.error!, new RegExp('instrilo setup ' + provider));
    }
    for (const override of ['', 'relative-prefix']) {
      const invalid = await f.run('resolve', 'codex', { PATH: f.project, INSTRILO_PROVIDER_HOME: override });
      assert.equal(invalid.code, 1); assert.match(invalid.data.error!, /INSTRILO_PROVIDER_HOME must be an absolute directory path/);
    }
    for (const provider of ['../codex', '/tmp/arbitrary', 'codex-cli']) {
      const invalid = await f.run('resolve', provider); assert.equal(invalid.code, 1); assert.match(invalid.data.error!, /Choose codex, claude, or grok/);
    }
    const valid = await fakeBinary(join(f.managed, 'bin'), 'codex', 'regular-file-fallback');
    assert.equal((await f.run('resolve', 'codex', { PATH: linked })).data.path, valid, 'An executable symlink to a directory must not hide a valid managed binary.');
  });
}
