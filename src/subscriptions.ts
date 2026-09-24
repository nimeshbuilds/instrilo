import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export type SubscriptionProvider = 'codex' | 'claude' | 'grok';
export type SubscriptionProgress = { type: 'message'; text: string } | { type: 'url'; url: string } | { type: 'device-code'; code: string };
export interface ProviderDefinition {
  id: SubscriptionProvider;
  label: string;
  kind: 'codex-cli' | 'claude-code' | 'grok-cli';
  binary: string;
  npmPackage: string;
  docs: string[];
  deviceAuth: boolean;
}
export const providerDefinitions: readonly ProviderDefinition[] = [
  { id: 'codex', label: 'Codex CLI', kind: 'codex-cli', binary: 'codex', npmPackage: '@openai/codex', deviceAuth: true, docs: ['https://github.com/openai/codex', 'https://learn.chatgpt.com/docs/auth'] },
  { id: 'claude', label: 'Claude Code', kind: 'claude-code', binary: 'claude', npmPackage: '@anthropic-ai/claude-code', deviceAuth: false, docs: ['https://code.claude.com/docs/en/setup', 'https://code.claude.com/docs/en/authentication'] },
  { id: 'grok', label: 'Grok Build', kind: 'grok-cli', binary: 'grok', npmPackage: '@xai-official/grok', deviceAuth: true, docs: ['https://docs.x.ai/build/cli/headless-scripting', 'https://docs.x.ai/build/enterprise'] },
];

export interface SubscriptionStatus {
  provider: SubscriptionProvider;
  label: string;
  kind: ProviderDefinition['kind'];
  installed: boolean;
  path?: string;
  version?: string;
  authentication: { state: 'authenticated' | 'unauthenticated' | 'unknown' | 'error'; method: 'subscription' | 'api-key' | 'unknown' };
  ready: boolean;
  message: string;
  warnings: string[];
  nextSteps: string[];
}
type Observer = (progress: SubscriptionProgress) => void;
const REGISTRY = 'https://registry.npmjs.org';
const PROBE_TIMEOUT = 5_000;
const INSTALL_TIMEOUT = 300_000;
const LOGIN_TIMEOUT = 600_000;

export function providerId(input: string): SubscriptionProvider {
  if (typeof input !== 'string') throw new Error('Choose codex, claude, or grok.');
  const normalized = input.trim().toLowerCase();
  const provider = providerDefinitions.find(item => item.id === normalized || item.kind === normalized);
  if (!provider) throw new Error('Choose codex, claude, or grok.');
  return provider.id;
}
function definition(input: string): ProviderDefinition { const id = providerId(input); return providerDefinitions.find(item => item.id === id)!; }
export function providerHome(): string {
  const override = process.env.INSTRILO_PROVIDER_HOME;
  if (override !== undefined && (!override || !isAbsolute(override) || override.includes('\0'))) throw new Error('INSTRILO_PROVIDER_HOME must be an absolute directory path.');
  return override ? resolve(override) : join(homedir(), '.local/share/instrilo/providers');
}
async function executable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return (await stat(path)).isFile(); } catch { return false; }
}
async function findExecutable(binary: string, directories: string[]): Promise<string | undefined> {
  const names = process.platform === 'win32' ? [binary + '.exe', binary + '.cmd', binary] : [binary];
  for (const directory of [...new Set(directories)]) {
    if (!directory || !isAbsolute(directory)) continue;
    for (const name of names) { const path = join(directory, name); if (await executable(path)) return path; }
  }
  return undefined;
}
export async function resolveProviderExecutable(input: string): Promise<string | undefined> {
  const provider = definition(input);
  return findExecutable(provider.binary, [...(process.env.PATH ?? '').split(delimiter), join(providerHome(), 'bin'), join(homedir(), '.local/bin'), join(homedir(), '.bun/bin')]);
}
function progress(observer: Observer | undefined, event: SubscriptionProgress) { try { observer?.(event); } catch { /* Observers do not own the official child process. */ } }
function killTree(child: ChildProcess) {
  try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
  catch { child.kill('SIGKILL'); }
}
class CommandError extends Error {
  constructor(readonly reason: 'cancelled' | 'timeout' | 'output-limit' | 'start') {
    super({ cancelled: 'Provider operation was cancelled.', timeout: 'Provider operation timed out.', 'output-limit': 'The official provider command exceeded the output limit.', start: 'The official provider command could not start. Check the installed executable and Node.js version.' }[reason]);
  }
}
type OutputChannel = 'stdout' | 'stderr';
async function command(executable: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal; stdio?: 'inherit' | 'capture'; maxBytes?: number; onText?: (text: string, channel: OutputChannel) => void }): Promise<{ code: number; stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new CommandError('cancelled');
  if (process.platform === 'win32' && /\.cmd$/i.test(executable)) throw new Error('Use WSL for provider onboarding with npm command shims. No shell command is run automatically.');
  return new Promise((resolvePromise, reject) => {
    let child: ChildProcess;
    try { child = spawn(executable, args, { shell: false, stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: process.env }); }
    catch { reject(new CommandError('start')); return; }
    let stdout = '', stderr = '', bytes = 0, failure: CommandError | undefined, settled = false;
    const finish = (error?: Error, code = 1) => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolvePromise({ code, stdout, stderr });
    };
    const terminate = (reason: CommandError['reason']) => { failure ??= new CommandError(reason); killTree(child); };
    const cancel = () => terminate('cancelled');
    const timer = setTimeout(() => terminate('timeout'), options.timeoutMs);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const receive = (chunk: Buffer, channel: 'stdout' | 'stderr') => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 256 * 1024)) { terminate('output-limit'); return; }
      const text = chunk.toString('utf8'); if (channel === 'stdout') stdout += text; else stderr += text;
      options.onText?.(text, channel);
    };
    child.stdout?.on('data', chunk => receive(Buffer.from(chunk), 'stdout'));
    child.stderr?.on('data', chunk => receive(Buffer.from(chunk), 'stderr'));
    child.once('error', () => finish(failure ?? new CommandError('start')));
    child.once('close', code => { if (!failure) { options.onText?.('\n', 'stdout'); options.onText?.('\n', 'stderr'); } finish(failure, code ?? 1); });
  });
}
function authMethod(value: unknown): SubscriptionStatus['authentication']['method'] {
  if (typeof value !== 'string') return 'unknown';
  const method = value.toLowerCase();
  if (['oauth', 'claude.ai', 'claude_ai', 'subscription', 'chatgpt'].includes(method)) return 'subscription';
  if (['api_key', 'api-key', 'apikey', 'anthropic_api_key'].includes(method)) return 'api-key';
  return 'unknown';
}
function warnings(provider: SubscriptionProvider): string[] {
  const values = ['Local credential status does not verify subscription eligibility, remaining quota, model access, or a successful model call.'];
  const key = { codex: 'OPENAI_API_KEY', claude: 'ANTHROPIC_API_KEY', grok: 'XAI_API_KEY' }[provider];
  if (process.env[key]) values.push(key + ' is set. The official CLI may use API billing instead of subscription access.');
  return values;
}
export async function inspectSubscription(input: string, options: { signal?: AbortSignal } = {}): Promise<SubscriptionStatus> {
  const provider = definition(input), path = await resolveProviderExecutable(provider.id);
  const status: SubscriptionStatus = { provider: provider.id, label: provider.label, kind: provider.kind, installed: !!path, ...(path ? { path } : {}), authentication: { state: 'unknown', method: 'unknown' }, ready: false,
    message: path ? 'Installed; authentication has not been verified.' : 'The official CLI was not found.', warnings: warnings(provider.id), nextSteps: [path ? `instrilo auth login ${provider.id}` : `instrilo setup ${provider.id}`] };
  if (options.signal?.aborted) throw new CommandError('cancelled');
  if (!path) return status;
  try {
    const version = await command(path, ['--version'], { timeoutMs: PROBE_TIMEOUT, signal: options.signal, maxBytes: 32_768 });
    // A semver number is the only version output forwarded. Never return CLI diagnostics or identity fields.
    const number = version.code === 0 ? version.stdout.match(/\b\d{1,6}\.\d{1,6}\.\d{1,6}\b/)?.[0] : undefined;
    if (number) status.version = number;
    else status.warnings.push('The installed CLI version could not be verified.');
    if (provider.id === 'grok') { status.message = 'Grok is installed. This version of Instrilo has no verified noninteractive Grok authentication-status command; inspect login in the official CLI.'; return status; }
    const auth = await command(path, provider.id === 'codex' ? ['login', 'status'] : ['auth', 'status'], { timeoutMs: PROBE_TIMEOUT, signal: options.signal, maxBytes: 32_768 });
    if (provider.id === 'codex') {
      const text = auth.stdout + '\n' + auth.stderr;
      if (auth.code === 0) status.authentication = { state: 'authenticated', method: /logged in using chatgpt/i.test(text) ? 'subscription' : /logged in using (?:an? )?api[ -]?key/i.test(text) ? 'api-key' : 'unknown' };
      else if (auth.code === 1 && /not logged in|not authenticated/i.test(text)) status.authentication = { state: 'unauthenticated', method: 'unknown' };
      else status.authentication.state = 'error';
    } else {
      let parsed: unknown; try { parsed = JSON.parse(auth.stdout); } catch { /* Unknown output format is not evidence of login. */ }
      const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      if ([0, 1].includes(auth.code) && data.loggedIn === false) status.authentication = { state: 'unauthenticated', method: 'unknown' };
      else if (auth.code === 0 && data.loggedIn === true) status.authentication = { state: 'authenticated', method: authMethod(data.authMethod) };
      else if (auth.code === 0 && !/unknown (?:command|option)|unrecognized (?:command|option)|error:/i.test(auth.stdout + '\n' + auth.stderr)) status.authentication = { state: 'authenticated', method: 'unknown' };
      else if (auth.code === 1 && !/unknown (?:command|option)|unrecognized (?:command|option)|error:/i.test(auth.stdout + '\n' + auth.stderr)) status.authentication = { state: 'unauthenticated', method: 'unknown' };
      else status.authentication.state = 'error';
    }
  } catch (error) {
    if (error instanceof CommandError && error.reason === 'cancelled') throw error;
    status.authentication.state = 'error'; status.message = 'The official CLI status check failed or timed out. Run the provider login command in a terminal.'; return status;
  }
  status.ready = status.authentication.state === 'authenticated' && status.authentication.method === 'subscription';
  if (status.ready) { status.message = 'The official CLI reports subscription credentials. Quota and inference have not been checked.'; status.nextSteps = []; }
  else if (status.authentication.method === 'api-key') status.message = 'The official CLI reports API-key authentication, not verified subscription access.';
  else if (status.authentication.state === 'unauthenticated') status.message = 'The official CLI reports that you are not logged in.';
  else if (status.authentication.state === 'error') status.message = 'The official CLI authentication status could not be read safely. Use its login command in a terminal.';
  else status.message = 'Credentials may be present, but subscription authentication is unverified.';
  return status;
}

export function installPlan(input: string) {
  const provider = definition(input), destination = providerHome();
  return { provider: provider.id, label: provider.label, command: 'npm' as const, args: ['install', '--global', '--prefix', destination, provider.npmPackage, '--registry', REGISTRY, '--no-audit', '--no-fund'], destination, package: provider.npmPackage, registry: REGISTRY, docs: [...provider.docs], requiresConsent: true as const };
}
export async function installSubscription(input: string, options: { consent: boolean; signal?: AbortSignal; onProgress?: Observer }): Promise<SubscriptionStatus> {
  const plan = installPlan(input);
  if (options?.consent !== true) throw new Error('Installing the official provider package requires explicit consent to the displayed install plan.');
  if (options.signal?.aborted) throw new CommandError('cancelled');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Provider installation requires Node.js 22 or newer.');
  const npm = await findExecutable('npm', (process.env.PATH ?? '').split(delimiter));
  if (!npm) throw new Error('npm was not found on PATH. Install Node.js 22 or newer before provider onboarding.');
  try { const existing = await lstat(plan.destination); if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('The managed provider destination must be a real directory.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(plan.destination, { recursive: true, mode: 0o700 });
  const lockPath = join(plan.destination, '.install.lock');
  let lock;
  try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another provider installation owns the managed prefix. Wait for it to finish; inspect an abandoned lock before removing it.'); throw new Error('The managed provider installation lock could not be created.'); }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, provider: plan.provider, createdAt: new Date().toISOString() }));
    progress(options.onProgress, { type: 'message', text: 'Installing the official provider package into the displayed user directory.' });
    const result = await command(npm, plan.args, { timeoutMs: INSTALL_TIMEOUT, signal: options.signal });
    if (result.code !== 0) throw new Error('Official provider installation failed. Check Node.js, npm registry connectivity, and the managed directory permissions.');
    progress(options.onProgress, { type: 'message', text: 'Installation command completed. Checking the official CLI.' });
    const status = await inspectSubscription(plan.provider, { signal: options.signal });
    if (!status.installed) throw new Error('Installation completed but the official CLI was not found in the supported locations. Inspect the managed prefix.');
    return status;
  } finally { await lock.close(); await unlink(lockPath); }
}

// Only verified provider login hosts may leave the bounded capture buffer.
const loginHosts: Record<SubscriptionProvider, ReadonlySet<string>> = {
  codex: new Set(['auth.openai.com']),
  // Claude network-config and Grok enterprise authentication docs list these exact hosts.
  claude: new Set(['claude.com', 'claude.ai', 'platform.claude.com']),
  grok: new Set(['auth.x.ai']),
};
function loginEvents(provider: SubscriptionProvider, observer?: Observer): (text: string, channel: OutputChannel) => void {
  const carry: Record<OutputChannel, string> = { stdout: '', stderr: '' };
  const codeContext: Record<OutputChannel, number> = { stdout: 0, stderr: 0 };
  const emitted = new Set<string>();
  function lineEvents(raw: string, channel: OutputChannel) {
    const line = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const candidate of line.match(/https:\/\/[^\s<>"']+/g) ?? []) {
      let url: URL; try { url = new URL(candidate.replace(/[),.;]+$/, '')); } catch { continue; }
      if (url.protocol !== 'https:' || !loginHosts[provider].has(url.hostname) || url.username || url.password || url.hash || (url.port && url.port !== '443')) continue;
      if (/access[_-]?token|id[_-]?token|refresh[_-]?token/i.test(url.href) || [...url.searchParams.keys()].some(key => /token|secret|password|assertion/i.test(key) || key.toLowerCase() === 'code')) continue;
      if (url.href.length > 4096 || emitted.has(url.href)) continue;
      emitted.add(url.href); progress(observer, { type: 'url', url: url.href });
    }
    const context = line.match(/\b(?:device|user|one[ -]time)\s+(?:verification\s+)?code\b[:\s]*(.*)$/i);
    let candidate = '';
    if (context) { codeContext[channel] = 2; candidate = context[1].replace(/^is\s*:?\s*/i, '').trim(); }
    else if (codeContext[channel] > 0) { codeContext[channel]--; candidate = line.trim(); }
    const code = candidate.match(/^([A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,2}|[A-Z0-9]{6,12})(?:\s|$)/)?.[1];
    if (code) {
      codeContext[channel] = 0;
      if (!emitted.has('code:' + code)) { emitted.add('code:' + code); progress(observer, { type: 'device-code', code }); }
    }
  }
  return (text, channel) => {
    // Keep streams separate, and only interpret complete lines; close flushes any final carry.
    const lines = (carry[channel] + text).split(/\r?\n/);
    carry[channel] = lines.pop()!.slice(-32_768);
    for (const line of lines) lineEvents(line, channel);
  };
}
export async function loginSubscription(input: string, options: { device?: boolean; signal?: AbortSignal; stdio: 'inherit' | 'capture'; onProgress?: Observer }): Promise<SubscriptionStatus & { loginCompleted?: boolean; terminalRequired?: boolean; command?: { executable: string; args: string[] } }> {
  const provider = definition(input);
  if (options.device && !provider.deviceAuth) throw new Error('This provider has no verified device-login option. Use its standard official login.');
  const executable = await resolveProviderExecutable(provider.id);
  if (!executable) throw new Error('The official provider CLI was not found. Run instrilo setup ' + provider.id + ' before signing in.');
  const args = provider.id === 'claude' ? ['auth', 'login'] : ['login', ...(options.device ? ['--device-auth'] : [])];
  const fallback = { executable, args };
  progress(options.onProgress, { type: 'message', text: 'Starting the official provider login. Complete its browser or device verification.' });
  try {
    const result = await command(executable, args, { timeoutMs: LOGIN_TIMEOUT, signal: options.signal, stdio: options.stdio, ...(options.stdio === 'capture' ? { onText: loginEvents(provider.id, options.onProgress) } : {}) });
    if (result.code !== 0) {
      const status = await inspectSubscription(provider.id, { signal: options.signal });
      return { ...status, ready: false, message: 'The official login did not complete. Run instrilo auth login ' + provider.id + ' in a terminal and follow the provider instructions.', terminalRequired: true, command: fallback };
    }
    progress(options.onProgress, { type: 'message', text: 'Official login exited. Checking credential status without calling a model.' });
    const status = await inspectSubscription(provider.id, { signal: options.signal });
    return { ...status, loginCompleted: true, ...(!status.ready ? { message: 'The official login command completed. ' + status.message } : {}) };
  } catch (error) {
    if (error instanceof CommandError && error.reason === 'cancelled') throw error;
    if (options.stdio === 'inherit') throw error;
    return { provider: provider.id, label: provider.label, kind: provider.kind, installed: true, path: executable, authentication: { state: 'unknown', method: 'unknown' }, ready: false, message: 'The captured login could not complete. Run instrilo auth login ' + provider.id + ' in a terminal.', warnings: warnings(provider.id), nextSteps: ['instrilo auth login ' + provider.id], terminalRequired: true, command: fallback };
  }
}
