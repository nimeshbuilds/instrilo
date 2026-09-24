/** Durable local runs. Local OS ownership is the reviewer/authentication boundary. */
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, readdir, mkdir, rename, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { z } from 'zod';
import { assertBuildCurrent, runProject, sanitizeError, type RunResult } from './execution.js';
import { safeChild } from './workbench.js';
import type { ProjectSpec } from './types.js';

const LIMIT = 16 * 1024 * 1024;
const idSchema = z.string().uuid();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const approvalSchema = z.object({ digest: digestSchema, decision: z.enum(['approved', 'denied', 'claimed']), reviewer: z.string().min(1).max(200), expiresAt: z.string().datetime(), decidedAt: z.string().datetime(), claimedAt: z.string().datetime().optional() }).strict();
const eventSchema = z.object({ seq: z.number().int().min(0).max(511), kind: z.enum(['model', 'tool']), requestHash: digestSchema, request: z.unknown().optional(), status: z.enum(['pending', 'started', 'completed', 'error', 'ambiguous', 'denied']), startedAt: z.string().datetime().optional(), completedAt: z.string().datetime().optional(), response: z.unknown().optional(), error: z.string().max(4000).optional(), name: z.string().max(100).optional(), approvalDigest: digestSchema.optional(), operationDigest: digestSchema.optional(), approval: approvalSchema.optional(), redacted: z.boolean().optional(), reconciliation: z.object({ reviewer: z.string().max(200), note: z.string().min(1).max(2000), at: z.string().datetime() }).strict().optional() }).strict();
const recordSchema = z.object({ schemaVersion: z.literal('1'), id: idSchema, project: z.string().max(100), framework: z.enum(['native', 'langgraph']), language: z.enum(['python', 'typescript']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), status: z.enum(['running', 'paused', 'completed', 'failed', 'denied', 'needs_reconciliation']), recordContent: z.literal(true), buildHash: digestSchema, caller: z.string().min(1).max(200), tenant: z.string().max(200), scopes: z.array(z.string().max(200)).max(100), input: z.string().max(100000), events: z.array(eventSchema).max(512), output: z.string().max(1000000).optional(), error: z.string().max(4000).optional(), replayable: z.boolean(), replayCount: z.number().int().min(0).default(0) }).strict();
export type RecordedRun = z.infer<typeof recordSchema>;
export type RecordedEvent = RecordedRun['events'][number];
export interface RecordingOptions { recordContent: true; caller?: string; tenant?: string; scopes?: string[]; signal?: AbortSignal }
export interface ResumeOptions { caller?: string; tenant?: string; scopes?: string[]; signal?: AbortSignal }
export interface ApprovalOptions { expectedDigest: string; expiresInMs?: number; reviewer?: string }
export interface ReconciliationOptions { expectedDigest: string; response: unknown; note: string; reviewer?: string }
export interface ReplayResult { runId: string; matched: boolean; output: string; expectedOutput?: string; eventsReplayed: number; modelCalls: 0; toolCalls: 0; durationMs: number; error?: string }
export const localRunOperator = () => `local:${userInfo().username}`;
function now() { return new Date().toISOString(); }
function canonical(value: unknown): string { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}'; return JSON.stringify(value) ?? 'null'; }
function hash(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function bounded(value: unknown) { const json = JSON.stringify(value); if (!json || Buffer.byteLength(json) > LIMIT) throw new Error('Run data exceeds 16 MiB'); return json; }
function scrub(value: unknown): { value: any; changed: boolean } {
  const original = bounded(value); let safe = sanitizeError(original);
  safe = safe.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted]').replace(/AKIA[A-Z0-9]{16}/g, '[redacted]');
  const parsed = JSON.parse(safe);
  const walk = (v: any, depth = 0): any => {
    if (depth > 40) throw new Error('Run content nesting exceeds 40 levels');
    if (Array.isArray(v)) return v.map(x => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key)$/i.test(k) ? '[redacted]' : walk(x, depth + 1)]));
    if (typeof v === 'string' && /^[\s]*[\[{]/.test(v)) {
      let inner; try { inner = JSON.parse(v); } catch { return v; }
      const cleaned = walk(inner, depth + 1);
      if (JSON.stringify(cleaned) !== JSON.stringify(inner)) return JSON.stringify(cleaned);
    }
    return v;
  };
  const cleaned = walk(parsed); return { value: cleaned, changed: original !== JSON.stringify(cleaned) };
}
function runRoot(directory: string) { return safeChild(dirname(resolve(directory)), '.instrilo/runs'); }
function runFile(directory: string, id: string) { idSchema.parse(id); return safeChild(runRoot(directory), id + '.json'); }
async function prepareRoot(directory: string) { const root = runRoot(directory); await mkdir(root, { recursive: true, mode: 0o700 }); safeChild(root, 'probe'); return root; }
async function save(directory: string, run: RecordedRun) {
  run.updatedAt = now(); const data = bounded(recordSchema.parse(run)); const path = runFile(directory, run.id), temp = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(data + '\n'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, path); const dir = await open(dirname(path), constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); } } finally { await unlink(temp).catch(() => {}); }
}
async function exclusive<T>(directory: string, id: string, action: () => Promise<T>): Promise<T> {
  await prepareRoot(directory); const path = runFile(directory, id) + '.lock';
  let handle;
  try { handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Run is busy or has an unrecovered coordinator lock. Do not run concurrent resume/review operations.'); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: now() })); await handle.sync(); return await action(); } finally { await handle.close(); await unlink(path); }
}
export async function recoverRunLock(directory: string, id: string): Promise<void> {
  const path = runFile(directory, id) + '.lock', recoveryPath = path + '.recovery';
  let recovery;
  try { recovery = await open(recoveryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Run lock recovery is already in progress.'); throw error; }
  try {
  const info = await lstat(path); if (!info.isFile() || info.size > 4096) throw new Error('Invalid lock; inspect manually');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!Number.isInteger(value.pid) || value.pid < 1) throw new Error('Invalid lock; inspect manually');
  try { process.kill(value.pid, 0); throw new Error('Coordinator process is still alive; refusing lock recovery'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  // Recovery is an explicit local operator action, never a timeout-based takeover.
  if (await readFile(path, 'utf8') !== JSON.stringify(value)) throw new Error('Lock changed during recovery');
  await unlink(path);
  } finally { await recovery.close(); await unlink(recoveryPath); }
}
export async function getRun(directory: string, id: string): Promise<RecordedRun> {
  const path = runFile(directory, id); const stats = await lstat(path); if (!stats.isFile() || stats.size > LIMIT) throw new Error('Invalid or oversized run file');
  return recordSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
export async function listRuns(directory: string): Promise<RecordedRun[]> {
  await prepareRoot(directory); const names = await readdir(runRoot(directory)); const result = [];
  for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) result.push(await getRun(directory, name.slice(0, -5)));
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function fingerprint(spec: ProjectSpec, directory: string, checkReady = true) {
  if (checkReady) await assertBuildCurrent(spec, directory);
  const files: Record<string, string> = {};
  let total = 0;
  async function collect(prefix = '', depth = 0) {
    if (depth > 32) throw new Error('Replay source directory nesting exceeds 32 levels');
    for (const entry of await readdir(safeChild(directory, prefix || '.'), { withFileTypes: true })) {
      if (['node_modules', '.venv', '.git', '.instrilo', '__pycache__'].includes(entry.name) || entry.name === 'build-lock.json' || entry.name.startsWith('.env')) continue;
      const path = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in a replayable source build');
      if (entry.isDirectory()) { await collect(path, depth + 1); continue; }
      if (!entry.isFile()) throw new Error('Only regular runtime source files can be fingerprinted');
      const full = safeChild(directory, path), info = await lstat(full);
      total += info.size;
      if (info.size > LIMIT || total > 32 * 1024 * 1024 || Object.keys(files).length >= 2000) throw new Error('Replay source inventory exceeds its file/size limit');
      files[path] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  await collect();
  if (!Object.keys(files).some(p => p === 'session.ts' || p === 'session.py')) throw new Error('Rebuild this project to include durable session support');
  return hash({ spec, files });
}
function supported(spec: ProjectSpec) {
  if (!['native', 'langgraph'].includes(spec.framework)) throw new Error('Recording/replay/resume supports native and LangGraph only');
  if (['codex-cli', 'claude-code', 'grok-cli'].includes(spec.connections[spec.roles.runtime].kind)) throw new Error('Durable runs do not support subscription CLI providers');
  if (process.platform === 'win32') throw new Error('Durable runs currently require macOS, Linux or WSL');
}
function binding(run: RecordedRun, event: RecordedEvent) { return hash({ runId: run.id, buildHash: run.buildHash, seq: event.seq, requestHash: event.requestHash, caller: run.caller, tenant: run.tenant, scopes: run.scopes }); }
function identity(run: RecordedRun, options: ResumeOptions) {
  if ((options.caller ?? localRunOperator()) !== run.caller || (options.tenant ?? '') !== run.tenant || canonical([...(options.scopes ?? (process.env.AGENT_SCOPES ?? '').split(/\s+/).filter(Boolean))].sort()) !== canonical(run.scopes)) throw new Error('Caller, tenant or scopes differ from the recorded run');
}
function pendingEvent(run: RecordedRun) { const event = run.events.find(e => e.status === 'pending' || e.status === 'ambiguous' || e.status === 'started'); if (!event) throw new Error('No pending operation'); return event; }
export async function approveRun(directory: string, id: string, options: ApprovalOptions): Promise<RecordedRun> {
  return exclusive(directory, id, async () => {
    const run = await getRun(directory, id); if (run.status !== 'paused') throw new Error('Only a paused run can be approved');
    const event = pendingEvent(run); if (event.status !== 'pending' || !event.approvalDigest || options.expectedDigest !== event.approvalDigest || binding(run, event) !== event.approvalDigest) throw new Error('Approval digest does not match the exact pending call');
    const ttl = options.expiresInMs ?? 300000; if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600000) throw new Error('Approval expiry must be 1 ms to 1 hour');
    if (event.approval) throw new Error('This approval was already decided; create a fresh run after denial/expiry');
    event.approval = { digest: event.approvalDigest, decision: 'approved', reviewer: options.reviewer ?? localRunOperator(), expiresAt: new Date(Date.now() + ttl).toISOString(), decidedAt: now() };
    await save(directory, run); return run;
  });
}
export async function denyRun(directory: string, id: string, options: { expectedDigest: string; reviewer?: string }): Promise<RecordedRun> {
  return exclusive(directory, id, async () => { const run = await getRun(directory, id); if (run.status !== 'paused') throw new Error('Only a paused run can be denied'); const event = pendingEvent(run); if (event.approvalDigest !== options.expectedDigest || binding(run, event) !== options.expectedDigest) throw new Error('Approval digest mismatch'); if (event.approval?.decision === 'claimed') throw new Error('Approval was already consumed'); event.approval = { digest: options.expectedDigest, decision: 'denied', reviewer: options.reviewer ?? localRunOperator(), expiresAt: now(), decidedAt: now() }; event.status = 'denied'; run.status = 'denied'; await save(directory, run); return run; });
}
export async function reconcileRun(directory: string, id: string, options: ReconciliationOptions): Promise<RecordedRun> {
  return exclusive(directory, id, async () => {
    const run = await getRun(directory, id); if (run.status !== 'needs_reconciliation') throw new Error('Run does not need reconciliation'); const event = pendingEvent(run);
    if (event.kind !== 'tool' || !['started', 'ambiguous'].includes(event.status) || binding(run, event) !== options.expectedDigest) throw new Error('Reconciliation digest mismatch');
    if (!options.note.trim() || options.note.length > 2000) throw new Error('Explain how the remote outcome was verified');
    const clean = scrub(options.response); event.response = clean.value; event.redacted = clean.changed; run.replayable &&= !clean.changed; event.status = 'completed'; event.completedAt = now(); delete event.error;
    event.reconciliation = { reviewer: options.reviewer ?? localRunOperator(), note: sanitizeError(options.note), at: now() }; run.status = 'paused'; delete run.error;
    await save(directory, run); return run;
  });
}
const beforeSchema = z.object({ phase: z.literal('before'), seq: z.number().int().min(0).max(511), kind: z.enum(['model', 'tool']), request: z.unknown() }).strict();
const resultSchema = z.object({ phase: z.enum(['after', 'failure']), seq: z.number().int().min(0).max(511), ticket: z.string().uuid(), response: z.unknown().optional(), error: z.string().max(100000).optional() }).strict();
async function invoke(run: RecordedRun, spec: ProjectSpec, directory: string, options: ResumeOptions, replay: boolean): Promise<{ result?: RunResult; seen: number; error?: string }> {
  let cursor = 0; const tickets = new Map<number, string>();
  const rpc = async (raw: unknown): Promise<unknown> => {
    bounded(raw);
    if ((raw as any)?.phase === 'before') {
      const request = beforeSchema.parse(raw); if (request.seq !== cursor++) throw new Error('Out-of-order operation; refusing replay or dispatch');
      const requestHash = hash(request.request); let event = run.events[request.seq];
      if (event && (event.kind !== request.kind || event.requestHash !== requestHash)) throw new Error('Recorded operation arguments changed; no live fallback');
      if (!event) {
        if (replay) throw new Error('Replay has no recorded fixture for this operation; no live fallback');
        const clean = scrub(request.request); event = { seq: request.seq, kind: request.kind, requestHash, request: clean.value, status: 'pending', redacted: clean.changed }; run.replayable &&= !clean.changed;
        if (event.kind === 'tool') { const name = z.object({ name: z.string(), arguments: z.unknown() }).strict().parse(request.request).name; const tool = spec.agent.tools.find(t => t.name === name); if (!tool) throw new Error('Unknown tool operation'); event.name = name; event.operationDigest = binding(run, event); if (tool.requiresApproval) event.approvalDigest = binding(run, event); }
        run.events.push(event); await save(directory, run);
      }
      if (event.redacted) throw new Error('Recorded content required secret redaction; cannot safely replay/resume this operation');
      if (event.status === 'completed') return { action: 'replay', response: event.response };
      if (event.status === 'error' || event.status === 'denied') return { action: 'error', error: event.error ?? 'Recorded operation denied or failed' };
      if (replay) throw new Error('Replay encountered an incomplete operation; no live fallback');
      if (event.status === 'started' || event.status === 'ambiguous') { run.status = 'needs_reconciliation'; await save(directory, run); return { action: 'error', error: 'Operation outcome is ambiguous; reconcile it before resuming' }; }
      if (event.approvalDigest) {
        const approval = event.approval;
        if (!approval) { run.status = 'paused'; await save(directory, run); return { action: 'pause', runId: run.id, seq: event.seq, digest: event.approvalDigest, name: event.name }; }
        if (approval.decision !== 'approved' || approval.digest !== binding(run, event) || Date.parse(approval.expiresAt) <= Date.now()) throw new Error('Approval denied, consumed, expired or no longer matches the call');
        approval.decision = 'claimed'; approval.claimedAt = now();
      }
      event.status = 'started'; event.startedAt = now(); const ticket = randomUUID(); tickets.set(event.seq, ticket); await save(directory, run);
      return { action: 'execute', ticket };
    }
    const result = resultSchema.parse(raw); const event = run.events[result.seq];
    if (replay || !event || event.status !== 'started' || tickets.get(result.seq) !== result.ticket) throw new Error('Invalid or already-consumed operation ticket');
    tickets.delete(result.seq);
    if (result.phase === 'after') { const clean = scrub(result.response); event.response = clean.value; event.redacted ||= clean.changed; run.replayable &&= !clean.changed; event.status = 'completed'; event.completedAt = now(); }
    else { event.error = sanitizeError(result.error ?? 'Runtime operation failed').slice(0, 4000); event.status = event.kind === 'tool' ? 'ambiguous' : 'error'; run.status = event.kind === 'tool' ? 'needs_reconciliation' : 'failed'; }
    await save(directory, run); if (event.redacted) return { action: 'error', error: 'Recording stopped because a result contained recognizable credentials; this run is inspect-only' }; return { action: 'ack' };
  };
  try {
    const result = await runProject(spec, directory, run.input, options.signal, { rpc, beforeLaunch: async () => { if (run.buildHash !== await fingerprint(spec, directory, false)) throw new Error('Build changed before execution; refusing recorded dispatch or replay'); }, env: { AGENT_SCOPES: run.scopes.join(' '), AGENT_APPROVALS_JSON: '[]', INSTRILO_REPLAY: replay ? '1' : '' } });
    if (replay && cursor !== run.events.length) throw new Error('Replay did not consume every recorded operation');
    return { result, seen: cursor };
  } catch (error) { return { seen: cursor, error: sanitizeError(error instanceof Error ? error.message : String(error)).slice(0, 4000) }; }
}
async function continueRun(run: RecordedRun, spec: ProjectSpec, directory: string, options: ResumeOptions): Promise<RecordedRun> {
  run.status = 'running'; await save(directory, run);
  const outcome = await invoke(run, spec, directory, options, false);
  if (outcome.error) {
    const unfinished = run.events.find(e => e.kind === 'tool' && ['started', 'ambiguous'].includes(e.status));
    if (unfinished) { unfinished.status = 'ambiguous'; run.status = 'needs_reconciliation'; }
    else run.status = 'failed';
    run.error = outcome.error;
  } else if (outcome.result?.status === 'paused') run.status = 'paused';
  else { const clean = scrub(outcome.result?.output ?? ''); run.output = clean.value; run.replayable &&= !clean.changed; run.status = 'completed'; delete run.error; }
  await save(directory, run); return run;
}
export async function startRecordedRun(spec: ProjectSpec, directory: string, input: string, options: RecordingOptions): Promise<RecordedRun> {
  supported(spec); if (options?.recordContent !== true) throw new Error('Recording prompts and tool results requires explicit recordContent: true');
  if (!input.trim() || input.length > 100000) throw new Error('Invalid run input');
  const clean = scrub(input); if (clean.changed) throw new Error('Input contains recognizable credentials; remove them before recording');
  const run: RecordedRun = recordSchema.parse({ schemaVersion: '1', id: randomUUID(), project: spec.name, framework: spec.framework, language: spec.language, createdAt: now(), updatedAt: now(), status: 'running', recordContent: true, buildHash: await fingerprint(spec, directory), caller: options.caller ?? localRunOperator(), tenant: options.tenant ?? '', scopes: [...new Set(options.scopes ?? (process.env.AGENT_SCOPES ?? '').split(/\s+/).filter(Boolean))].sort(), input, events: [], replayable: true, replayCount: 0 });
  return exclusive(directory, run.id, async () => continueRun(run, spec, directory, options));
}
export async function resumeRecordedRun(spec: ProjectSpec, directory: string, id: string, options: ResumeOptions = {}): Promise<RecordedRun> {
  supported(spec); return exclusive(directory, id, async () => { const run = await getRun(directory, id); identity(run, options); if (run.buildHash !== await fingerprint(spec, directory)) throw new Error('Build changed since the run was recorded'); if (!run.replayable) throw new Error('Run contains redacted content and cannot be resumed exactly'); if (!['paused', 'running'].includes(run.status)) throw new Error('Only a paused/interrupted run can resume; reconcile uncertain tools first'); const unfinished = run.events.find(e => e.status === 'started'); if (unfinished) { unfinished.status = unfinished.kind === 'tool' ? 'ambiguous' : 'error'; run.status = unfinished.kind === 'tool' ? 'needs_reconciliation' : 'failed'; run.error = 'Coordinator stopped before recording an operation outcome'; await save(directory, run); return run; } return continueRun(run, spec, directory, options); });
}
export async function replayRun(spec: ProjectSpec, directory: string, id: string, options: ResumeOptions = {}): Promise<ReplayResult> {
  supported(spec); return exclusive(directory, id, async () => { const run = await getRun(directory, id); identity(run, options); if (run.buildHash !== await fingerprint(spec, directory)) throw new Error('Build changed; replay only executes the exact trusted local build'); if (!run.replayable) throw new Error('Run contains redacted content and is inspect-only'); if (!['completed', 'failed'].includes(run.status) || run.events.some(e => !['completed', 'error'].includes(e.status))) throw new Error('Run has incomplete operations; inspect or resume instead'); const start = Date.now(); const result = await invoke(run, spec, directory, options, true); run.replayCount++; await save(directory, run); return { runId: id, matched: run.status === 'completed' ? !result.error && result.result?.output === run.output : Boolean(result.error) && result.error === run.error, output: result.result?.output ?? '', expectedOutput: run.output, eventsReplayed: result.seen, modelCalls: 0, toolCalls: 0, durationMs: Date.now() - start, ...(result.error ? { error: result.error } : {}) }; });
}
export function runGraph(run: RecordedRun): { nodes: { id: string; kind: string; status: string; label: string }[]; edges: { from: string; to: string }[]; mermaid: string } {
  const nodes = [{ id: 'start', kind: 'start', status: 'completed', label: 'Input' }, ...run.events.map(e => ({ id: `step${e.seq}`, kind: e.kind, status: e.status, label: `${e.kind}${e.name ? ': ' + e.name : ''} (${e.status})` })), { id: 'end', kind: 'end', status: run.status, label: run.status }];
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
  const escape = (text: string) => text.replace(/[^A-Za-z0-9 _():.-]/g, '_');
  return { nodes, edges, mermaid: 'flowchart TD\n' + nodes.map(n => `  ${n.id}["${escape(n.label)}"]`).join('\n') + '\n' + edges.map(e => `  ${e.from} --> ${e.to}`).join('\n') + '\n' };
}
const bundleSchema = z.object({ schemaVersion: z.literal('1'), kind: z.literal('instrilo-run-bundle'), inspectOnly: z.literal(true), contentIncluded: z.boolean(), exportedAt: z.string().datetime(), run: recordSchema }).strict();
export async function exportRunBundle(directory: string, id: string, options: { includeContent?: boolean } = {}): Promise<string> {
  const run = structuredClone(await getRun(directory, id));
  if (!options.includeContent) { run.input = '[content omitted]'; delete run.output; for (const e of run.events) { delete e.request; delete e.response; } run.replayable = false; }
  const clean = scrub({ schemaVersion: '1', kind: 'instrilo-run-bundle', inspectOnly: true, contentIncluded: options.includeContent === true, exportedAt: now(), run });
  if (clean.changed) clean.value.run.replayable = false;
  return bounded(bundleSchema.parse(clean.value)) + '\n';
}
export function importRunBundle(content: string): { bundle: z.infer<typeof bundleSchema>; graph: ReturnType<typeof runGraph>; executable: false } {
  if (Buffer.byteLength(content) > LIMIT) throw new Error('Run bundle exceeds 16 MiB'); const parsed = JSON.parse(content);
  const clean = scrub(parsed); const bundle = bundleSchema.parse(clean.value);
  if (clean.changed) bundle.run.replayable = false;
  if (bundle.run.events.some((e, i) => e.seq !== i)) throw new Error('Invalid event ordering');
  return { bundle, graph: runGraph(bundle.run), executable: false };
}

/** Replays portable data only against an already-built matching local project. No imported code is installed. */
export async function replayRunBundle(spec: ProjectSpec, directory: string, content: string, options: { executeLocal: boolean; signal?: AbortSignal }): Promise<ReplayResult> {
  if (options.executeLocal !== true) throw new Error('Bundle inspection never executes code. Pass --execute-local to replay using your matching trusted local project.');
  supported(spec);
  const { bundle } = importRunBundle(content), run = bundle.run;
  if (!bundle.contentIncluded || !run.replayable || run.events.some(e => e.redacted)) throw new Error('A metadata-only or redacted bundle is inspect-only; complete recorded content is required for replay.');
  if (!['completed', 'failed'].includes(run.status) || run.events.some(e => !['completed', 'error'].includes(e.status))) throw new Error('Bundle has incomplete operations. Replay will not perform missing live calls.');
  if (run.buildHash !== await fingerprint(spec, directory)) throw new Error('Bundle does not match the current local source and dependency-lock fingerprints. No imported code will be executed.');
  const start = Date.now();
  const outcome = await invoke(run, spec, directory, { signal: options.signal, caller: run.caller, tenant: run.tenant, scopes: run.scopes }, true);
  return { runId: run.id, matched: run.status === 'completed' ? !outcome.error && outcome.result?.output === run.output : Boolean(outcome.error) && outcome.error === run.error, output: outcome.result?.output ?? '', expectedOutput: run.output, eventsReplayed: outcome.seen, modelCalls: 0, toolCalls: 0, durationMs: Date.now() - start, ...(outcome.error ? { error: outcome.error } : {}) };
}
