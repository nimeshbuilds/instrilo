import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { inspectGuidance, loadSpec, readCases } from './core.js';
import { manifestName, safeChild } from './workbench.js';
import type { EvalCase, EvalReport, EvalResult, GuidanceFile, Issue, ProjectSpec } from './types.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const shortText = z.string().trim().min(1).max(500);
const reason = z.string().trim().min(1).max(10_000);
const timestamp = z.string().datetime({ offset: true });
const sourcePath = z.string().min(1).max(1024).refine(p => !p.startsWith('/') && !p.includes('\\') && p.split('/').every(s => s && s !== '.' && s !== '..'), 'Use a relative path within the inspected guidance directory.');
const rootName = '.instrilo/evidence';
const MAX_BYTES = 16_000_000;

export function canonicalEvidence(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(item => canonicalEvidence(item === undefined ? null : item)).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonicalEvidence(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export const evidenceHash = (value: unknown): string => createHash('sha256').update(canonicalEvidence(value)).digest('hex');
export const reportCompatibleHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const guidanceFingerprint = (files: Pick<GuidanceFile, 'path' | 'sha256'>[]): string => reportCompatibleHash(files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export interface EvidenceSnapshot { configHash: string; datasetHash: string; guidanceHash: string; judgeHash: string }
async function projectContext(projectDir: string) {
  const root = resolve(projectDir);
  const spec = await loadSpec(safeChild(root, manifestName));
  const cases = await readCases(safeChild(root, spec.evaluation.dataset));
  const guidance = await inspectGuidance(safeChild(root, spec.guidanceDir));
  if (guidance.issues.some(i => i.level === 'error' || ['GUIDANCE_TOTAL_LIMIT', 'GUIDANCE_DEPTH_LIMIT', 'GUIDANCE_SCAN_INCOMPLETE'].includes(i.code))) throw new Error('Evidence requires a complete, readable guidance inventory.');
  const snapshot: EvidenceSnapshot = {
    configHash: reportCompatibleHash(spec), datasetHash: reportCompatibleHash(cases), guidanceHash: guidanceFingerprint(guidance.files),
    judgeHash: reportCompatibleHash({ judge: spec.connections[spec.roles.judge], rubric: spec.evaluation.rubric, threshold: spec.evaluation.threshold }),
  };
  return { root, spec, cases, guidance, snapshot };
}
export async function captureEvidenceSnapshot(projectDir: string): Promise<EvidenceSnapshot> { return (await projectContext(projectDir)).snapshot; }

/** Shared bounded storage for evidence and review modules. Checksums detect accidental alteration, not a malicious local operator. */
export async function readEvidenceDocument(projectDir: string, relativePath: string): Promise<unknown | undefined> {
  const path = safeChild(resolve(projectDir), `${rootName}/${relativePath}`);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Evidence document is not a bounded regular file.');
    const data = Buffer.alloc(Math.min(MAX_BYTES + 1, stat.size + 1));
    let size = 0;
    while (size < data.length) { const result = await handle.read(data, size, data.length - size, size); if (!result.bytesRead) break; size += result.bytesRead; }
    if (size > stat.size) throw new Error('Evidence document changed while reading.');
    const envelope = z.object({ schemaVersion: z.literal('1'), checksum: digest, data: z.unknown() }).strict().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, size))));
    if (evidenceHash(envelope.data) !== envelope.checksum) throw new Error('Evidence document checksum mismatch; restore it from a trusted copy.');
    return envelope.data;
  } finally { await handle.close(); }
}
export async function writeEvidenceDocument(projectDir: string, relativePath: string, data: unknown): Promise<void> {
  const path = safeChild(resolve(projectDir), `${rootName}/${relativePath}`);
  const text = JSON.stringify({ schemaVersion: '1', checksum: evidenceHash(data), data }, null, 2) + '\n';
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Evidence document exceeds the 16 MB limit.');
  await mkdir(dirname(path), { recursive: true });
  safeChild(resolve(projectDir), `${rootName}/${relativePath}`);
  const temporary = safeChild(resolve(projectDir), `${rootName}/${relativePath}.${randomUUID()}.pending`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(text); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(temporary).catch(() => {}); throw error; }
  await handle.close();
  try { safeChild(resolve(projectDir), `${rootName}/${relativePath}`); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
export async function withEvidenceLock<T>(projectDir: string, action: () => Promise<T>): Promise<T> {
  const root = safeChild(resolve(projectDir), rootName); await mkdir(root, { recursive: true });
  const lockPath = safeChild(resolve(projectDir), `${rootName}/write.lock`);
  let handle;
  try { handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Evidence is locked by another writer. Retry; after a crashed writer, remove write.lock only after confirming no writer is active.'); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return await action(); }
  finally { await handle.close(); await unlink(lockPath); }
}

const inputSchema = z.object({ id: identifier, title: shortText.optional(), text: reason, sourcePath, reviewer: shortText.optional(), reason: reason.optional() }).strict();
export type RequirementInput = z.infer<typeof inputSchema>;
const linkSchema = z.object({ caseId: identifier, caseHash: digest, requirementHash: digest, kind: z.enum(['deterministic', 'judge', 'human']), reviewer: shortText, reason, createdAt: timestamp }).strict();
export type RequirementLink = z.infer<typeof linkSchema>;
const waiverSchema = z.object({ requirementHash: digest, reviewer: shortText, reason, createdAt: timestamp, expiresAt: timestamp.optional() }).strict();
const requirementSchema = z.object({
  id: identifier, title: shortText, text: reason, source: z.object({ path: sourcePath, sha256: digest }).strict(),
  review: z.object({ state: z.enum(['proposed', 'reviewed']), reviewer: shortText.optional(), reason: reason.optional(), reviewedAt: timestamp.optional() }).strict(),
  revision: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp, links: z.array(linkSchema).max(1000), waiver: waiverSchema.optional(),
}).strict().superRefine((r, ctx) => { if (r.review.state === 'reviewed' && (!r.review.reviewer || !r.review.reason || !r.review.reviewedAt)) ctx.addIssue({ code: 'custom', message: 'Reviewed requirements need a reviewer, reason and date.' }); });
export type Requirement = z.infer<typeof requirementSchema>;
const stateSchema = z.object({ schemaVersion: z.literal('1'), revision: z.number().int().nonnegative(), requirements: z.array(requirementSchema).max(1000), history: z.array(requirementSchema).max(10_000), linkRemovals: z.array(z.object({ requirementId: identifier, requirementHash: digest, caseId: identifier, kind: z.enum(['deterministic', 'judge', 'human']).optional(), reviewer: shortText, reason, createdAt: timestamp }).strict()).max(10_000).default([]) }).strict();
async function loadState(projectDir: string) {
  const raw = await readEvidenceDocument(projectDir, 'requirements.json');
  const state = stateSchema.parse(raw ?? { schemaVersion: '1', revision: 0, requirements: [], history: [] });
  if (new Set(state.requirements.map(r => r.id)).size !== state.requirements.length) throw new Error('Duplicate requirement IDs in evidence state.');
  return state;
}
export function requirementFingerprint(r: Requirement): string { return evidenceHash({ id: r.id, title: r.title, text: r.text, source: r.source, review: r.review, revision: r.revision }); }
function makeRequirement(input: RequirementInput, context: Awaited<ReturnType<typeof projectContext>>, previous?: Requirement): Requirement {
  const file = context.guidance.files.find(file => file.path === input.sourcePath);
  if (!file) throw new Error(`Requirement source is not an eligible inspected guidance file: ${input.sourcePath}`);
  if (input.reviewer && !input.reason) throw new Error('A reviewed requirement needs an explicit review reason.');
  if (!input.reviewer && input.reason) throw new Error('A review reason needs a named reviewer.');
  const now = new Date().toISOString();
  return requirementSchema.parse({
    id: input.id, title: input.title ?? input.id, text: input.text, source: { path: input.sourcePath, sha256: file.sha256 },
    review: input.reviewer ? { state: 'reviewed', reviewer: input.reviewer, reason: input.reason, reviewedAt: now } : { state: 'proposed' },
    revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now, links: previous?.links ?? [],
  });
}
export async function importRequirements(projectDir: string, input: unknown): Promise<Requirement[]> {
  const inputs = Array.isArray(input) ? z.array(inputSchema).min(1).max(1000).parse(input) : z.object({ schemaVersion: z.literal('1'), requirements: z.array(inputSchema).min(1).max(1000) }).strict().parse(input).requirements;
  return withEvidenceLock(projectDir, async () => {
    const context = await projectContext(projectDir), state = await loadState(projectDir);
    const ids = new Set(state.requirements.map(r => r.id));
    const added = inputs.map(input => { if (ids.has(input.id)) throw new Error(`Requirement ${input.id} already exists or occurs twice in this import.`); ids.add(input.id); return makeRequirement(input, context); });
    state.requirements.push(...added); state.revision++;
    await writeEvidenceDocument(projectDir, 'requirements.json', stateSchema.parse(state));
    return added;
  });
}
export async function addRequirement(projectDir: string, input: RequirementInput): Promise<Requirement> { return (await importRequirements(projectDir, [input]))[0]; }
export async function listRequirements(projectDir: string): Promise<Requirement[]> { await projectContext(projectDir); return (await loadState(projectDir)).requirements; }
export async function updateRequirement(projectDir: string, id: string, patch: Partial<Omit<RequirementInput, 'id'>>, options: { expectedRevision?: number } = {}): Promise<Requirement> {
  identifier.parse(id);
  const parsed = inputSchema.omit({ id: true }).partial().parse(patch);
  return withEvidenceLock(projectDir, async () => {
    const context = await projectContext(projectDir), state = await loadState(projectDir), index = state.requirements.findIndex(r => r.id === id);
    if (index < 0) throw new Error(`Unknown requirement ${id}.`);
    const previous = state.requirements[index];
    if (options.expectedRevision !== undefined && options.expectedRevision !== previous.revision) throw new Error('Requirement changed since it was loaded. Refresh before updating.');
    const next = makeRequirement({ id, title: parsed.title ?? previous.title, text: parsed.text ?? previous.text, sourcePath: parsed.sourcePath ?? previous.source.path, reviewer: parsed.reviewer, reason: parsed.reason }, context, previous);
    state.history.push(previous); state.requirements[index] = next; state.revision++;
    await writeEvidenceDocument(projectDir, 'requirements.json', stateSchema.parse(state)); return next;
  });
}
export async function linkRequirement(projectDir: string, id: string, input: { caseId: string; kind: RequirementLink['kind']; reviewer: string; reason: string }): Promise<Requirement> {
  const parsed = z.object({ caseId: identifier, kind: z.enum(['deterministic', 'judge', 'human']), reviewer: shortText, reason }).strict().parse(input);
  return withEvidenceLock(projectDir, async () => {
    const context = await projectContext(projectDir), state = await loadState(projectDir), requirement = state.requirements.find(r => r.id === id);
    if (!requirement) throw new Error(`Unknown requirement ${id}.`);
    assertReviewedSource(requirement, context);
    const item = context.cases.find(c => c.id === parsed.caseId);
    if (!item || item.source !== 'reviewed') throw new Error('Evidence links require an existing human-reviewed case; synthetic examples cannot satisfy requirement coverage.');
    if (parsed.kind === 'deterministic' && !hasDeterministicChecks(item)) throw new Error('A deterministic link requires contains/excludes/JSON checks in its case.');
    const link: RequirementLink = { ...parsed, caseHash: reportCompatibleHash(item), requirementHash: requirementFingerprint(requirement), createdAt: new Date().toISOString() };
    requirement.links = requirement.links.filter(l => !(l.caseId === link.caseId && l.kind === link.kind)); requirement.links.push(link); delete requirement.waiver;
    state.revision++; await writeEvidenceDocument(projectDir, 'requirements.json', stateSchema.parse(state)); return requirement;
  });
}
export async function unlinkRequirement(projectDir: string, id: string, input: { caseId: string; kind?: RequirementLink['kind']; reviewer: string; reason: string }): Promise<Requirement> {
  identifier.parse(id);
  const parsed = z.object({ caseId: identifier, kind: z.enum(['deterministic', 'judge', 'human']).optional(), reviewer: shortText, reason }).strict().parse(input);
  return withEvidenceLock(projectDir, async () => {
    const state = await loadState(projectDir), requirement = state.requirements.find(r => r.id === id);
    if (!requirement) throw new Error(`Unknown requirement ${id}.`);
    const retained = requirement.links.filter(link => link.caseId !== parsed.caseId || (parsed.kind !== undefined && link.kind !== parsed.kind));
    if (retained.length === requirement.links.length) throw new Error('No matching evidence link exists.');
    state.history.push(structuredClone(requirement));
    requirement.links = retained;
    state.revision++;
    state.linkRemovals.push({ requirementId: id, requirementHash: requirementFingerprint(requirement), ...parsed, createdAt: new Date().toISOString() });
    await writeEvidenceDocument(projectDir, 'requirements.json', stateSchema.parse(state));
    return requirement;
  });
}
function assertReviewedSource(r: Requirement, context: Awaited<ReturnType<typeof projectContext>>) {
  if (r.review.state !== 'reviewed') throw new Error('Review the requirement with a named reviewer and reason before linking or waiving it.');
  if (context.guidance.files.find(f => f.path === r.source.path)?.sha256 !== r.source.sha256) throw new Error('Requirement guidance changed. Update and re-review the requirement first.');
}
export async function waiveRequirement(projectDir: string, id: string, input: { reviewer: string; reason: string; expiresAt?: string }): Promise<Requirement> {
  const parsed = z.object({ reviewer: shortText, reason, expiresAt: timestamp.optional() }).strict().parse(input);
  if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) throw new Error('A waiver must expire in the future.');
  return withEvidenceLock(projectDir, async () => {
    const context = await projectContext(projectDir), state = await loadState(projectDir), requirement = state.requirements.find(r => r.id === id);
    if (!requirement) throw new Error(`Unknown requirement ${id}.`); assertReviewedSource(requirement, context);
    requirement.waiver = { ...parsed, requirementHash: requirementFingerprint(requirement), createdAt: new Date().toISOString() };
    state.revision++; await writeEvidenceDocument(projectDir, 'requirements.json', stateSchema.parse(state)); return requirement;
  });
}

export interface RequirementStatus { requirement: Requirement; status: 'proposed' | 'stale-source' | 'uncovered' | 'stale-link' | 'ready' | 'waived'; validLinks: RequirementLink[]; staleLinks: RequirementLink[]; issues: string[] }
function statuses(requirements: Requirement[], context: Awaited<ReturnType<typeof projectContext>>): RequirementStatus[] {
  return requirements.map(requirement => {
    const hash = requirementFingerprint(requirement), issues: string[] = [];
    const sourceCurrent = context.guidance.files.find(f => f.path === requirement.source.path)?.sha256 === requirement.source.sha256;
    const validLinks = requirement.links.filter(link => { const item = context.cases.find(c => c.id === link.caseId); return !!item && item.source === 'reviewed' && reportCompatibleHash(item) === link.caseHash && link.requirementHash === hash; });
    const staleLinks = requirement.links.filter(link => !validLinks.includes(link));
    const waived = requirement.waiver?.requirementHash === hash && (!requirement.waiver.expiresAt || Date.parse(requirement.waiver.expiresAt) > Date.now());
    if (!sourceCurrent) issues.push('Guidance source changed or disappeared.');
    if (requirement.review.state !== 'reviewed') issues.push('Requirement needs human review.');
    if (staleLinks.length) issues.push('Case content or requirement revision changed; affected links need review.');
    if (requirement.waiver && !waived) issues.push('Waiver is expired or stale.');
    const status = !sourceCurrent ? 'stale-source' : requirement.review.state !== 'reviewed' ? 'proposed' : waived ? 'waived' : staleLinks.length ? 'stale-link' : validLinks.length ? 'ready' : 'uncovered';
    return { requirement, status, validLinks, staleLinks, issues };
  });
}
export async function evidenceStatus(projectDir: string) {
  const context = await projectContext(projectDir), state = await loadState(projectDir), requirements = statuses(state.requirements, context);
  return { schemaVersion: '1' as const, project: context.spec.name, revision: state.revision, snapshot: context.snapshot, requirements, counts: Object.fromEntries(['proposed', 'stale-source', 'uncovered', 'stale-link', 'ready', 'waived'].map(status => [status, requirements.filter(r => r.status === status).length])) };
}

const resultSchema = z.object({ id: identifier, input: z.string().max(100_000), output: z.string().max(1_000_000), passed: z.boolean(), caseHash: digest.optional(), trace: z.array(z.unknown()).max(100_000).optional(), checks: z.array(z.object({ name: shortText, passed: z.boolean(), detail: z.string().max(100_000) }).strict()).max(1000), judge: z.object({ score: z.number().min(0).max(1), rationale: z.string().max(100_000) }).strict().optional(), error: z.string().max(100_000).optional(), durationMs: z.number().finite().nonnegative(), usage: z.object({ inputTokens: z.number().finite().nonnegative(), outputTokens: z.number().finite().nonnegative() }).strict().optional() }).strict();
const reportSchema = z.object({ id: identifier, createdAt: timestamp, project: shortText, mode: z.enum(['live', 'demo']), split: z.enum(['development', 'holdout', 'all']), total: z.number().int().positive().max(5000), passed: z.number().int().nonnegative(), passRate: z.number().min(0).max(1), reviewed: z.number().int().nonnegative(), synthetic: z.number().int().nonnegative(), results: z.array(resultSchema).min(1).max(5000), configHash: digest, datasetHash: digest.optional(), judgeHash: digest.optional(), guidanceHash: digest.optional(), warnings: z.array(z.string().max(10_000)).max(1000) }).passthrough();
export interface RegisteredReport { schemaVersion: '1'; report: EvalReport & { guidanceHash?: string }; reportHash: string; registeredAt: string; cases: EvalCase[] }
function validateReport(input: unknown): RegisteredReport['report'] {
  const report = reportSchema.parse(input);
  if (report.total !== report.results.length || report.passed !== report.results.filter(r => r.passed).length || report.reviewed + report.synthetic !== report.total || Math.abs(report.passRate - report.passed / report.total) > 1e-9 || new Set(report.results.map(r => r.id)).size !== report.total) throw new Error('Evaluation report counts, rate or case identifiers are inconsistent.');
  return report;
}
const reportPath = (id: string) => `reports/${evidenceHash(identifier.parse(id))}.json`;
export async function registerEvidenceReport(projectDir: string, input: unknown): Promise<RegisteredReport> {
  const report = validateReport(input);
  return withEvidenceLock(projectDir, async () => {
    const prior = await readEvidenceDocument(projectDir, reportPath(report.id));
    if (prior) { const existing = parseRegistered(prior); if (existing.reportHash !== evidenceHash(report)) throw new Error('A different report already uses this report ID. Reports are immutable; use a new evaluation ID.'); return existing; }
    const context = await projectContext(projectDir);
    if (report.project !== context.spec.name) throw new Error('Evaluation report belongs to a different project.');
    const registered: RegisteredReport = { schemaVersion: '1', report, reportHash: evidenceHash(report), registeredAt: new Date().toISOString(), cases: context.cases.filter(c => report.results.some(r => r.id === c.id && r.caseHash === reportCompatibleHash(c))) };
    await writeEvidenceDocument(projectDir, reportPath(report.id), registered); return registered;
  });
}
function parseRegistered(input: unknown): RegisteredReport {
  const envelope = z.object({ schemaVersion: z.literal('1'), report: z.unknown(), reportHash: digest, registeredAt: timestamp, cases: z.array(z.unknown()).max(5000) }).strict().parse(input);
  const report = validateReport(envelope.report);
  if (evidenceHash(report) !== envelope.reportHash) throw new Error('Registered report was altered.');
  const cases = envelope.cases as EvalCase[];
  if (cases.some(c => !report.results.some(r => r.id === c.id && r.caseHash === reportCompatibleHash(c))) || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Registered case snapshot was altered.');
  return { ...envelope, report, cases };
}
export async function loadRegisteredReport(projectDir: string, idOrPath: string): Promise<RegisteredReport> {
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(idOrPath)) {
    const saved = await readEvidenceDocument(projectDir, reportPath(idOrPath)); if (saved) return parseRegistered(saved);
  }
  const path = safeChild(resolve(projectDir), idOrPath);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat(); if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Report must be a bounded regular JSON file.');
    const bytes = Buffer.alloc(stat.size + 1); let length = 0;
    while (length < bytes.length) { const next = await handle.read(bytes, length, bytes.length - length, length); if (!next.bytesRead) break; length += next.bytesRead; }
    if (length > stat.size) throw new Error('Report changed while reading.');
    return await registerEvidenceReport(projectDir, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))));
  } finally { await handle.close(); }
}
export async function reportFreshness(projectDir: string, registered: RegisteredReport): Promise<{ current: boolean; issues: Issue[]; snapshot: EvidenceSnapshot }> {
  const context = await projectContext(projectDir), report = registered.report, issues: Issue[] = [];
  const add = (code: string, message: string) => issues.push({ level: 'error', code, message });
  if (report.project !== context.spec.name) add('REPORT_PROJECT_CHANGED', 'Report project does not match the current project.');
  if (report.configHash !== context.snapshot.configHash) add('REPORT_CONFIG_CHANGED', 'Configuration changed since evaluation.');
  if (report.judgeHash !== context.snapshot.judgeHash) add('REPORT_JUDGE_CHANGED', 'Judge, rubric or threshold changed, or the report lacks a judge fingerprint.');
  if (report.guidanceHash !== context.snapshot.guidanceHash) add('REPORT_GUIDANCE_CHANGED', 'Guidance changed, or the report lacks an evaluation-time guidance fingerprint.');
  const selected = context.cases.filter(c => report.split === 'all' || c.split === report.split);
  if (report.datasetHash !== reportCompatibleHash(selected)) add('REPORT_DATASET_CHANGED', 'The selected evaluation dataset changed or lacks a fingerprint.');
  if (selected.length !== report.results.length || selected.some(c => !report.results.some(r => r.id === c.id && r.caseHash === reportCompatibleHash(c) && r.input === c.input))) add('REPORT_CASE_CHANGED', 'Report cases do not match the current selected dataset.');
  if (report.reviewed !== selected.filter(c => c.source === 'reviewed').length || report.synthetic !== selected.filter(c => c.source === 'synthetic').length) add('REPORT_PROVENANCE_MISMATCH', 'Reported case provenance does not match the dataset.');
  const mode = context.spec.connections[context.spec.roles.runtime].kind === 'demo' || context.spec.connections[context.spec.roles.judge].kind === 'demo' ? 'demo' : 'live';
  if (report.mode !== mode) add('REPORT_MODE_MISMATCH', 'The reported mode does not match the configured runtime and judge.');
  return { current: issues.length === 0, issues, snapshot: context.snapshot };
}

export const releasePolicySchema = z.object({ schemaVersion: z.literal('1'), allowDemo: z.boolean().default(false), allowSynthetic: z.boolean().default(false), allowWaived: z.boolean().default(false), requireHoldout: z.boolean().default(true), requireAllCasesPass: z.boolean().default(true), requireDeterministic: z.boolean().default(true), requireHumanReview: z.boolean().default(false), minHumanReviews: z.number().int().min(1).max(20).default(1) }).strict();
export type ReleasePolicy = z.infer<typeof releasePolicySchema>;
export function parseReleasePolicy(input: unknown = { schemaVersion: '1' }): ReleasePolicy { return releasePolicySchema.parse(input); }
export async function importReleasePolicy(projectDir: string, input: unknown): Promise<ReleasePolicy> {
  const policy = parseReleasePolicy(input);
  await withEvidenceLock(projectDir, () => writeEvidenceDocument(projectDir, 'release-policy.json', policy)); return policy;
}
export async function loadReleasePolicy(projectDir: string): Promise<ReleasePolicy> { return parseReleasePolicy(await readEvidenceDocument(projectDir, 'release-policy.json') ?? { schemaVersion: '1' }); }
function hasDeterministicChecks(item: EvalCase): boolean { return !!(item.contains?.length || item.excludes?.length || item.requireJson); }
function deterministicPass(item: EvalCase, result: EvalResult): boolean {
  if (result.error || !result.output.trim()) return false;
  if (item.contains?.some(text => !result.output.toLowerCase().includes(text.toLowerCase()))) return false;
  if (item.excludes?.some(text => result.output.toLowerCase().includes(text.toLowerCase()))) return false;
  if (item.requireJson) { try { JSON.parse(result.output); } catch { return false; } }
  return true;
}
export async function releaseEvidence(projectDir: string, idOrPath: string, inputPolicy?: unknown) {
  const registered = await loadRegisteredReport(projectDir, idOrPath);
  const policy = inputPolicy === undefined ? await loadReleasePolicy(projectDir) : parseReleasePolicy(inputPolicy);
  const context = await projectContext(projectDir), status = await evidenceStatus(projectDir), freshness = await reportFreshness(projectDir, registered), report = registered.report;
  const issues: Issue[] = [...freshness.issues];
  const add = (code: string, message: string, path?: string) => issues.push({ level: 'error', code, message, ...(path ? { path } : {}) });
  if (!status.requirements.length) add('NO_REQUIREMENTS', 'No requirements are recorded.');
  if (report.mode === 'demo' && !policy.allowDemo) add('DEMO_EVIDENCE', 'Offline/demo reports cannot satisfy this release policy.');
  if (report.synthetic && !policy.allowSynthetic) add('SYNTHETIC_EVIDENCE', 'Synthetic cases are present and this policy disallows them.');
  if (policy.requireHoldout && report.split !== 'holdout') add('HOLDOUT_REQUIRED', 'An isolated holdout evaluation is required.');
  const { reviewAssessments, reviewEvidenceRevision } = await import('./review.js');
  const hasReviewBindings = !!report.judgeHash && report.results.every(result => !!result.caseHash);
  const assessments = hasReviewBindings ? await reviewAssessments(projectDir, registered.report.id) : { revision: await reviewEvidenceRevision(projectDir), cases: [] };
  if (!hasReviewBindings) add('REPORT_REVIEW_BINDING_MISSING', 'The report lacks case or judge fingerprints required for bound human review. Re-evaluate the project.');
  const checkedResults = report.results.map(result => {
    const item = context.cases.find(c => c.id === result.id);
    const deterministic = item ? deterministicPass(item, result) : false;
    const judge = report.mode === 'demo' ? true : !!result.judge && result.judge.score >= context.spec.evaluation.threshold;
    const passed = deterministic && judge && result.passed && !result.error;
    if (policy.requireAllCasesPass && !passed) add('CASE_FAILED', `Case ${result.id} failed a current deterministic/judge check or execution.`, result.id);
    return { id: result.id, passed, deterministic, hasDeterministic: !!item && hasDeterministicChecks(item), judge };
  });
  const requirements = status.requirements.map(item => {
    const requirement = item.requirement;
    if (item.status === 'waived') {
      if (!policy.allowWaived) add('WAIVER_DISALLOWED', 'A recorded waiver requires an explicit allowWaived policy.', requirement.id);
      return { id: requirement.id, status: 'waived', waiver: requirement.waiver, linkedCases: [] as string[] };
    }
    if (item.status !== 'ready') add('REQUIREMENT_NOT_READY', `Requirement ${requirement.id} is ${item.status}.`, requirement.id);
    const links = item.validLinks;
    if (policy.requireDeterministic && !links.some(link => link.kind === 'deterministic' && checkedResults.some(r => r.id === link.caseId && r.hasDeterministic))) add('DETERMINISTIC_EVIDENCE_REQUIRED', 'This requirement needs a reviewed deterministic check, not only a judge or human label.', requirement.id);
    for (const link of links) {
      const result = checkedResults.find(r => r.id === link.caseId);
      if (!result) add('LINKED_CASE_MISSING', `Linked case ${link.caseId} was not evaluated in this report.`, requirement.id);
      else if (!result.passed) add('LINKED_CASE_FAILED', `Linked case ${link.caseId} failed.`, requirement.id);
      const human = assessments.cases.find(c => c.caseId === link.caseId);
      if (human?.status === 'disagreement' || human?.verdict === 'fail') add('HUMAN_REVIEW_REJECTED', `Case ${link.caseId} has a human rejection or unresolved disagreement.`, requirement.id);
      if ((policy.requireHumanReview || link.kind === 'human') && (!human || human.verdict !== 'pass' || human.reviewers < policy.minHumanReviews)) add('HUMAN_REVIEW_REQUIRED', `Case ${link.caseId} needs ${policy.minHumanReviews} agreeing human pass review(s).`, requirement.id);
    }
    return { id: requirement.id, status: item.status, linkedCases: links.map(link => link.caseId) };
  });
  return withEvidenceLock(projectDir, async () => {
  // Serialize the final evidence check and save against requirement/review writers.
  const after = await captureEvidenceSnapshot(projectDir), afterState = await loadState(projectDir), afterReviews = await reviewEvidenceRevision(projectDir);
  if ([status.snapshot, freshness.snapshot, after].some(snapshot => evidenceHash(snapshot) !== evidenceHash(context.snapshot)) || afterState.revision !== status.revision || afterReviews !== assessments.revision) add('EVIDENCE_CHANGED_DURING_RELEASE', 'Project, requirement or review evidence changed while the gate ran; rerun the gate.');
  const result = {
    schemaVersion: '1' as const, id: randomUUID(), createdAt: new Date().toISOString(), project: context.spec.name,
    reportId: report.id, reportHash: registered.reportHash, snapshot: context.snapshot, policy, policyHash: evidenceHash(policy), requirementsRevision: status.revision, reviewsRevision: assessments.revision,
    allowed: !issues.some(i => i.level === 'error'), classification: report.mode === 'demo' ? 'smoke-only' : 'release-evidence',
    requirements, cases: checkedResults, issues,
    exceptions: [...(report.mode === 'demo' && policy.allowDemo ? ['Demo evidence explicitly allowed; this remains a smoke-only decision.'] : []), ...(report.synthetic && policy.allowSynthetic ? ['Synthetic report cases explicitly allowed; requirement links still require reviewed cases.'] : []), ...requirements.filter(r => r.status === 'waived').map(r => `Waived requirement: ${r.id}`)],
    limitations: ['Local operator-owned records are not cryptographic attestation or independent identity verification.', 'Coverage links are reviewed assertions, not proof that tests fully capture requirement meaning.'],
  };
  await writeEvidenceDocument(projectDir, `releases/${result.id}.json`, result);
  return result;
  });
}
