import type { Command } from 'commander';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from './version.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
interface Tutorial {
  id: string; order: number; title: string; summary: string; outcome: string;
  prerequisites: string[];
  verification: { scope: string; limitations: string[] };
  steps: { title: string; body: string; code?: string; manualCode?: string; expected: string }[];
  cleanup?: string | string[]; troubleshooting?: string | string[];
  next?: { label: string; url: string }[];
}

export async function listTutorials(): Promise<Tutorial[]> {
  const directory = join(packageRoot, 'website/scenarios');
  const names = (await readdir(directory)).filter(name => /^[a-z0-9-]+\.json$/.test(name)).sort();
  return Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8')) as Tutorial));
}

function renderTutorial(tutorial: Tutorial): string {
  const section = (title: string, value?: string | string[]) => value ? [`## ${title}`, ...(Array.isArray(value) ? value.map(item => `- ${item}`) : [value])] : [];
  return [
    `# ${tutorial.title}`, tutorial.summary, `Outcome: ${tutorial.outcome}`,
    '## Before you start',
    'Install Instrilo, then prepare a fresh workspace once and keep all guide steps in the same Bash session:',
    '```sh\ninstrilo tutorials setup ./instrilo-tutorials\ncd ./instrilo-tutorials\n```',
    'If you already prepared this workspace, just change into it. Choose a fresh workspace for a repeat run.',
    ...tutorial.prerequisites.map(item => `- ${item}`),
    ...tutorial.steps.flatMap((step, index) => [
      `## ${index + 1}. ${step.title}`, step.body,
      ...(step.code || step.manualCode ? [step.manualCode ? '**Optional live/manual step — not run by the walkthrough checks.**' : '', `\`\`\`sh\n${step.code ?? step.manualCode}\n\`\`\``] : []),
      `Expected: ${step.expected}`,
    ]),
    '## Verification scope', tutorial.verification.scope,
    ...tutorial.verification.limitations.map(item => `- ${item}`),
    ...section('Clean up after the guide', tutorial.cleanup),
    ...section('Troubleshooting', tutorial.troubleshooting),
    ...(tutorial.next?.length ? ['## Keep going', ...tutorial.next.map(item => `- [${item.label}](${item.url.startsWith('#') ? `https://nimeshbuilds.github.io/instrilo/quickstarts/${item.url.slice(1)}/` : item.url})`)] : []),
    `Read the online guide: https://nimeshbuilds.github.io/instrilo/quickstarts/${tutorial.id}/`,
  ].filter(Boolean).join('\n\n') + '\n';
}

async function assertRegularTree(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Bundled tutorial assets must be regular files and directories. Reinstall Instrilo from a verified release.');
    if (entry.isDirectory()) await assertRegularTree(join(directory, entry.name));
  }
}

export async function setupTutorials(directory: string) {
  const destination = resolve(directory), source = join(packageRoot, 'examples/quickstarts');
  const tutorials = await listTutorials();
  await assertRegularTree(source);
  await mkdir(dirname(destination), { recursive: true });
  try { await mkdir(destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Tutorial destination already exists. Keep your work and choose a new directory, or cd into the existing workspace to continue.');
    throw error;
  }
  try {
    await mkdir(join(destination, 'examples'));
    await cp(source, join(destination, 'examples/quickstarts'), { recursive: true, errorOnExist: true, force: false });
    await mkdir(join(destination, 'guides'));
    for (const tutorial of tutorials) await writeFile(join(destination, 'guides', `${tutorial.id}.md`), renderTutorial(tutorial), { flag: 'wx' });
    await writeFile(join(destination, 'README.md'), `# Instrilo ${version} tutorials\n\nRun all guide commands from this directory using the installed instrilo CLI. Use Bash on macOS/Linux or WSL; keep a guide's steps in the same terminal session. No source checkout or global package directory edits are needed.\n\nExamples are local deterministic fixtures; they do not establish model quality or cloud readiness. Setup copies files only and does not start a service, install dependencies, call a model, or create cloud resources.\n\n## Choose a guide\n\n${tutorials.map(item => `- [${item.title}](guides/${item.id}.md)`).join('\n')}\n\nRun instrilo tutorials list or instrilo tutorials show deployment-artifacts to read a guide in the terminal. Projects and reports are created under .studio/tutorials as you follow the steps. Keep that evidence; stop any guide-owned fixture process as documented before removing this workspace.\n`, { flag: 'wx' });
    return { directory: destination, version, tutorials: tutorials.length, examples: join(destination, 'examples/quickstarts'), guides: join(destination, 'guides'), next: ['Change into the directory above.', 'instrilo tutorials list', 'instrilo tutorials show deployment-artifacts'] };
  } catch (error) {
    // This directory was exclusively created above; never remove a preexisting workspace.
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export function registerTutorialCommands(program: Command) {
  const tutorials = program.command('tutorials').description('Prepare and read the bundled walkthroughs using the installed CLI.');
  tutorials.command('list').description('List every bundled walkthrough and its intended outcome.').action(async () => {
    console.log(JSON.stringify((await listTutorials()).map(({ id, title, summary, outcome }) => ({ id, title, summary, outcome })), null, 2));
  });
  tutorials.command('show <id>').description('Read a complete walkthrough with its exact commands and verification boundaries.').action(async (id: string) => {
    const tutorial = (await listTutorials()).find(item => item.id === id);
    if (!tutorial) throw new Error('Unknown tutorial. Run instrilo tutorials list to see the available IDs.');
    console.log(renderTutorial(tutorial));
  });
  tutorials.command('setup').argument('[directory]', 'new directory for example files, projects and offline guides', './instrilo-tutorials').description('Copy example files and offline guides into a new workspace; never overwrite existing work.').action(async (directory: string) => {
    console.log(JSON.stringify(await setupTutorials(directory), null, 2));
  });
}
