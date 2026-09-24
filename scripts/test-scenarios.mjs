import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadScenarios, scenarioFingerprint, repository } from './scenario-utils.mjs';
import { assertPackageFiles, metadata, run } from './release-utils.mjs';

const args = process.argv.slice(2);
let only, tarball, output = join(repository, 'website/verification.json');
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--only' && args[index + 1]) only = args[++index];
  else if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index]);
  else if (args[index] === '--tarball' && args[index + 1]) tarball = resolve(args[++index]);
  else throw new Error('Use --only SCENARIO_ID, --output FILE or --tarball FILE.');
}
if (process.platform === 'win32') throw new Error('Run walkthrough verification in WSL; the published walkthroughs use Bash.');
if (!tarball) await access(join(repository, 'dist/cli.js'));
const all = await loadScenarios({ complete: !only });
const scenarios = all.filter(scenario => !only || scenario.id === only);
if (!scenarios.length) throw new Error('No matching walkthrough.');
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), platform: process.platform, node: process.versions.node, installation: 'Isolated global npm installation of the built package; tutorial workspaces are copied by the installed CLI with no source-checkout symlinks.', scenarios: [] };
const installationRoot = await mkdtemp(join(tmpdir(), 'instrilo-walkthrough-install-'));
const safeEnv = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'NB_AGENT_PYTHON', 'UV_CACHE_DIR', 'CI']) if (process.env[key]) safeEnv[key] = process.env[key];
Object.assign(safeEnv, { OTEL_SDK_DISABLED: 'true', CREWAI_TRACING_ENABLED: 'false', CREWAI_TELEMETRY_OPT_OUT: 'true', DO_NOT_TRACK: '1', LANGSMITH_TRACING: 'false', OPENAI_AGENTS_DISABLE_TRACING: '1' });
Object.assign(safeEnv, { npm_config_userconfig: join(installationRoot, 'empty.npmrc'), npm_config_cache: join(installationRoot, 'npm-cache') });
await writeFile(safeEnv.npm_config_userconfig, '');

const cancel = () => { process.exitCode = 130; };
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
try {
  const fingerprints = new Map(await Promise.all(scenarios.map(async scenario => [scenario.id, await scenarioFingerprint(scenario)])));
  if (tarball) {
    const original = tarball;
    tarball = join(installationRoot, 'instrilo-verification.tgz');
    await copyFile(original, tarball);
  } else {
    const packed = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', installationRoot], { env: safeEnv });
    const packages = JSON.parse(packed.stdout);
    if (packages.length !== 1 || packages[0].name !== metadata.name) throw new Error('npm pack returned an unexpected package.');
    assertPackageFiles(packages[0].files.map(file => file.path));
    tarball = join(installationRoot, packages[0].filename);
  }
  report.packageSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
  const prefix = join(installationRoot, 'global');
  console.log('Installing the built CLI into a temporary user-owned prefix…');
  await run('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', tarball], { cwd: installationRoot, env: safeEnv });
  safeEnv.PATH = `${join(prefix, 'bin')}${delimiter}${safeEnv.PATH || ''}`;
  const globalModules = (await run('npm', ['root', '--global', '--prefix', prefix], { cwd: installationRoot, env: safeEnv })).stdout.trim();
  const installed = JSON.parse(await readFile(join(globalModules, metadata.name, 'package.json'), 'utf8'));
  if (installed.name !== metadata.name) throw new Error('The installed archive is not Instrilo.');
  report.package = installed.name;
  report.version = installed.version;
  const version = (await run('instrilo', ['--version'], { cwd: installationRoot, env: safeEnv })).stdout.trim();
  if (version !== installed.version) throw new Error('PATH did not resolve the installed verification CLI.');
  for (const scenario of scenarios) {
    if (process.exitCode) break;
    const root = await mkdtemp(join(tmpdir(), 'instrilo-walkthrough-'));
    const started = Date.now();
    const scenarioHash = fingerprints.get(scenario.id);
    console.log(`Testing ${scenario.order}/10: ${scenario.title}`);
    try {
      const workspace = join(root, 'workspace');
      await run('instrilo', ['tutorials', 'setup', workspace], { cwd: root, env: safeEnv });
      const executable = scenario.steps.filter(step => step.code);
      const commands = executable.map((step, index) => `${step.code}\nprintf '\\nINSTRILO_WALKTHROUGH_STEP_${index + 1}_OK\\n'`).join('\n\n');
      const script = 'set -euo pipefail\n' + commands + '\nprintf "\\nINSTRILO_WALKTHROUGH_COMPLETE\\n"\n';
      const scriptPath = join(root, 'walkthrough.sh');
      await writeFile(scriptPath, script, { mode: 0o600 });
      const result = await run('/bin/bash', ['--noprofile', '--norc', scriptPath], { cwd: workspace, env: safeEnv, timeout: 300_000 });
      if (!result.stdout.includes('INSTRILO_WALKTHROUGH_COMPLETE')) throw new Error('Walkthrough did not reach its completion marker.');
      for (let index = 1; index <= executable.length; index++) if (!result.stdout.includes(`INSTRILO_WALKTHROUGH_STEP_${index}_OK`)) throw new Error('A documented step did not complete.');
      if (scenarioHash !== await scenarioFingerprint(scenario)) throw new Error('Source or examples changed during verification. Rerun this walkthrough.');
      report.scenarios.push({ id: scenario.id, status: 'passed', steps: executable.length, manualSteps: scenario.steps.filter(step => step.manualCode).length, scope: scenario.verification.scope, durationMs: Date.now() - started, scenarioHash });
      console.log(`PASS ${scenario.id}: ${executable.length} exact command blocks; ${scenario.steps.filter(step => step.manualCode).length} manual blocks excluded.`);
    } catch (error) {
      report.scenarios.push({ id: scenario.id, status: 'failed', scope: scenario.verification.scope, durationMs: Date.now() - started, scenarioHash });
      process.exitCode ||= 1;
      console.error(`FAIL ${scenario.id}: ${error.message}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
} catch (error) {
  process.exitCode ||= 1;
  console.error(`Walkthrough installation failed: ${error.message}`);
} finally {
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  await rm(installationRoot, { recursive: true, force: true });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(`${report.scenarios.filter(item => item.status === 'passed').length}/${scenarios.length} walkthroughs passed. Evidence: ${output}`);
