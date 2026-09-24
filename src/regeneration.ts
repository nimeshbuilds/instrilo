import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Artifact } from './types.js';

const STATE = '.instrilo';
const CURRENT = STATE + '/current.json';
const JOURNAL = STATE + '/transaction.json';
const LOCK = STATE + '/write.lock';
const MAX_FILE = 16 * 1024 * 1024;
const MAX_STATE = 128 * 1024 * 1024;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const digestPattern = /^[a-f0-9]{64}$/;

export interface GeneratorMetadata {
  version: string;
  fingerprint: string;
  sourceHashes: Record<string, string>;
  templateHashes: Record<string, string>;
  adapterHashes?: Record<string, string>;
}
interface BaselineFile { sha256: string; content?: string; mode: number }
interface Baseline { schemaVersion: '2'; generator: GeneratorMetadata; files: Record<string, BaselineFile> }
interface Current { schemaVersion: '2'; generationId: string; appliedFiles: Record<string, string | null>; updatedAt: string }
interface Snapshot { bytes: Buffer; sha256: string; mode: number }
interface Operation { path: string; before: string | null; after: string | null; beforeMode: number; afterMode: number }
interface Journal { schemaVersion: '1'; id: string; phase: 'prepared' | 'committed'; operations: Operation[] }
interface Lock { schemaVersion: '1'; pid: number; host: string; token: string; createdAt: string }
export type ChangeAction = 'add' | 'update' | 'merge' | 'delete' | 'preserve' | 'unchanged' | 'conflict';
export interface RegenerationChange {
  path: string; action: ChangeAction; reason: string;
  baseHash?: string; currentHash?: string; incomingHash?: string;
  baseMode?: number; currentMode?: number; incomingMode?: number;
}
export interface RegenerationPlan {
  directory: string; planHash: string; generationId: string; previousGenerationId?: string;
  changes: RegenerationChange[]; conflicts: string[]; metadata: GeneratorMetadata; migrationNeeded: boolean;
}
export interface RegenerationOptions {
  dryRun?: boolean;
  merge?: boolean;
  expectedPlanHash?: string;
  /** Advanced API callers can protect source mirrors against local edits. */
  protectedPaths?: string[];
}
export class RegenerationConflictError extends Error {
  constructor(readonly plan: RegenerationPlan) { super('Regeneration conflicts; no project files were written: ' + plan.conflicts.join(', ')); }
}

/** Only relative regular files inside the selected root are eligible for replacement. */
async function checkedPath(root: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe managed path: ' + path);
  const absoluteRoot = resolve(root), absolute = resolve(root, path);
  if (!absolute.startsWith(absoluteRoot + sep)) throw new Error('Managed path escapes project');
  let cursor = absoluteRoot;
  for (const part of ['', ...path.split('/')]) {
    if (part) cursor = join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed in managed paths: ' + path);
      if (cursor !== absolute && !info.isDirectory()) throw new Error('Managed path parent is not a directory: ' + path);
    } catch (error) { if (!absent(error)) throw error; }
  }
  return absolute;
}
async function snapshot(root: string, path: string, max = MAX_FILE): Promise<Snapshot | null> {
  const absolute = await checkedPath(root, path);
  let handle;
  try { handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) { if (absent(error)) return null; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw new Error('Managed file is not a bounded regular file: ' + path);
    const bytes = await handle.readFile();
    if (bytes.length > max) throw new Error('Managed file exceeds size limit: ' + path);
    return { bytes, sha256: hash(bytes), mode: info.mode & 0o777 };
  } finally { await handle.close(); }
}
async function readJson(root: string, path: string, max = MAX_STATE): Promise<any | null> {
  const file = await snapshot(root, path, max);
  return file ? JSON.parse(file.bytes.toString('utf8')) : null;
}
async function atomicWrite(root: string, path: string, bytes: Buffer, mode = 0o600, expected?: { content: string | null; mode: number }): Promise<void> {
  const absolute = await checkedPath(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await checkedPath(root, path);
  const temporary = relative(resolve(root), join(dirname(absolute), '.instrilo-tmp-' + randomUUID())).split(sep).join('/');
  const tmp = await checkedPath(root, temporary);
  const handle = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    try { await handle.writeFile(bytes); await handle.chmod(mode); await handle.sync(); } finally { await handle.close(); }
    await checkedPath(root, path);
    if (expected && !(await sameSnapshot(root, path, expected.content, expected.content === null ? undefined : expected.mode))) throw new Error('File changed immediately before replacement: ' + path);
    await rename(tmp, absolute);
  } finally { await unlink(tmp).catch(() => {}); }
}
async function sameSnapshot(root: string, path: string, expected: string | null, mode?: number): Promise<boolean> {
  const current = await snapshot(root, path, path.startsWith(STATE + '/') ? MAX_STATE : MAX_FILE);
  return expected === null ? current === null : !!current && current.bytes.equals(Buffer.from(expected, 'base64')) && (mode === undefined || current.mode === mode);
}

function validateBaseline(value: any): Baseline {
  if (value?.schemaVersion !== '2' || !value.generator || typeof value.generator.version !== 'string' || !digestPattern.test(value.generator.fingerprint) || !value.files || Array.isArray(value.files) || typeof value.files !== 'object') throw new Error('Invalid generation baseline');
  for (const [path, file] of Object.entries(value.files) as [string, BaselineFile][]) {
    if (!file || !digestPattern.test(file.sha256) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || (file.content !== undefined && (typeof file.content !== 'string' || hash(file.content) !== file.sha256))) throw new Error('Invalid baseline file: ' + path);
    if (path.startsWith(STATE + '/') || isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe baseline path');
  }
  return value;
}
async function state(root: string): Promise<{ baseline: Baseline | null; id?: string; current: Current | null; legacy?: Snapshot }> {
  const current = await readJson(root, CURRENT) as Current | null;
  if (current) {
    if (current.schemaVersion !== '2' || !digestPattern.test(current.generationId) || !current.appliedFiles || typeof current.appliedFiles !== 'object') throw new Error('Unsupported or corrupt generation sidecar; restore it from a trusted backup');
    const raw = await snapshot(root, `${STATE}/baselines/${current.generationId}.json`, MAX_STATE);
    if (!raw || hash(raw.bytes) !== current.generationId) throw new Error('Generation baseline fingerprint does not match its immutable content');
    return { baseline: validateBaseline(JSON.parse(raw.bytes.toString('utf8'))), id: current.generationId, current };
  }
  const legacy = await snapshot(root, 'build-lock.json');
  if (!legacy) return { baseline: null, current: null };
  const old = JSON.parse(legacy.bytes.toString('utf8'));
  if (old.schemaVersion !== '1' || !old.generatedFiles || typeof old.generatedFiles !== 'object') throw new Error('Unsupported build-lock schema; cannot infer file ownership safely');
  const files: Record<string, BaselineFile> = Object.create(null);
  for (const [path, sha256] of Object.entries(old.generatedFiles)) {
    if (typeof sha256 !== 'string' || !digestPattern.test(sha256)) throw new Error('Invalid legacy generated-file fingerprint');
    const file = await snapshot(root, path);
    files[path] = { sha256, ...(file?.sha256 === sha256 ? { content: file.bytes.toString('utf8') } : {}), mode: file?.mode ?? 0o644 };
  }
  files['build-lock.json'] = { sha256: legacy.sha256, content: legacy.bytes.toString('utf8'), mode: legacy.mode };
  const sourceHashes = { 'legacy-build-lock': legacy.sha256 };
  const baseline = validateBaseline({ schemaVersion: '2', generator: { version: String(old.generator ?? 'unknown'), sourceHashes, templateHashes: {}, fingerprint: hash(JSON.stringify(sourceHashes)) }, files });
  return { baseline, id: hash(json(baseline)), current: null, legacy };
}

/** Fingerprints capture the exact implementation and template bytes used, not a mutable tag. */
export async function generatorMetadata(adapterHashes?: Record<string, string>): Promise<GeneratorMetadata> {
  const base = dirname(fileURLToPath(import.meta.url));
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const pkg = JSON.parse(await readFile(join(base, '../package.json'), 'utf8'));
  const sourceHashes: Record<string, string> = {}, templateHashes: Record<string, string> = {};
  for (const name of ['core', 'generators', 'regeneration', 'workbench', 'adapters']) sourceHashes[name + extension] = hash(await readFile(join(base, name + extension)));
  for (const name of (await readdir(join(base, 'templates'))).sort()) if (name.endsWith('.tpl') || name === 'frameworks' + extension) templateHashes[name] = hash(await readFile(join(base, 'templates', name)));
  const fields = { version: String(pkg.version), sourceHashes, templateHashes, ...(adapterHashes ? { adapterHashes: Object.fromEntries(Object.entries(adapterHashes).sort(([a], [b]) => a.localeCompare(b))) } : {}) };
  return { ...fields, fingerprint: hash(JSON.stringify(fields)) };
}

interface Hunk { start: number; end: number; lines: string[] }
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
function edits(base: string[], changed: string[]): Hunk[] | null {
  const width = changed.length + 1;
  if ((base.length + 1) * width > 4_000_000) return null;
  const table = new Uint32Array((base.length + 1) * width);
  for (let i = base.length - 1; i >= 0; i--) for (let j = changed.length - 1; j >= 0; j--) table[i * width + j] = base[i] === changed[j] ? 1 + table[(i + 1) * width + j + 1] : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const hunks: Hunk[] = []; let i = 0, j = 0, pending: Hunk | undefined;
  const flush = () => { if (pending) { pending.end = i; hunks.push(pending); pending = undefined; } };
  while (i < base.length || j < changed.length) {
    if (i < base.length && j < changed.length && base[i] === changed[j]) { flush(); i++; j++; continue; }
    pending ??= { start: i, end: i, lines: [] };
    if (j < changed.length && (i === base.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) pending.lines.push(changed[j++]);
    else i++;
  }
  flush(); return hunks;
}
/** Conservative line-based three-way merge. Boundary insertions conflict rather than guessing. */
export function mergeText(base: string, current: string, incoming: string): { content?: string; conflict?: string } {
  if (current === base) return { content: incoming };
  if (incoming === base || incoming === current) return { content: current };
  if ([base, current, incoming].some(text => text.includes('\0'))) return { conflict: 'Binary content cannot be merged' };
  const original = lines(base), ours = edits(original, lines(current)), theirs = edits(original, lines(incoming));
  if (!ours || !theirs) return { conflict: 'Text exceeds the bounded merge limit' };
  const combined = [...ours];
  for (const other of theirs) {
    let identical = false;
    for (const own of ours) {
      if (own.start === other.start && own.end === other.end && JSON.stringify(own.lines) === JSON.stringify(other.lines)) { identical = true; continue; }
      const overlaps = own.start === own.end ? own.start >= other.start && own.start <= other.end
        : other.start === other.end ? other.start >= own.start && other.start <= own.end
        : own.start < other.end && other.start < own.end;
      if (overlaps) return { conflict: 'Both sides changed overlapping lines' };
    }
    if (!identical) combined.push(other);
  }
  combined.sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0, content = '';
  for (const change of combined) { content += original.slice(cursor, change.start).join('') + change.lines.join(''); cursor = change.end; }
  return { content: content + original.slice(cursor).join('') };
}

async function userFiles(root: string, known: Set<string>): Promise<string[]> {
  const found: string[] = [];
  const skipped = new Set([STATE, '.git', 'node_modules', '.venv', '__pycache__', 'dist', '.deployment', 'artifacts']);
  async function visit(path = '') {
    let entries;
    try { entries = await readdir(path ? join(root, path) : root, { withFileTypes: true }); } catch (error) { if (absent(error)) return; throw error; }
    for (const entry of entries) {
      if (!path && entry.name === STATE) continue;
      const child = path ? path + '/' + entry.name : entry.name;
      if (found.length > 10000) throw new Error('Too many user-owned paths to inspect');
      if (entry.isDirectory() && !skipped.has(entry.name)) await visit(child);
      else if (!known.has(child)) found.push(child + (entry.isDirectory() ? '/' : ''));
    }
  }
  await visit(); return found.sort();
}
async function computePlan(directory: string, artifacts: Artifact[], metadata: GeneratorMetadata, options: RegenerationOptions, overwrite: boolean) {
  const root = resolve(directory);
  await checkedPath(root, 'build-lock.json');
  if (await snapshot(root, JOURNAL, MAX_STATE)) throw new Error('An interrupted generation needs recovery before planning or updating');
  const previous = await state(root), nextFiles: Record<string, BaselineFile> = Object.create(null);
  for (const artifact of artifacts) {
    await checkedPath(root, artifact.path);
    if (artifact.path.startsWith(STATE + '/') || artifact.path === STATE || Object.hasOwn(nextFiles, artifact.path)) throw new Error('Duplicate or reserved generated path: ' + artifact.path);
    if (Buffer.byteLength(artifact.content) > MAX_FILE) throw new Error('Generated artifact exceeds size limit');
    nextFiles[artifact.path] = { sha256: hash(artifact.content), content: artifact.content, mode: artifact.executable ? 0o755 : 0o644 };
  }
  const baseline: Baseline = { schemaVersion: '2', generator: metadata, files: nextFiles };
  const generationId = hash(json(baseline));
  const changes: RegenerationChange[] = [], operations: Operation[] = [], appliedFiles: Record<string, string | null> = Object.create(null);
  const protectedFile = (path: string) => (options.protectedPaths ?? []).some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix);
  const known = new Set([...Object.keys(previous.baseline?.files ?? {}), ...Object.keys(nextFiles)]);
  for (const path of [...known].sort()) {
    const base = previous.baseline && Object.hasOwn(previous.baseline.files, path) ? previous.baseline.files[path] : undefined;
    const incoming = Object.hasOwn(nextFiles, path) ? nextFiles[path] : undefined;
    let current: Snapshot | null;
    try { current = await snapshot(root, path); }
    catch (error) { changes.push({ path, action: 'conflict', reason: (error as Error).message }); continue; }
    const entry: RegenerationChange = { path, action: 'unchanged', reason: 'Matches the generated baseline', ...(base ? { baseHash: base.sha256, baseMode: base.mode } : {}), ...(current ? { currentHash: current.sha256, currentMode: current.mode } : {}), ...(incoming ? { incomingHash: incoming.sha256, incomingMode: incoming.mode } : {}) };
    let output = current?.bytes ?? null, mode = current?.mode ?? incoming?.mode ?? 0o644;
    if (!overwrite && current && incoming) { entry.action = 'conflict'; entry.reason = 'Refusing to overwrite existing output; request safe regeneration explicitly'; }
    else if (!incoming) {
      if (current && current.sha256 === base?.sha256 && current.mode === base.mode) { entry.action = 'delete'; entry.reason = 'Unmodified artifact is no longer generated'; output = null; }
      else if (current) { entry.action = 'preserve'; entry.reason = 'Modified obsolete artifact becomes user-owned'; }
      else entry.reason = 'Obsolete artifact is already absent';
    } else if (!base) {
      if (current) { entry.action = 'conflict'; entry.reason = 'User-owned file collides with a new generated artifact'; }
      else { entry.action = 'add'; entry.reason = 'New generated artifact'; output = Buffer.from(incoming.content!); mode = incoming.mode; }
    } else if (current?.sha256 === incoming.sha256) { entry.reason = 'Current content already equals incoming generation'; }
    else if (protectedFile(path) && current?.sha256 !== base.sha256) { entry.action = 'conflict'; entry.reason = 'Source-controlled mirror was edited or removed; update its source instead'; }
    else if (current?.sha256 === base.sha256) { entry.action = 'update'; entry.reason = 'Replace unchanged generated content'; output = Buffer.from(incoming.content!); mode = incoming.mode; }
    else if (incoming.sha256 === base.sha256) { entry.action = 'preserve'; entry.reason = current ? 'Generator is unchanged; keep user edits' : 'Generator is unchanged; keep user deletion'; }
    else if (!current) { entry.action = 'conflict'; entry.reason = 'User deleted a file that the generator also changed'; }
    else if (options.merge && base.content !== undefined && Buffer.from(current.bytes.toString('utf8')).equals(current.bytes)) {
      const merged = mergeText(base.content, current.bytes.toString('utf8'), incoming.content!);
      if (merged.content !== undefined) { entry.action = 'merge'; entry.reason = 'Nonoverlapping line edits merged with the retained baseline'; output = Buffer.from(merged.content); }
      else { entry.action = 'conflict'; entry.reason = merged.conflict!; }
    } else { entry.action = 'conflict'; entry.reason = base.content === undefined ? 'Legacy baseline content is unavailable for a three-way merge' : 'Both user and generator changed this file; review a merge plan'; }
    if (incoming && base && current && entry.action !== 'conflict') {
      if (incoming.mode === base.mode) mode = current.mode;
      else if (current.mode !== base.mode && current.mode !== incoming.mode) { entry.action = 'conflict'; entry.reason = 'User and generator both changed file permissions'; }
      else {
        mode = incoming.mode;
        if (mode !== current.mode && ['unchanged', 'preserve'].includes(entry.action)) { entry.action = 'update'; entry.reason = 'Apply a generator permission change while retaining current content'; }
      }
    }
    changes.push(entry);
    if (incoming) appliedFiles[path] = output ? hash(output) : null;
    if (entry.action !== 'conflict' && (output === null ? current !== null : !current || !output.equals(current.bytes) || mode !== current.mode)) operations.push({ path, before: current?.bytes.toString('base64') ?? null, after: output?.toString('base64') ?? null, beforeMode: current?.mode ?? 0o644, afterMode: mode });
  }
  for (const path of await userFiles(root, known)) changes.push({ path, action: 'preserve', reason: 'User-owned path is outside the generation baseline' });
  const planFields = { directory: root, generationId, ...(previous.id ? { previousGenerationId: previous.id } : {}), changes, conflicts: changes.filter(c => c.action === 'conflict').map(c => c.path), metadata, migrationNeeded: !!previous.legacy };
  const plan: RegenerationPlan = { ...planFields, planHash: hash(JSON.stringify(planFields)) };
  return { plan, operations, baseline, previous, appliedFiles };
}
export async function planRegeneration(directory: string, artifacts: Artifact[], metadata: GeneratorMetadata, options: RegenerationOptions = {}, overwrite = true): Promise<RegenerationPlan> {
  return (await computePlan(directory, artifacts, metadata, options, overwrite)).plan;
}

async function acquire(root: string): Promise<{ lock: Lock; release: () => Promise<void> }> {
  const path = await checkedPath(root, LOCK);
  await mkdir(dirname(path), { recursive: true });
  await checkedPath(root, LOCK);
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Generation is locked; inspect it and recover a dead process before retrying'); throw error; }
  const lock: Lock = { schemaVersion: '1', pid: process.pid, host: hostname(), token: randomUUID(), createdAt: new Date().toISOString() };
  try { await handle.writeFile(json(lock)); await handle.sync(); } finally { await handle.close(); }
  return { lock, release: async () => {
    const actual = await readJson(root, LOCK);
    if (actual?.token !== lock.token) throw new Error('Generation lock changed unexpectedly');
    await unlink(await checkedPath(root, LOCK));
  } };
}
async function immutableOperation(root: string, path: string, content: string): Promise<Operation | null> {
  const old = await snapshot(root, path, MAX_STATE);
  if (old) { if (!old.bytes.equals(Buffer.from(content))) throw new Error('Immutable generation record was modified: ' + path); return null; }
  return { path, before: null, after: Buffer.from(content).toString('base64'), beforeMode: 0o600, afterMode: 0o600 };
}
async function metadataOperations(root: string, baseline: Baseline, appliedFiles: Record<string, string | null>, legacy?: Snapshot): Promise<Operation[]> {
  const operations: Operation[] = [], content = json(baseline), id = hash(content);
  const immutable = await immutableOperation(root, `${STATE}/baselines/${id}.json`, content); if (immutable) operations.push(immutable);
  if (legacy) { const backup = await immutableOperation(root, `${STATE}/backups/build-lock-v1-${legacy.sha256}.json`, legacy.bytes.toString('utf8')); if (backup) operations.push(backup); }
  const prior = await snapshot(root, CURRENT, MAX_STATE);
  const current: Current = { schemaVersion: '2', generationId: id, appliedFiles, updatedAt: new Date().toISOString() };
  operations.push({ path: CURRENT, before: prior?.bytes.toString('base64') ?? null, after: Buffer.from(json(current)).toString('base64'), beforeMode: prior?.mode ?? 0o600, afterMode: 0o600 });
  return operations;
}
async function replace(root: string, operation: Operation, rollback = false) {
  const data = rollback ? operation.before : operation.after, mode = rollback ? operation.beforeMode : operation.afterMode;
  const expected = { content: rollback ? operation.after : operation.before, mode: rollback ? operation.afterMode : operation.beforeMode };
  if (data === null) {
    if (!(await sameSnapshot(root, operation.path, expected.content, expected.content === null ? undefined : expected.mode))) throw new Error('File changed immediately before removal: ' + operation.path);
    try { await unlink(await checkedPath(root, operation.path)); } catch (error) { if (!absent(error)) throw error; }
  } else await atomicWrite(root, operation.path, Buffer.from(data, 'base64'), mode, expected);
}
function validateJournal(value: any): Journal {
  if (value?.schemaVersion !== '1' || !['prepared', 'committed'].includes(value.phase) || !Array.isArray(value.operations) || value.operations.length > 10000) throw new Error('Invalid transaction journal; inspect it manually');
  const seen = new Set<string>();
  for (const op of value.operations) {
    if (!op || typeof op.path !== 'string' || seen.has(op.path) || op.path === LOCK || op.path === JOURNAL || (op.before !== null && typeof op.before !== 'string') || (op.after !== null && typeof op.after !== 'string') || !Number.isInteger(op.beforeMode) || !Number.isInteger(op.afterMode) || op.beforeMode < 0 || op.beforeMode > 0o777 || op.afterMode < 0 || op.afterMode > 0o777) throw new Error('Invalid transaction operation');
    seen.add(op.path);
  }
  return value;
}
async function recoverJournal(root: string): Promise<{ status: string; paths: string[] }> {
  const raw = await readJson(root, JOURNAL); if (!raw) return { status: 'nothing-to-recover', paths: [] };
  const journal = validateJournal(raw), reverse = [...journal.operations].reverse();
  // Check every path before recovery writes anything: do not overwrite post-crash user edits.
  for (const op of reverse) {
    const after = await sameSnapshot(root, op.path, op.after, op.after === null ? undefined : op.afterMode);
    if (!after && (journal.phase === 'committed' || !(await sameSnapshot(root, op.path, op.before, op.before === null ? undefined : op.beforeMode)))) throw new Error('Recovery conflicts with a newer user edit: ' + op.path);
  }
  if (journal.phase === 'prepared') for (const op of reverse) if (!(await sameSnapshot(root, op.path, op.before, op.before === null ? undefined : op.beforeMode))) await replace(root, op, true);
  await unlink(await checkedPath(root, JOURNAL));
  return { status: journal.phase === 'committed' ? 'finalized' : 'rolled-back', paths: journal.operations.map(op => op.path) };
}
async function transact(root: string, operations: Operation[]): Promise<void> {
  for (const op of operations) if (!(await sameSnapshot(root, op.path, op.before, op.before === null ? undefined : op.beforeMode))) throw new Error('File changed after planning: ' + op.path);
  const journal: Journal = { schemaVersion: '1', id: randomUUID(), phase: 'prepared', operations };
  const serialized = json(journal);
  if (Buffer.byteLength(serialized) > MAX_STATE) throw new Error('Generation transaction exceeds the bounded journal size');
  await atomicWrite(root, JOURNAL, Buffer.from(serialized));
  try {
    for (const op of operations) {
      if (!(await sameSnapshot(root, op.path, op.before, op.before === null ? undefined : op.beforeMode))) throw new Error('File changed while applying generation: ' + op.path);
      await replace(root, op);
    }
    journal.phase = 'committed';
    await atomicWrite(root, JOURNAL, Buffer.from(json(journal)));
    await unlink(await checkedPath(root, JOURNAL));
  } catch (error) {
    try { await recoverJournal(root); }
    catch { throw new Error('Generation interrupted; recovery is required before further changes. Cause: ' + (error as Error).message); }
    throw error;
  }
}
export async function regenerate(directory: string, artifacts: Artifact[], metadata: GeneratorMetadata, options: RegenerationOptions = {}, overwrite = true): Promise<{ plan: RegenerationPlan; applied: boolean; files: string[] }> {
  const initial = await computePlan(directory, artifacts, metadata, options, overwrite);
  if (options.dryRun) return { plan: initial.plan, applied: false, files: [] };
  if (initial.plan.conflicts.length) throw new RegenerationConflictError(initial.plan);
  if (options.expectedPlanHash && options.expectedPlanHash !== initial.plan.planHash) throw new Error('The reviewed regeneration plan is stale; inspect a new plan');
  const root = resolve(directory), lock = await acquire(root);
  try {
    const fresh = await computePlan(root, artifacts, metadata, options, overwrite);
    if (fresh.plan.planHash !== initial.plan.planHash) throw new Error('Project files changed while acquiring the generation lock; inspect a new plan');
    if (fresh.plan.conflicts.length) throw new RegenerationConflictError(fresh.plan);
    const metadataOps = await metadataOperations(root, fresh.baseline, fresh.appliedFiles, fresh.previous.legacy);
    if (fresh.previous.legacy && fresh.previous.baseline && fresh.previous.id) {
      const previousBaseline = await immutableOperation(root, `${STATE}/baselines/${fresh.previous.id}.json`, json(fresh.previous.baseline));
      if (previousBaseline) metadataOps.unshift(previousBaseline);
    }
    const lockOp = fresh.operations.find(op => op.path === 'build-lock.json');
    await transact(root, [...fresh.operations.filter(op => op !== lockOp), ...metadataOps, ...(lockOp ? [lockOp] : [])]);
    return { plan: fresh.plan, applied: true, files: artifacts.filter(a => fresh.appliedFiles[a.path] !== null).map(a => join(root, a.path)) };
  } finally { await lock.release(); }
}

export async function assertGenerationReady(directory: string): Promise<void> {
  if (await snapshot(directory, JOURNAL, MAX_STATE)) throw new Error('Generation update is incomplete; run generation recovery before executing or exporting');
  if (await snapshot(directory, LOCK)) throw new Error('Generation is currently locked; wait for completion or recover a dead writer');
}
/** Serialize cooperating external mutations such as dependency operations with generation.
 * The callback owns its own rollback semantics; this lock does not journal package-manager writes.
 */
export async function withGenerationLock<T>(directory: string, operation: (directory: string) => Promise<T>): Promise<T> {
  const root = resolve(directory);
  await assertGenerationReady(root);
  const held = await acquire(root);
  try {
    if (await snapshot(root, JOURNAL, MAX_STATE)) throw new Error('Generation update is incomplete; recover it before changing dependencies');
    return await operation(root);
  } finally { await held.release(); }
}
export async function inspectGeneration(directory: string) {
  const root = resolve(directory), journal = await readJson(root, JOURNAL), lock = await readJson(root, LOCK);
  const stored = await state(root);
  const drift: { path: string; baselineHash: string; currentHash: string | null; appliedHash: string | null | undefined }[] = [];
  for (const [path, file] of Object.entries(stored.baseline?.files ?? {})) {
    const currentHash = (await snapshot(root, path))?.sha256 ?? null;
    if (currentHash !== file.sha256) drift.push({ path, baselineHash: file.sha256, currentHash, appliedHash: stored.current?.appliedFiles[path] });
  }
  return { directory: root, schemaVersion: stored.current ? '2' : stored.legacy ? '1' : null, generationId: stored.id ?? null,
    generator: stored.baseline?.generator ?? null, trackedFiles: Object.keys(stored.baseline?.files ?? {}), migrationNeeded: !!stored.legacy,
    drift,
    pending: journal ? { phase: validateJournal(journal).phase, paths: journal.operations.map((op: Operation) => op.path) } : null,
    lock: lock ? { pid: lock.pid, host: lock.host, createdAt: lock.createdAt } : null, dependencies: await dependencyLockStatus(root) };
}
export async function recoverGeneration(directory: string): Promise<{ status: string; paths: string[] }> {
  const root = resolve(directory), held = await readJson(root, LOCK) as Lock | null;
  if (held) {
    if (held.schemaVersion !== '1' || held.host !== hostname() || !Number.isInteger(held.pid) || held.pid <= 0 || typeof held.token !== 'string') throw new Error('Cannot prove the generation lock is abandoned; inspect its owner manually');
    let alive = true;
    try { process.kill(held.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
    if (alive) throw new Error('The generation writer is still alive; recovery refused');
    if ((await readJson(root, LOCK))?.token !== held.token) throw new Error('Lock changed during recovery');
    await unlink(await checkedPath(root, LOCK));
  }
  const lock = await acquire(root);
  try { return await recoverJournal(root); } finally { await lock.release(); }
}
export async function migrateGeneration(directory: string, options: { dryRun?: boolean } = {}) {
  const root = resolve(directory), initial = await state(root);
  const preview = { directory: root, from: initial.current ? '2' : initial.legacy ? '1' : null, to: '2', needed: !!initial.legacy,
    unavailableBaselines: Object.entries(initial.baseline?.files ?? {}).filter(([, file]) => file.content === undefined).map(([path]) => path),
    backup: initial.legacy ? `${STATE}/backups/build-lock-v1-${initial.legacy.sha256}.json` : null, applied: false };
  if (options.dryRun || !initial.legacy) return preview;
  if (await snapshot(root, JOURNAL, MAX_STATE)) throw new Error('Recover the interrupted transaction before migrating');
  const lock = await acquire(root);
  try {
    const fresh = await state(root);
    if (fresh.legacy?.sha256 !== initial.legacy.sha256 || fresh.id !== initial.id) throw new Error('Legacy generation changed during migration');
    const appliedFiles: Record<string, string | null> = {};
    for (const path of Object.keys(fresh.baseline!.files)) appliedFiles[path] = (await snapshot(root, path))?.sha256 ?? null;
    await transact(root, await metadataOperations(root, fresh.baseline!, appliedFiles, fresh.legacy));
    return { ...preview, applied: true };
  } finally { await lock.release(); }
}

export async function dependencyLockStatus(directory: string) {
  const pkg = await snapshot(directory, 'package.json'), pyproject = await snapshot(directory, 'pyproject.toml');
  const language = pkg ? 'typescript' : pyproject ? 'python' : null;
  const name = language === 'typescript' ? 'package-lock.json' : language === 'python' ? 'uv.lock' : null;
  const lock = name ? await snapshot(directory, name) : null;
  let consistency: 'missing' | 'matches' | 'stale' | 'unverified' = lock ? 'unverified' : 'missing';
  if (pkg && lock) {
    const manifest = JSON.parse(pkg.bytes.toString('utf8')), parsed = JSON.parse(lock.bytes.toString('utf8')), locked = parsed.packages?.[''];
    if (locked) consistency = ['dependencies', 'devDependencies', 'optionalDependencies'].every(field => {
      const sorted = (value: unknown) => JSON.stringify(Object.entries((value ?? {}) as object).sort(([a], [b]) => a.localeCompare(b)));
      return sorted(manifest[field]) === sorted(locked[field]);
    }) ? 'matches' : 'stale';
  }
  return { language, lockfile: name, present: !!lock, consistency, manifestHash: (pkg ?? pyproject)?.sha256 ?? null, lockHash: lock?.sha256 ?? null,
    commands: language === 'typescript' ? { lock: ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], install: ['npm', 'ci', '--ignore-scripts'] }
      : language === 'python' ? { lock: ['uv', 'lock'], check: ['uv', 'lock', '--check'], install: ['uv', 'sync', '--locked'] } : null,
    note: 'Generation fingerprints cover source and templates, not resolved dependencies. Lock creation and frozen installation are separate explicit operations; platform/toolchain reproducibility still requires validation.' };
}
