import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Ajv } from 'ajv';
import { durableEnabled, durableStep } from './session.js';

export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const SPEC = JSON.parse(readFileSync(new URL('./agent-spec.json', import.meta.url), 'utf8'));
export const CONNECTION = SPEC.connections[SPEC.roles.runtime];
const guidance = readFileSync(new URL('./guidance.md', import.meta.url), 'utf8');
export const SYSTEM = SPEC.agent.systemPrompt + (guidance.trim() && !SPEC.agent.systemPrompt.includes(guidance.trim()) ? '\n\n' + guidance : '');
const MAX_BYTES = 1024 * 1024;
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<string, ReturnType<typeof ajv.compile>>(SPEC.agent.tools.map((t: any) => [t.name, ajv.compile(t.inputSchema)]));
export interface Context { scopes: Set<string>; approvals: Set<string>; signal: AbortSignal; trace: unknown[]; toolCalls: number; usageKnown: boolean; usage: { inputTokens: number; outputTokens: number } }
export async function env(name: string): Promise<string> { let value = process.env[name];
  // AWS_SECRET_RESOLUTION
  if (!value) throw new Error('Missing environment variable: ' + name); return value; }
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function approvalDigest(name: string, args: unknown): string { return createHash('sha256').update(canonical({ tool: name, arguments: args })).digest('hex'); }
export function context(scopes?: string[], approvals?: string[]): Context {
  return { scopes: new Set(scopes ?? (process.env.AGENT_SCOPES ?? '').split(/\s+/)), approvals: new Set(approvals ?? JSON.parse(process.env.AGENT_APPROVALS_JSON ?? '[]')), signal: AbortSignal.timeout(SPEC.agent.limits.timeoutMs), trace: [], toolCalls: 0, usageKnown: false, usage: { inputTokens: 0, outputTokens: 0 } };
}
export function validateUrl(url: string): string {
  const u = new URL(url);
  if (u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('Use HTTPS or loopback HTTP and environment references for credentials');
  return url;
}
export async function requestJson(url: string, ctx: Context, init: RequestInit = {}): Promise<any> {
  if (process.env.INSTRILO_REPLAY === '1') throw new Error('Network dispatch is forbidden during replay');
  validateUrl(url);
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(CONNECTION.timeoutMs ?? 60000)]);
  const response = await fetch(url, { ...init, signal, redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new Error('HTTP request failed (' + response.status + ')'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) throw new Error('Response exceeds 1 MiB'); chunks.push(value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function token(ctx: Context): Promise<string> {
  const auth = CONNECTION.auth;
  if (auth.type === 'none') return '';
  if (['api-key', 'bearer-env'].includes(auth.type)) return await env(auth.env);
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: await env(auth.clientIdEnv), client_secret: await env(auth.clientSecretEnv) });
  if (auth.scope) form.set('scope', auth.scope); if (auth.audience) form.set('audience', auth.audience);
  const result = await requestJson(auth.tokenUrl, ctx, { method: 'POST', body: form });
  if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('OAuth response has no access_token');
  return result.access_token;
}
export function baseUrl(): string { return (CONNECTION.baseUrl ?? ({ openai: 'https://api.openai.com/v1', xai: 'https://api.x.ai/v1', anthropic: 'https://api.anthropic.com/v1', ollama: 'http://127.0.0.1:11434/v1' } as Record<string, string>)[CONNECTION.kind] ?? '').replace(/\/$/, ''); }
export async function executeTool(name: string, args: unknown, ctx: Context): Promise<any> {
  ctx.signal.throwIfAborted();
  const t = SPEC.agent.tools.find((t: any) => t.name === name); if (!t) throw new Error('Unknown tool');
  const validate = validators.get(name)!;
  if (!validate(args)) throw new Error('Tool input failed JSON Schema validation: ' + ajv.errorsText(validate.errors));
  if (!t.requiredScopes.every((s: string) => ctx.scopes.has(s))) throw new Error('Missing tool scopes');
  const digest = approvalDigest(name, args);
  if (!durableEnabled && t.requiresApproval && !ctx.approvals.has(digest)) throw new Error('Approval required for exact call SHA256=' + digest);
  if (ctx.toolCalls >= SPEC.agent.limits.maxSteps) throw new Error('Tool call budget exhausted');
  ctx.toolCalls++;
  if (t.requiresApproval) ctx.approvals.delete(digest);
  return durableStep('tool', { name, arguments: args }, async () => {
  const url = new URL(t.url); const headers: Record<string, string> = {};
  if (t.authEnv) headers.Authorization = 'Bearer ' + await env(t.authEnv);
  const init: RequestInit = { method: t.method, headers };
  if (t.method === 'GET') for (const [k, v] of Object.entries(args as Record<string, unknown>)) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  else { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(args); }
  const result = await requestJson(url.toString(), ctx, init);
  ctx.trace.push({ event: 'tool', name, approvalDigest: digest, status: 'ok' });
  return result;
  });
}
async function cliPrompt(prompt: string, ctx: Context): Promise<string> {
  if (SPEC.agent.tools.length) throw new Error('CLI runtime does not implement portable HTTP tool calls');
  prompt = SYSTEM + '\n\nUse only supplied text. Do not execute tools, inspect files or change the environment.\n\n' + prompt;
  const commands: Record<string, string[]> = {
    'codex-cli': ['codex', 'exec', '--json', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '-'],
    'claude-code': ['claude', '-p', '--output-format', 'json', '--tools', '', '--safe-mode', '--no-session-persistence', '--permission-mode', 'dontAsk'],
    'grok-cli': ['grok', '-p', prompt, '--output-format', 'json', '--tools', '', '--deny', '*', '--disable-web-search', '--no-subagents', '--no-memory', '--permission-mode', 'dontAsk', '--max-turns', '1'] };
  const command = commands[CONNECTION.kind];
  if (CONNECTION.model) command.push('--model', CONNECTION.model);
  ctx.signal.throwIfAborted();
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: ROOT, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let size = 0; let failure: Error | undefined;
    const kill = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const abort = () => { failure = new Error('CLI timed out'); kill(); };
    ctx.signal.addEventListener('abort', abort, { once: true });
    const collect = (chunk: Buffer, capture: boolean) => { size += chunk.length; if (size > MAX_BYTES) { failure = new Error('CLI output exceeds 1 MiB'); kill(); } else if (capture) output += chunk.toString(); };
    child.stdout.on('data', chunk => collect(chunk, true)); child.stderr.on('data', chunk => collect(chunk, false));
    child.on('error', error => { ctx.signal.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => { ctx.signal.removeEventListener('abort', abort); if (failure) reject(failure); else if (code !== 0) reject(new Error('CLI exited with code ' + code)); else resolve(output); });
    child.stdin.on('error', () => {});
    child.stdin.end(CONNECTION.kind === 'grok-cli' ? '' : prompt);
  });
  if (CONNECTION.kind === 'codex-cli') {
    const messages: string[] = [];
    for (const line of raw.split('\n').filter(Boolean)) { const event = JSON.parse(line); if (['error', 'turn.failed'].includes(event.type)) throw new Error('Codex CLI reported failure'); if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text); }
    if (!messages.length) throw new Error('CLI returned no assistant text'); return messages.join('\n');
  }
  const event = JSON.parse(raw);
  if (event.is_error || String(event.subtype ?? '').startsWith('error')) throw new Error('CLI reported failure');
  const result = event.result ?? event.response ?? event.text;
  if (typeof result !== 'string' || !result.trim()) throw new Error('CLI returned no assistant text');
  return result;
}
export async function modelStep(messages: any[], ctx: Context): Promise<any> {
  const prior = { ...ctx.usage };
  const packet = await durableStep('model', { messages }, async () => {
    const before = { ...ctx.usage };
    const message = await liveModelStep(messages, ctx);
    return { message, usageKnown: ctx.usageKnown, usage: { inputTokens: ctx.usage.inputTokens - before.inputTokens, outputTokens: ctx.usage.outputTokens - before.outputTokens } };
  });
  ctx.usageKnown = packet.usageKnown;
  ctx.usage = { inputTokens: prior.inputTokens + packet.usage.inputTokens, outputTokens: prior.outputTokens + packet.usage.outputTokens };
  // Recorded usage describes the original response; replay never bills a provider.
  return packet.message;
}
async function liveModelStep(messages: any[], ctx: Context): Promise<any> {
  ctx.signal.throwIfAborted(); const kind = CONNECTION.kind;
  if (kind === 'demo') return { role: 'assistant', content: '[DEMO ONLY] ' + String(messages.at(-1).content) };
  if (['codex-cli', 'claude-code', 'grok-cli'].includes(kind)) return { role: 'assistant', content: await cliPrompt(String(messages.at(-1).content), ctx) };
  const key = await token(ctx); const tools = SPEC.agent.tools;
  if (kind === 'anthropic') {
    const converted = messages.filter(m => m.role !== 'system').map(m => m.role === 'tool' ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] } : m.tool_calls?.length ? { role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.tool_calls.map((c: any) => ({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments) }))] } : m);
    const payload: any = { model: CONNECTION.model, system: SYSTEM, messages: converted, max_tokens: SPEC.agent.limits.maxOutputTokens };
    if (tools.length) payload.tools = tools.map((t: any) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (CONNECTION.auth.type === 'api-key') headers['x-api-key'] = key; else if (key) headers.Authorization = 'Bearer ' + key;
    const data = await requestJson(baseUrl() + '/messages', ctx, { method: 'POST', headers, body: JSON.stringify(payload) });
    ctx.usageKnown = typeof data.usage?.input_tokens === 'number' && typeof data.usage?.output_tokens === 'number';
    ctx.usage.inputTokens += data.usage?.input_tokens ?? 0; ctx.usage.outputTokens += data.usage?.output_tokens ?? 0;
    return { role: 'assistant', content: data.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''), tool_calls: data.content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } })) };
  }
  const payload: any = { model: CONNECTION.model, messages, max_completion_tokens: SPEC.agent.limits.maxOutputTokens };
  if (tools.length) payload.tools = tools.map((t: any) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const data = await requestJson(baseUrl() + '/chat/completions', ctx, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(payload) });
  ctx.usageKnown = typeof data.usage?.prompt_tokens === 'number' && typeof data.usage?.completion_tokens === 'number';
  ctx.usage.inputTokens += data.usage?.prompt_tokens ?? 0; ctx.usage.outputTokens += data.usage?.completion_tokens ?? 0;
  return data.choices[0].message;
}
export async function applyTools(message: any, ctx: Context): Promise<any[]> {
  const results = []; for (const call of message.tool_calls ?? []) results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(await executeTool(call.function.name, JSON.parse(call.function.arguments), ctx)) }); return results;
}
export async function runNative(input: string, ctx: Context): Promise<string> {
  const messages: any[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: input }];
  for (let step = 0; step < SPEC.agent.limits.maxSteps; step++) { const message = await modelStep(messages, ctx); ctx.trace.push({ event: 'model', step: step + 1 }); messages.push(message); if (!message.tool_calls?.length) return String(message.content ?? ''); messages.push(...await applyTools(message, ctx)); }
  throw new Error('Agent step budget exhausted');
}
