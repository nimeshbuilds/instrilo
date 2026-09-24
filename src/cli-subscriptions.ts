import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { join } from 'node:path';
import { providerDefinitions, providerId, inspectSubscription, installPlan, installSubscription, loginSubscription, type SubscriptionStatus, type SubscriptionProgress } from './subscriptions.js';
import { withCliCancellation } from './cli-runtime.js';
import { generate } from './providers.js';
import { hashText, readTextDocument, projectSpec, mutateConfig } from './project-ops.js';
import { validateSpec } from './core.js';
import type { ProjectSpec, Role } from './types.js';

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const progress = (event: SubscriptionProgress) => { if (event.type === 'message') console.error(event.text); };
async function question(prompt: string, signal?: AbortSignal) {
  if (!stdin.isTTY) throw new Error('Interactive input is unavailable. Specify a provider and use --yes to approve installation, or --plan to inspect it.');
  const reader = createInterface({ input: stdin, output: stderr });
  try { return (await reader.question(prompt, { signal })).trim(); } finally { reader.close(); }
}
async function choose(input?: string) {
  if (input) return providerId(input);
  const answer = await question('Choose provider: codex, claude, or grok > ');
  return providerId(answer);
}
type Options = { yes?: boolean; device?: boolean };
async function install(input: string, options: Options, signal: AbortSignal) {
  const plan = installPlan(input);
  console.error(JSON.stringify(plan, null, 2));
  if (!options.yes && !/^y(es)?$/i.test(await question('Install this official package in your user directory? [y/N] ', signal))) throw new Error('Installation declined. No provider package was installed.');
  return installSubscription(input, { consent: true, signal, onProgress: progress });
}
async function setup(input: string, options: Options, signal: AbortSignal): Promise<SubscriptionStatus> {
  const id = providerId(input), definition = providerDefinitions.find(item => item.id === id)!;
  if (options.device && !definition.deviceAuth) throw new Error('This provider has no verified device-login option. Omit --device.');
  let status = await inspectSubscription(id, { signal });
  if (!status.installed) status = await install(id, options, signal);
  if (status.ready) return status;
  if (!options.yes && !/^y(es)?$/i.test(await question(`Start ${definition.label}'s official login now? [y/N] `, signal))) return status;
  return loginSubscription(id, { device: options.device, stdio: 'inherit', signal, onProgress: progress });
}
function statusExit(status: SubscriptionStatus) {
  // Grok cannot expose a durable credential-status check. Preserve this uncertainty.
  if (!status.installed || ['unauthenticated', 'error'].includes(status.authentication.state) || 'terminalRequired' in status && status.terminalRequired) process.exitCode = 1;
  return status;
}
export function registerSubscriptionCommands(program: Command) {
  program.command('setup [provider]').description('Guide official CLI discovery, reviewed installation and provider-owned sign-in; no project is required.')
    .option('--yes', 'approve the displayed official install plan and start provider login without Instrilo prompts')
    .option('--device', 'use official device login (Codex and Grok only)')
    .action(async (input: string | undefined, options: Options) => { const id = await choose(input); print(statusExit(await withCliCancellation(signal => setup(id, options, signal)))); });
  const auth = program.command('auth').description('Install, sign in, inspect or explicitly verify official subscription CLI connections.');
  auth.command('status [provider]').description('Print installed binaries and safe credential status for one or all providers; no model call or login.')
    .action(async (input?: string) => print(await withCliCancellation(async signal => input ? inspectSubscription(input, { signal }) : Promise.all(providerDefinitions.map(item => inspectSubscription(item.id, { signal }))))));
  auth.command('install <provider>').description('Install a fixed official npm package under your user account after reviewing its plan.')
    .option('--plan', 'print exact package, registry, destination and command without installing')
    .option('--yes', 'consent to installing the displayed official package without an interactive prompt')
    .action(async (input: string, options: Options & { plan?: boolean }) => { if (options.plan) return print(installPlan(input)); print(await withCliCancellation(signal => install(input, options, signal))); });
  auth.command('login <provider>').description('Run the official interactive sign-in even if credentials exist; the provider handles your account.')
    .option('--device', 'use official device login (Codex and Grok only)')
    .option('--install', 'offer to install the official CLI if it is missing')
    .option('--yes', 'approve the displayed installation when --install is used')
    .action(async (input: string, options: Options & { install?: boolean }) => print(statusExit(await withCliCancellation(async signal => {
      const id = providerId(input);
      if (options.device && !providerDefinitions.find(item => item.id === id)!.deviceAuth) throw new Error('This provider has no verified device-login option. Omit --device.');
      if (!(await inspectSubscription(id, { signal })).installed) {
        if (!options.install) throw new Error(`The official CLI is missing. Run instrilo setup ${id}, or add --install to this command.`);
        await install(id, options, signal);
      }
      return loginSubscription(id, { device: options.device, stdio: 'inherit', signal, onProgress: progress });
    }))));
  auth.command('verify <provider>').description('Make one bounded live model request through the official CLI. Uses account allowance or API billing.')
    .option('--model <id>', 'explicit provider model; otherwise use the official CLI default')
    .action(async (input: string, options: { model?: string }) => {
      const id = providerId(input), definition = providerDefinitions.find(item => item.id === id)!;
      const result = await withCliCancellation(signal => generate({ kind: definition.kind, auth: { type: 'none' }, model: options.model, timeoutMs: 120_000 }, { system: 'This is an Instrilo connection test. Do not use tools. Reply exactly INSTRILO_READY.', prompt: 'Reply exactly INSTRILO_READY.', signal, maxOutputTokens: 64 }));
      const verified = result.text.trim() === 'INSTRILO_READY';
      print({ provider: id, verified, model: result.model, durationMs: result.durationMs, usage: result.usage, checkedAt: new Date().toISOString(), message: verified ? 'A live request succeeded. This verifies this request only, not future quota or the billing source.' : 'The model responded but did not match the verification response.' });
      if (!verified) process.exitCode = 1;
    });
  program.command('connect <provider> [project]').description('Set up a provider and assign a named connection to builder, runtime, judge, or all roles.')
    .option('--role <role>', 'builder, runtime, judge, or all (default: builder)', 'builder')
    .option('--connection <name>', 'connection name (default: provider ID)')
    .option('--model <id>', 'explicit model; otherwise retain an existing connection model or use the CLI default')
    .option('--replace', 'allow replacing an existing connection of a different kind')
    .option('--yes', 'approve the displayed official install plan and start login without Instrilo prompts')
    .option('--device', 'use official device login (Codex and Grok only)')
    .action(async (input: string, project = '.', options: Options & { role: string; connection?: string; model?: string; replace?: boolean }) => {
      const id = providerId(input), definition = providerDefinitions.find(item => item.id === id)!;
      const roles: Role[] = options.role === 'all' ? ['builder', 'runtime', 'judge'] : [options.role as Role];
      if (roles.some(role => !['builder', 'runtime', 'judge'].includes(role))) throw new Error('Role must be builder, runtime, judge, or all.');
      const name = options.connection || id;
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Use a connection name starting with a letter and containing only letters, digits, underscores or hyphens.');
      const { root, spec } = await projectSpec(project), original = await readTextDocument(join(root, 'agent-studio.yaml'));
      const mutate = (current: ProjectSpec) => {
        const existing = current.connections[name];
        if (existing && existing.kind !== definition.kind && !options.replace) throw new Error('This connection name belongs to another provider. Choose --connection NAME or explicitly use --replace.');
        current.connections[name] = { kind: definition.kind, auth: { type: 'none' }, ...(existing?.kind === definition.kind ? existing : {}), ...(options.model ? { model: options.model } : {}) };
        for (const role of roles) current.roles[role] = name;
      };
      mutate(spec);
      const errors = validateSpec(spec).issues.filter(issue => issue.level === 'error');
      if (errors.length) throw new Error(errors.map(issue => issue.message).join('\n'));
      const status = await withCliCancellation(signal => setup(id, options, signal));
      statusExit(status);
      if (process.exitCode) { print({ saved: false, status }); return; }
      const saved = await mutateConfig(root, mutate, hashText(original));
      print({ ...saved, connection: name, roles, status, next: `Run instrilo auth verify ${id} for an explicit live check, then instrilo build ${root} --overwrite.` });
    });
}
