import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSpec, loadSpec, saveSpec } from '../src/core.js';
import { safeChild } from '../src/workbench.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const tsx = join(repository, 'node_modules/tsx/dist/cli.mjs');
const cli = join(repository, 'src/cli.ts');
type CommandResult = { code: number | null; stdout: string; stderr: string };
async function command(executable: string, args: string[], cwd: string, timeout = 120_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Command timed out: ${executable} ${args.join(' ')}`)); }, timeout);
    child.stdout.on('data', data => { stdout += String(data); });
    child.stderr.on('data', data => { stderr += String(data); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
const cliCommand = (args: string[], cwd = repository) => command(process.execPath, [tsx, cli, ...args], cwd);
function successful(result: CommandResult): void { assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`); }
function json(result: CommandResult): any { successful(result); return JSON.parse(result.stdout); }

test('CLI exposes one optional project argument and rejects unknown flags', async () => {
  for (const name of ['validate', 'plan', 'build', 'prepare', 'run', 'eval', 'doctor', 'deploy']) {
    const result = await cliCommand([name, '--help']);
    successful(result);
    const usage = result.stdout.split('\n')[0];
    assert.equal((usage.match(/\[project\]/g) ?? []).length, 1, usage);
  }
  const rejected = await cliCommand(['init', 'agent-test', '--unknown-option']);
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /unknown option/i);
});

test('actual CLI creates, validates, builds, runs and evaluates a TypeScript demo project', { timeout: 180_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nb-cli-ts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'demo-typescript');
  successful(await cliCommand(['init', 'demo-typescript', '--directory', root]));
  const manifest = join(project, 'agent-studio.yaml');
  assert.equal((await loadSpec(manifest)).language, 'typescript');
  const validation = json(await cliCommand(['validate', project]));
  assert.equal(validation.valid, true);
  assert.ok(validation.issues.some((i: any) => i.code === 'DEMO_MODE'));
  // Exercise the no-argument default through Commander, not a direct function call.
  assert.equal(json(await cliCommand(['validate'], project)).valid, true);
  const plan = json(await cliCommand(['plan', project]));
  assert.match(plan.rationale, /Offline/);
  const build = json(await cliCommand(['build', project]));
  assert.equal(build.outputDir, join(project, 'generated'));
  assert.ok(build.files.some((f: string) => f.endsWith('agent.ts')));
  const lock = JSON.parse(await readFile(join(project, 'generated/build-lock.json'), 'utf8'));
  assert.match(lock.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(lock.verification, /generated/);
  // Install one generated native project once. No model API/CLI provider is invoked.
  const prepared = json(await cliCommand(['prepare', project]));
  assert.match(prepared.message, /Dependencies installed/);
  const run = json(await cliCommand(['run', project, '--input', 'integration hello']));
  assert.match(run.output, /DEMO ONLY/);
  assert.match(run.output, /integration hello/);
  const reportPath = join(root, 'reported-eval.json');
  const report = json(await cliCommand(['eval', project, '--split', 'development', '--output', reportPath]));
  assert.equal(report.mode, 'demo');
  assert.equal(report.total, 2);
  assert.equal(report.reviewed, 0);
  assert.equal(report.synthetic, 2);
  assert.ok(report.results.every((r: any) => r.judge === undefined));
  assert.ok(report.warnings.some((w: string) => /No live model quality/i.test(w)));
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).id, report.id);
  const emptyHoldout = await cliCommand(['eval', project, '--split', 'holdout']);
  assert.notEqual(emptyHoldout.code, 0);
  assert.match(emptyHoldout.stderr, /No cases/);
  const doctor = json(await cliCommand(['doctor', project]));
  assert.ok(doctor.connections.demo);
  const duplicate = await cliCommand(['init', 'demo-typescript', '--directory', root]);
  assert.notEqual(duplicate.code, 0);
  assert.match(duplicate.stderr, /already exists/);
  const noOverwrite = await cliCommand(['build', project]);
  assert.notEqual(noOverwrite.code, 0);
  successful(await cliCommand(['build', project, '--overwrite']));
});

test('create respects explicit manifest language unless an explicit flag overrides it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nb-cli-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const guidance = join(root, 'source-guidance');
  await mkdir(guidance);
  await writeFile(join(guidance, 'purpose.md'), '# Purpose\nDraft support replies.\n');
  const spec = defaultSpec('configured-agent');
  spec.language = 'python';
  const config = join(root, 'source.yaml');
  await saveSpec(config, spec);
  successful(await cliCommand(['create', 'configured-agent', '--guidance', guidance, '--config', config, '--directory', root]));
  const imported = await loadSpec(join(root, 'configured-agent/agent-studio.yaml'));
  assert.equal(imported.language, 'python');
  assert.equal(imported.guidanceDir, './guidance');
  assert.equal(await readFile(join(root, 'configured-agent/guidance/purpose.md'), 'utf8'), '# Purpose\nDraft support replies.\n');
  assert.equal(await readFile(join(guidance, 'purpose.md'), 'utf8'), '# Purpose\nDraft support replies.\n');
  successful(await cliCommand(['create', 'overridden-agent', '--guidance', guidance, '--config', config, '--language', 'typescript', '--directory', root]));
  assert.equal((await loadSpec(join(root, 'overridden-agent/agent-studio.yaml'))).language, 'typescript');
  spec.evaluation.dataset = '../outside.jsonl';
  await saveSpec(config, spec);
  const unsafe = await cliCommand(['create', 'unsafe-agent', '--guidance', guidance, '--config', config, '--directory', root]);
  assert.notEqual(unsafe.code, 0);
  assert.match(unsafe.stderr, /inside|path/i);
  await assert.rejects(readFile(join(root, 'outside.jsonl')));
});

test('actual Python demo runs with an explicitly provided interpreter', { timeout: 180_000, skip: !process.env.NB_AGENT_PYTHON ? 'Set NB_AGENT_PYTHON to exercise the Python integration.' : false }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nb-cli-python-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'demo-python');
  successful(await cliCommand(['init', 'demo-python', '--language', 'python', '--directory', root]));
  successful(await cliCommand(['build', project]));
  const generated = join(project, 'generated');
  successful(await command(process.env.NB_AGENT_PYTHON!, ['-m', 'venv', '.venv'], generated));
  const python = join(generated, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  successful(await command(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'httpx==0.28.1', 'jsonschema>=4.23,<5'], generated));
  const run = json(await cliCommand(['run', project, '--input', 'python integration hello']));
  assert.match(run.output, /DEMO ONLY/);
  assert.match(run.output, /python integration hello/);
  const report = json(await cliCommand(['eval', project, '--split', 'development']));
  assert.equal(report.mode, 'demo');
  assert.equal(report.total, 2);
});

test('project-relative path handling rejects filesystem escape', () => {
  const root = join(tmpdir(), 'selected-project');
  assert.equal(safeChild(root, 'evals/cases.jsonl'), join(root, 'evals/cases.jsonl'));
  assert.throws(() => safeChild(root, '../outside'));
  assert.throws(() => safeChild(root, dirname(root)));
});
