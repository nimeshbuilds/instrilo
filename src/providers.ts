import { inspectSubscription, resolveProviderExecutable, providerId, type SubscriptionStatus } from './subscriptions.js';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Connection, GenerateRequest, GenerateResponse, ProviderCapability, ProviderKind } from './types.js';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const CLI_KINDS = new Set<ProviderKind>(['codex-cli', 'claude-code', 'grok-cli']);
const defaults: Partial<Record<ProviderKind, string>> = {
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1',
  xai: 'https://api.x.ai/v1', ollama: 'http://127.0.0.1:11434/v1',
};
const defaultModels: Partial<Record<ProviderKind, string>> = { ollama: 'llama3.2', demo: 'offline-demo' };

export const providerCapabilities: ProviderCapability[] = [
  { kind: 'openai', label: 'OpenAI API', transport: 'api', structuredOutput: true, toolCalling: true, cloudRuntime: true, notes: 'API credentials; subscription CLI access is a separate connection.' },
  { kind: 'anthropic', label: 'Anthropic API', transport: 'api', structuredOutput: false, toolCalling: true, cloudRuntime: true, notes: 'Native Messages API. JSON requests use a prompt and must be validated by the caller.' },
  { kind: 'xai', label: 'xAI API', transport: 'api', structuredOutput: true, toolCalling: true, cloudRuntime: true, notes: 'Console API key or explicitly configured gateway auth; do not assume API keys draw subscription allowance.' },
  { kind: 'gateway', label: 'OpenAI-compatible gateway', transport: 'api', structuredOutput: true, toolCalling: true, cloudRuntime: true, notes: 'Capabilities depend on the gateway/model. Supports API keys, bearer environment tokens and client-credentials OAuth.' },
  { kind: 'ollama', label: 'Ollama', transport: 'api', structuredOutput: true, toolCalling: true, cloudRuntime: true, notes: 'Requires a running reachable Ollama server with the selected model installed; cloud containers cannot reach a laptop through localhost.' },
  { kind: 'codex-cli', label: 'Codex CLI session', transport: 'cli', structuredOutput: false, toolCalling: false, cloudRuntime: false, notes: 'Installed unmodified CLI, user-owned login, read-only sandbox. Builder/judge or native local runtime; no framework API credential.' },
  { kind: 'claude-code', label: 'Claude Code session', transport: 'cli', structuredOutput: false, toolCalling: false, cloudRuntime: false, notes: 'Installed unmodified CLI and user-owned login; tools disabled. Third-party subscription auth and hosted use have additional provider conditions.' },
  { kind: 'grok-cli', label: 'Grok Build session', transport: 'cli', structuredOutput: false, toolCalling: false, cloudRuntime: false, notes: 'Installed unmodified CLI and user-owned login; tools disabled. Headless/ACP subscription access is supported; quota still applies.' },
  { kind: 'demo', label: 'Offline demonstration', transport: 'offline', structuredOutput: true, toolCalling: false, cloudRuntime: false, notes: 'Deterministic demonstration only. Never measures model quality or calls a live provider.' },
];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function envValue(name: string | undefined, purpose: string): string {
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`${purpose} requires a valid environment variable name.`);
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${purpose} environment variable ${name} is not set.`);
  if (/[\r\n]/.test(value)) throw new Error(`${purpose} contains invalid line breaks.`);
  return value;
}

function safeUrl(value: string | undefined, purpose: string): URL {
  if (!value) throw new Error(`${purpose} is required.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${purpose} must be a valid URL.`); }
  if (url.username || url.password || url.search || url.hash) throw new Error(`${purpose} must not contain credentials, query parameters or fragments.`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error(`${purpose} must use HTTPS (HTTP is allowed only for loopback development).`);
  return url;
}

function apiUrl(connection: Connection): string {
  const url = safeUrl(connection.baseUrl ?? defaults[connection.kind], 'Provider base URL');
  return `${url.href.replace(/\/$/, '')}/${connection.kind === 'anthropic' ? 'messages' : 'chat/completions'}`;
}

function deadline(connection: Connection, external?: AbortSignal): AbortSignal {
  const timeout = connection.timeoutMs ?? (CLI_KINDS.has(connection.kind) ? 120_000 : 60_000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600_000) throw new Error('Connection timeout must be between 1 and 600000 milliseconds.');
  const timeoutSignal = AbortSignal.timeout(timeout);
  return external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Provider returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Provider response exceeded the size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Provider returned invalid JSON.'); }
}

async function fetchJson(url: string, options: RequestInit, purpose: string): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, { ...options, redirect: 'error' }); }
  catch {
    if (options.signal?.aborted) throw new Error('Provider request cancelled or timed out.');
    throw new Error(`${purpose} could not connect. Check endpoint, network and TLS settings.`);
  }
  // Never echo provider error bodies: upstream services sometimes include request credentials.
  if (!response.ok) { await response.body?.cancel(); throw new Error(`${purpose} failed (HTTP ${response.status}). Check credentials, model access, quota and endpoint configuration.`); }
  try { return await readJson(response); }
  catch (error) {
    if (options.signal?.aborted) throw new Error('Provider request cancelled or timed out.');
    if (error instanceof Error && ['Provider returned an empty response.', 'Provider response exceeded the size limit.', 'Provider returned invalid JSON.'].includes(error.message)) throw error;
    throw new Error(`${purpose} response could not be read.`);
  }
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Resolve configured environment references. Never reads another application's credential files. */
export async function resolveAuth(connection: Connection, signal?: AbortSignal): Promise<Record<string, string>> {
  if (signal?.aborted) throw new Error('Provider request cancelled or timed out.');
  const auth = connection.auth;
  if (auth.type === 'none') return {};
  if (auth.type === 'api-key' || auth.type === 'bearer-env') {
    const secret = envValue(auth.env, 'Authentication');
    return auth.type === 'api-key' && connection.kind === 'anthropic'
      ? { 'x-api-key': secret }
      : { authorization: `Bearer ${secret}` };
  }
  if (auth.type !== 'oauth-client-credentials') throw new Error('Unsupported authentication type.');
  const tokenUrl = safeUrl(auth.tokenUrl, 'OAuth token URL').href;
  const clientId = envValue(auth.clientIdEnv, 'OAuth client ID');
  const clientSecret = envValue(auth.clientSecretEnv, 'OAuth client secret');
  // Include every auth field and current secret values, so changing scopes, tenant or credentials cannot reuse a different grant.
  const key = createHash('sha256').update(JSON.stringify({ auth, tokenUrl, clientId, clientSecret })).digest('hex');
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { authorization: `Bearer ${cached.token}` };
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  if (auth.scope) form.set('scope', auth.scope);
  if (auth.audience) form.set('audience', auth.audience);
  const data = record(await fetchJson(tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(), signal: deadline(connection, signal),
  }, 'OAuth token request'));
  if (data.error || typeof data.access_token !== 'string' || !data.access_token.trim() || /[\r\n]/.test(data.access_token) || data.access_token.length > 16_384) throw new Error('OAuth server did not return a valid access token.');
  if (data.token_type !== undefined && String(data.token_type).toLowerCase() !== 'bearer') throw new Error('OAuth server returned an unsupported token type.');
  const ttl = Number(data.expires_in);
  if (Number.isFinite(ttl) && ttl > 0) {
    if (tokenCache.size >= 100) tokenCache.delete(tokenCache.keys().next().value!);
    tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttl * 1000 - Math.min(30_000, ttl * 500) });
  } else tokenCache.delete(key);
  return { authorization: `Bearer ${data.access_token}` };
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(block => { const item = record(block); return typeof item.text === 'string' ? item.text : ''; }).filter(Boolean).join('\n');
}

function usage(value: unknown): GenerateResponse['usage'] {
  const data = record(value);
  const input = data.input_tokens ?? data.prompt_tokens;
  const output = data.output_tokens ?? data.completion_tokens;
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 && typeof output === 'number' && Number.isFinite(output) && output >= 0
    ? { inputTokens: input, outputTokens: output } : undefined;
}

function promptText(request: GenerateRequest): string {
  return `${request.system}\n\nRespond to the task using only the supplied text. Do not execute tools, inspect files or change the environment.${request.json ? ' Return only valid JSON, without Markdown fences.' : ''}\n\nTask:\n${request.prompt}`;
}

/** Arguments are passed directly to spawn, never interpolated into a shell. */
export function buildCliInvocation(kind: ProviderKind, request: GenerateRequest): { command: string; args: string[]; stdin: string } {
  const prompt = promptText(request);
  switch (kind) {
    case 'codex-cli': return { command: 'codex', args: ['exec', '--json', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '-'], stdin: prompt };
    case 'claude-code': return { command: 'claude', args: ['-p', '--output-format', 'json', '--tools', '', '--safe-mode', '--no-session-persistence', '--permission-mode', 'dontAsk'], stdin: prompt };
    case 'grok-cli': return { command: 'grok', args: ['-p', prompt, '--output-format', 'json', '--tools', '', '--deny', '*', '--disable-web-search', '--no-subagents', '--no-memory', '--permission-mode', 'dontAsk', '--max-turns', '1'], stdin: '' };
    default: throw new Error('This connection is not a CLI provider.');
  }
}

async function runProcess(command: string, args: string[], stdin: string, signal: AbortSignal, cwd?: string): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: process.env });
    let stdout = ''; let bytes = 0; let failure: string | undefined; let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (hard = false) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM');
        else child.kill(hard ? 'SIGKILL' : 'SIGTERM');
      } catch { /* Process already exited. */ }
    };
    const stop = (message: string) => { failure ??= message; kill(); killTimer ??= setTimeout(() => kill(true), 250); };
    const abort = () => stop('Provider request cancelled or timed out.');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (failure) kill(true);
      if (killTimer) clearTimeout(killTimer);
      if (error || failure) reject(new Error(failure ?? error)); else resolve(stdout);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { bytes += Buffer.byteLength(chunk); if (bytes > MAX_RESPONSE_BYTES) stop('CLI output exceeded the size limit.'); else stdout += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_RESPONSE_BYTES) stop('CLI output exceeded the size limit.'); });
    child.on('error', () => finish('Provider CLI could not start. Install the official binary and check the working directory and PATH.'));
    child.on('close', code => finish(code === 0 ? undefined : 'Provider CLI failed. Run the official CLI directly to check login, usage limits and supported flags.'));
    child.stdin.on('error', () => { /* EPIPE is handled by the process exit status. */ });
    child.stdin.end(stdin);
  });
}

function parseCliOutput(kind: ProviderKind, output: string): { text: string; usage?: GenerateResponse['usage']; model?: string } {
  let events: unknown[];
  try {
    const document: unknown = JSON.parse(output);
    events = Array.isArray(document) ? document : [document];
  } catch {
    try { events = output.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
    catch { throw new Error('Provider CLI returned invalid JSON output. Check the installed CLI version.'); }
  }
  let text = ''; let used: GenerateResponse['usage']; let model: string | undefined;
  for (const event of events) {
    const data = record(event);
    if (data.error || data.is_error === true || data.type === 'error' || data.type === 'turn.failed' || (typeof data.subtype === 'string' && data.subtype.startsWith('error'))) throw new Error('Provider CLI reported an error. Check the CLI directly for login, quota or model problems.');
    const item = record(data.item);
    if (kind === 'codex-cli') {
      if (data.type === 'item.completed' && item.type === 'agent_message') text = textContent(item.text);
    } else {
      const candidate = textContent(data.result) || textContent(data.response) || textContent(data.text)
        || (data.type === 'assistant' ? textContent(record(data.message).content) : '')
        || (data.role === 'assistant' ? textContent(data.content) : '');
      if (candidate) text = candidate;
    }
    used = usage(data.usage) ?? used;
    if (typeof data.model === 'string') model = data.model;
  }
  if (!text.trim()) throw new Error('Provider CLI returned no assistant text.');
  return { text, usage: used, model };
}

export async function generate(connection: Connection, request: GenerateRequest): Promise<GenerateResponse> {
  const started = Date.now();
  const signal = deadline(connection, request.signal);
  if (signal.aborted) throw new Error('Provider request cancelled or timed out.');
  if (!request.prompt?.trim()) throw new Error('A nonempty prompt is required.');
  const maxTokens = request.maxOutputTokens ?? 2048;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 262_144) throw new Error('Output token limit must be between 1 and 262144.');
  if (connection.kind === 'demo') {
    const text = request.json ? JSON.stringify({ demo: true, text: 'Offline demonstration only; no model was called.' }) : `[OFFLINE DEMO — no model called]\n${request.prompt}`;
    return { text, model: 'offline-demo', provider: 'demo', durationMs: Date.now() - started };
  }
  if (CLI_KINDS.has(connection.kind)) {
    if (connection.auth.type !== 'none') throw new Error('CLI connections use the official CLI login; configure auth.type as none. Use an API provider for explicit credentials.');
    const invocation = buildCliInvocation(connection.kind, request);
    const executable = await resolveProviderExecutable(connection.kind);
    if (!executable) throw new Error(`The official CLI is missing. Run instrilo setup ${providerId(connection.kind)} to install it and sign in.`);
    if (connection.model) invocation.args.push('--model', connection.model);
    let result: ReturnType<typeof parseCliOutput>;
    try { result = parseCliOutput(connection.kind, await runProcess(executable, invocation.args, invocation.stdin, signal, request.cwd)); }
    catch (error) { if (signal.aborted) throw new Error('Provider request cancelled or timed out.'); throw error; }
    return { ...result, model: result.model ?? connection.model ?? 'cli-default', provider: connection.kind, durationMs: Date.now() - started };
  }
  if (!providerCapabilities.some(provider => provider.kind === connection.kind && provider.transport === 'api')) throw new Error('Unknown provider kind.');
  const model = connection.model ?? defaultModels[connection.kind];
  if (!model?.trim()) throw new Error('An explicit model is required for this API connection.');
  const url = apiUrl(connection);
  const headers = await resolveAuth(connection, signal);
  if (!Object.keys(headers).length && !['ollama', 'gateway'].includes(connection.kind)) throw new Error('This API provider requires configured authentication.');
  const system = `${request.system}${request.json ? '\nReturn only valid JSON, without Markdown fences.' : ''}`;
  const anthropic = connection.kind === 'anthropic';
  const body: Record<string, unknown> = anthropic
    ? { model, system, messages: [{ role: 'user', content: request.prompt }], max_tokens: maxTokens }
    : { model, messages: [{ role: 'system', content: system }, { role: 'user', content: request.prompt }], [connection.kind === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxTokens, stream: false, ...(request.json ? { response_format: { type: 'json_object' } } : {}) };
  const data = record(await fetchJson(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', accept: 'application/json', ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}) }, body: JSON.stringify(body), signal }, 'Provider request'));
  if (data.error || data.type === 'error') throw new Error('Provider returned an error response. Check credentials, model access and request configuration.');
  const choice = record(Array.isArray(data.choices) ? data.choices[0] : undefined);
  const message = record(choice.message);
  if (choice.finish_reason === 'length' || data.stop_reason === 'max_tokens') throw new Error('Provider output was truncated. Increase the output token limit.');
  if (message.refusal || choice.finish_reason === 'content_filter') throw new Error('Provider declined this request.');
  const text = anthropic ? textContent(data.content) : textContent(message.content);
  if (!text.trim()) throw new Error('Provider returned no assistant text. Tool-only responses are not supported by this text generation adapter.');
  return { text, model: typeof data.model === 'string' ? data.model : model, provider: connection.kind, usage: usage(data.usage), durationMs: Date.now() - started };
}

/** Configuration and official CLI credential status, without model calls. */
export async function diagnoseConnection(connection: Connection): Promise<{ ok: boolean; message: string; setup?: SubscriptionStatus }> {
  try {
    deadline(connection);
    if (connection.kind === 'demo') return { ok: true, message: 'Offline demo is ready. It does not test a live model.' };
    if (CLI_KINDS.has(connection.kind)) {
      if (connection.auth.type !== 'none') throw new Error('CLI connections require auth.type none and the official CLI login.');
      const setup = await inspectSubscription(connection.kind);
      return { ok: setup.authentication.state === 'authenticated', message: setup.message, setup };
    }
    if (!providerCapabilities.some(provider => provider.kind === connection.kind && provider.transport === 'api')) throw new Error('Unknown provider kind.');
    apiUrl(connection);
    if (!(connection.model ?? defaultModels[connection.kind])?.trim()) throw new Error('An explicit model is required.');
    if (connection.auth.type === 'oauth-client-credentials') {
      safeUrl(connection.auth.tokenUrl, 'OAuth token URL');
      envValue(connection.auth.clientIdEnv, 'OAuth client ID'); envValue(connection.auth.clientSecretEnv, 'OAuth client secret');
    } else if (connection.auth.type !== 'none') envValue(connection.auth.env, 'Authentication');
    else if (!['gateway', 'ollama'].includes(connection.kind)) throw new Error('This API provider requires configured authentication.');
    return { ok: true, message: 'Configuration and environment references are valid. Connectivity, credentials and model access are not verified; no API request was made.' };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Connection configuration is invalid.' }; }
}
