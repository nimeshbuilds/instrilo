#!/usr/bin/env node
import { Command } from 'commander';
import { version } from './version.js';
import { withCliCancellation } from './cli-runtime.js';
import { registerProjectCommands } from './cli-extra.js';
import { registerQualityCommands } from './cli-quality.js';
import { registerSubscriptionCommands } from './cli-subscriptions.js';
import { registerDeploymentCommands } from './cli-deployment.js';
import { registerWebCommands } from './cli-web.js';
import { registerTutorialCommands } from './cli-tutorials.js';
import { installCliHelp } from './cli-help.js';
import { atomicProjectWrite, readTextDocument, readDocument, hashText } from './project-ops.js';
import { withGenerationLock } from './regeneration.js';
import { registerEvidenceReport } from './evidence.js';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import YAML from 'yaml';
import { defaultSpec, loadSpec, saveSpec, validateSpec, inspectGuidance, writeGuidance, guidanceQuestions, readCases } from './core.js';
import { createProject, buildProject, refineProject, manifestName, safeChild, parseManifestText } from './workbench.js';
import { providerCapabilities, diagnoseConnection } from './providers.js';
import { evaluateProject, runProject, saveReport, compareReports, sanitizeError, prepareProject, assertBuildCurrent, assertBuildContentCurrent } from './execution.js';
import type { GuidanceAnswers, Language, Framework, Target } from './types.js';

const program = new Command().name('instrilo').version(version).description('Instrilo — turn product guidance into agents, evaluations and deployment artifacts.');
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const manifest = (path: string) => path.endsWith('.yaml') || path.endsWith('.yml') || path.endsWith('.json') ? resolve(path) : resolve(path, manifestName);

program.command('init <name>').description('Create a project with explicit offline defaults; configure connections before live use.').option('-d, --directory <directory>', 'parent directory', '.').option('-l, --language <language>', 'python or typescript', 'typescript').action(async (name, options) => { const project = await createProject(resolve(options.directory), { name, language: options.language as Language }); console.log(`Created ${project.dir}\nOffline demonstration mode. Edit ${manifestName} or open the app to configure live providers.\nNext: instrilo guidance create ${join(project.dir, 'guidance')}`); });

const guidance = program.command('guidance').description('Create and inspect a product guidance directory.');
guidance.command('create <directory>').description('Ask the ten product questions and write a reviewable guidance document.').option('--answers <file>', 'JSON answers for noninteractive creation').action(async (directory, options) => {
  let answers: GuidanceAnswers;
  if (options.answers) answers = await readDocument(resolve(options.answers));
  else {
    if (!input.isTTY) throw new Error('Interactive input is unavailable. Pass --answers answers.json.');
    const rl = createInterface({ input, output }); const collected: Record<string, string> = {};
    try { for (const question of guidanceQuestions) { console.log(`\n${question.label}\n${question.prompt}`); collected[question.key] = await rl.question('> '); } } finally { rl.close(); }
    answers = collected as unknown as GuidanceAnswers;
  }
  print({ files: await writeGuidance(resolve(directory), answers), note: 'Review the guidance and unresolved decisions before creating a live agent.' });
});
guidance.command('inspect <directory>').description('Inventory guidance, detect missing decisions, and show excluded files.').action(async directory => print(await inspectGuidance(resolve(directory))));

program.command('create <name>').description('Create a project from an existing guidance directory.').requiredOption('--guidance <directory>', 'existing guidance directory').option('-d, --directory <directory>', 'parent project directory', '.').option('-l, --language <language>', 'python or typescript').option('--framework <framework>', 'native, langgraph, openai-agents, crewai').option('--target <target>', 'delivery target').option('--config <file>', 'complete connection/spec YAML').action(async (name, options) => {
  const report = await inspectGuidance(resolve(options.guidance));
  if (report.issues.some(x => x.level === 'error')) throw new Error(report.issues.map(x => x.message).join('\n'));
  const spec = options.config ? await loadSpec(resolve(options.config)) : defaultSpec(name);
  spec.name = name; spec.language = options.language ?? spec.language; spec.framework = options.framework ?? spec.framework; spec.delivery.target = options.target ?? spec.delivery.target;
  spec.guidanceDir = './guidance';
  const checked = validateSpec(spec); if (checked.issues.some(x => x.level === 'error')) throw new Error(checked.issues.map(x => x.message).join('\n'));
  const project = await createProject(resolve(options.directory), { name, spec, guidance: report });
  print({ project: project.dir, guidanceFiles: report.files.length, issues: checked.issues, next: `instrilo build ${project.dir}` });
});

program.command('validate').description('Validate configuration and provider/framework/target compatibility.').argument('[project]', 'project directory or manifest', '.').action(async project => { const spec = await loadSpec(manifest(project)); const validation = validateSpec(spec); const report = await inspectGuidance(resolve(dirname(manifest(project)), spec.guidanceDir)); const issues = [...validation.issues, ...report.issues]; print({ valid: !issues.some(x => x.level === 'error'), issues, missingGuidance: report.missing }); if (issues.some(x => x.level === 'error')) process.exitCode = 1; });

program.command('plan').description('Ask the builder to synthesize instructions and identify unresolved questions.').argument('[project]', 'project directory or manifest', '.').option('--apply', 'save the proposed description and instructions').option('--interview', 'answer the builder’s specific follow-up questions and refine again').action(async (project, options) => {
  if (options.interview && !input.isTTY) throw new Error('The follow-up interview requires an interactive terminal.');
  const path = manifest(project), original = await readTextDocument(path), spec = await parseManifestText(original), guidanceDir = resolve(dirname(path), spec.guidanceDir);
  let proposed = await withCliCancellation(async signal => refineProject(spec, await inspectGuidance(guidanceDir), signal));
  if (options.interview && proposed.questions.length) {
    const rl = createInterface({ input, output }); const answers: string[] = [];
    try { for (const question of proposed.questions.slice(0, 20)) { console.log(`\n${question}`); const answer = await rl.question('> '); answers.push(`## ${question}\n\n${answer.trim() || 'UNDECIDED'}\n`); } } finally { rl.close(); }
    const note = safeChild(guidanceDir, `clarifications-${randomUUID()}.md`); await writeFile(note, `# Product clarifications\n\n${answers.join('\n')}`, { flag: 'wx' });
    console.error(`Saved answers to ${note}`);
    proposed = await withCliCancellation(async signal => refineProject(spec, await inspectGuidance(guidanceDir), signal));
  }
  print(proposed);
  if (options.apply) { spec.description = proposed.description; spec.agent.systemPrompt = proposed.systemPrompt; const checked = await parseManifestText(YAML.stringify(spec)); await atomicProjectWrite(dirname(path), basename(path), YAML.stringify(checked), hashText(original)); console.log('Saved proposed instructions. Review unresolved questions.'); }
});

program.command('build').description('Generate framework code, host packages, tests and target deployment artifacts.').argument('[project]', 'project directory or manifest', '.').option('-o, --output <directory>', 'generated project destination').option('--overwrite', 'safely regenerate existing files; conflicts stop before writing').option('--dry-run', 'show file decisions and plan hash without writing').option('--merge', 'attempt conservative non-overlapping three-way text merges').option('--expected-plan <hash>', 'apply only the exact reviewed generation plan').action(async (project, options) => print(await buildProject(manifest(project), options.output, options.overwrite || options.dryRun, { dryRun: options.dryRun, merge: options.merge, expectedPlanHash: options.expectedPlan })));
program.command('prepare').description('Install generated runtime dependencies using npm or uv.').argument('[project]', 'project directory or manifest', '.').action(async project => { const path = manifest(project); print(await withCliCancellation(async signal => prepareProject(await loadSpec(path), join(dirname(path), 'generated'), signal))); });
program.command('run').description('Run the actual generated agent locally. Provider usage may be billed.').argument('[project]', 'project directory or manifest', '.').requiredOption('-i, --input <text>', 'agent input').action(async (project, options) => { const path = manifest(project); const spec = await loadSpec(path); print(await withCliCancellation(signal => runProject(spec, join(dirname(path), 'generated'), options.input, signal))); });
program.command('eval').description('Run deterministic checks and the selected judge against the generated agent.').argument('[project]', 'project directory or manifest', '.').option('--split <split>', 'development, holdout, or all', 'all').option('--output <path>', 'report JSON destination').action(async (project, options) => {
  if (!['development', 'holdout', 'all'].includes(options.split)) throw new Error('Split must be development, holdout or all.');
  if(options.output) { try { await lstat(resolve(options.output)); throw new Error('Report output already exists. Choose a new path.'); } catch(error) { if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  const path = manifest(project); const spec = await loadSpec(path); const cases = await readCases(resolve(dirname(path), spec.evaluation.dataset));
  const report = await withCliCancellation(signal => evaluateProject(spec, join(dirname(path), 'generated'), cases, { signal, split: options.split, onProgress: (done, total) => console.error(`Evaluated ${done}/${total}`) }));
  const reportPath = options.output ? resolve(options.output) : join(dirname(path), 'reports', `${Date.now()}-${report.id}.json`); await saveReport(reportPath, report); await registerEvidenceReport(dirname(path), report); print({ ...report, reportPath });
  if (report.passed < report.total) process.exitCode = 1;
});
program.command('compare <previous> <current>').description('Compare two evaluation reports and list regressions.').action(async (a, b) => print(await compareReports(resolve(a), resolve(b))));
program.command('doctor').description('Check configuration, environment references and installed CLI binaries without model calls.').argument('[project]', 'project directory or manifest', '.').action(async project => { const spec = await loadSpec(manifest(project)); print({ issues: validateSpec(spec).issues, connections: Object.fromEntries(await Promise.all(Object.entries(spec.connections).map(async ([id, connection]) => [id, await diagnoseConnection(connection)]))) }); });
program.command('providers').description('List supported connection capabilities and restrictions.').action(() => print(providerCapabilities));
program.command('deploy').description('Show generated delivery instructions; --execute runs the target script you configured.').argument('[project]', 'project directory or manifest', '.').option('--execute', 'execute generated deployment script (requires configured cloud CLI and variables)').action(async (project, options) => {
  const path = manifest(project); const spec = await loadSpec(path); const outputDir = join(dirname(path), 'generated');
  if (!options.execute) { print({ target: spec.delivery.target, directory: outputDir, note: 'Review generated deployment artifacts, supply cloud identifiers and credentials, then use the generated deployment commands. Generation does not provision cloud resources.' }); return; }
  const scripts: Partial<Record<Target, string>> = { docker: 'docker.sh', 'aws-agentcore': 'aws-agentcore.sh', 'cloud-run': 'cloud-run.sh', 'azure-container-apps': 'azure.sh' };
  const script = scripts[spec.delivery.target];
  if (!script) throw new Error('Local delivery needs no deployment. Use instrilo run, or start the generated HTTP or MCP server.');
  await assertBuildCurrent(spec, outputDir);
  await withGenerationLock(outputDir, async () => {
  await assertBuildContentCurrent(spec, outputDir);
  const scriptPath = safeChild(outputDir, `deploy/${script}`);
  await readFile(scriptPath, 'utf8');
  console.error(`Executing ${scriptPath}. Cloud targets can create billable resources in your configured account.`);
  const code = await withCliCancellation(signal => new Promise<number>((resolveCode, reject) => {
    const child = spawn('bash', [scriptPath], { cwd: outputDir, env: process.env, stdio: 'inherit', shell: false, detached: process.platform !== 'win32' });
    const abort = () => { try { if(process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); } };
    signal.addEventListener('abort', abort, {once:true});
    child.once('error', error => { signal.removeEventListener('abort',abort); reject(error); }); child.once('close', exitCode => { signal.removeEventListener('abort',abort); resolveCode(exitCode ?? 1); });
  }));
  process.exitCode = code;
  });
});
registerWebCommands(program);
registerTutorialCommands(program);

registerProjectCommands(program, guidance);
registerQualityCommands(program);
registerSubscriptionCommands(program);
registerDeploymentCommands(program);
installCliHelp(program);

program.parseAsync().catch(error => { console.error(`Error: ${sanitizeError(error.message || String(error))}`); process.exitCode = 1; });
