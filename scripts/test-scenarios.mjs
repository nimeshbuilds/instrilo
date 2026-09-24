import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadScenarios, scenarioFingerprint, repository } from './scenario-utils.mjs';

const args = process.argv.slice(2);
let only, output = join(repository, 'website/verification.json');
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--only' && args[index + 1]) only = args[++index];
  else if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index]);
  else throw new Error('Use --only SCENARIO_ID or --output FILE.');
}
await access(join(repository, 'dist/cli.js'));
const all = await loadScenarios({ complete: !only });
const scenarios = all.filter(scenario => !only || scenario.id === only);
if (!scenarios.length) throw new Error('No matching walkthrough.');
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), platform: process.platform, node: process.versions.node, scenarios: [] };
const safeEnv = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'NB_AGENT_PYTHON', 'UV_CACHE_DIR', 'CI']) if (process.env[key]) safeEnv[key] = process.env[key];
Object.assign(safeEnv, { OTEL_SDK_DISABLED: 'true', CREWAI_TRACING_ENABLED: 'false', CREWAI_TELEMETRY_OPT_OUT: 'true', DO_NOT_TRACK: '1', LANGSMITH_TRACING: 'false', OPENAI_AGENTS_DISABLE_TRACING: '1' });

let activeChild;
const stop = signal => { try { if (activeChild?.pid) process.kill(-activeChild.pid, signal); } catch {} };
const cancel = () => { stop('SIGTERM'); process.exitCode = 130; };
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
try {
  for (const scenario of scenarios) {
    if (process.exitCode) break;
    const root = await mkdtemp(join(tmpdir(), 'instrilo-walkthrough-'));
    const started = Date.now();
    const scenarioHash = await scenarioFingerprint(scenario);
    console.log(`Testing ${scenario.order}/10: ${scenario.title}`);
    try {
      for (const name of ['dist', 'node_modules', 'examples']) await symlink(join(repository, name), join(root, name));
      const executable = scenario.steps.filter(step => step.code);
      const commands = executable.map((step, index) => `${step.code}\nprintf '\\nINSTRILO_WALKTHROUGH_STEP_${index + 1}_OK\\n'`).join('\n\n');
      const script = 'set -euo pipefail\n' + commands + '\nprintf "\\nINSTRILO_WALKTHROUGH_COMPLETE\\n"\n';
      const scriptPath = join(root, 'walkthrough.sh');
      await writeFile(scriptPath, script, { mode: 0o600 });
      const result = await new Promise((resolveResult, reject) => {
        const child = spawn('/bin/bash', ['--noprofile', '--norc', scriptPath], { cwd: root, env: safeEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        activeChild = child;
        let stdout = '', stderr = '', failure, bytes = 0, killTimer;
        const terminate = message => { failure ??= message; stop('SIGTERM'); killTimer ??= setTimeout(() => stop('SIGKILL'), 2000); };
        const timer = setTimeout(() => terminate('Walkthrough exceeded its five-minute timeout.'), 300_000);
        const collect = (chunk, channel) => { bytes += chunk.length; if (bytes > 4_000_000) terminate('Walkthrough exceeded its output bound.'); else if (channel === 'out') stdout += chunk; else stderr += chunk; };
        child.stdout.on('data', chunk => collect(chunk, 'out')); child.stderr.on('data', chunk => collect(chunk, 'err'));
        child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
        child.once('close', code => { clearTimeout(timer); clearTimeout(killTimer); activeChild = undefined; resolveResult({ code, stdout, stderr, failure }); });
      });
      if (result.code !== 0 || result.failure || !result.stdout.includes('INSTRILO_WALKTHROUGH_COMPLETE')) throw new Error(result.failure || `Exit ${result.code}.\n${result.stdout.slice(-6000)}\n${result.stderr.slice(-6000)}`);
      for (let index = 1; index <= executable.length; index++) if (!result.stdout.includes(`INSTRILO_WALKTHROUGH_STEP_${index}_OK`)) throw new Error('A documented step did not complete.');
      if (scenarioHash !== await scenarioFingerprint(scenario)) throw new Error('Source or examples changed during verification. Rerun this walkthrough.');
      report.scenarios.push({ id: scenario.id, status: 'passed', steps: executable.length, manualSteps: scenario.steps.filter(step => step.manualCode).length, scope: scenario.verification.scope, durationMs: Date.now() - started, scenarioHash });
      console.log(`PASS ${scenario.id}: ${executable.length} exact command blocks; ${scenario.steps.filter(step => step.manualCode).length} manual blocks excluded.`);
    } catch (error) {
      report.scenarios.push({ id: scenario.id, status: 'failed', scope: scenario.verification.scope, durationMs: Date.now() - started, scenarioHash });
      process.exitCode = 1;
      console.error(`FAIL ${scenario.id}: ${error.message}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
} finally {
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(`${report.scenarios.filter(item => item.status === 'passed').length}/${scenarios.length} walkthroughs passed. Evidence: ${output}`);
