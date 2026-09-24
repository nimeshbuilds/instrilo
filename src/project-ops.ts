import { constants } from 'node:fs';
import { mkdir, open, writeFile, rename, link, rm, lstat, readdir, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { zipSync } from 'fflate';
import { safeChild, manifestName } from './workbench.js';
import { validateSpec, inspectGuidance, readCases } from './core.js';
import { withGenerationLock } from './regeneration.js';
import type { ProjectSpec, EvalCase } from './types.js';

export const hashText = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
export function projectRoot(value = '.') { const p = resolve(value); return /\.(yaml|yml|json)$/.test(p) ? dirname(p) : p; }
function parseSpec(content: string): ProjectSpec {
  const raw = YAML.parse(content, { maxAliasCount: 20 }); assertPlainData(raw);
  const check = validateSpec(raw);
  if (!check.spec) throw new Error('Invalid project specification: ' + check.issues.filter(i => i.level === 'error').map(i => i.message).join('; '));
  return check.spec;
}
export async function projectSpec(value = '.') { const root = projectRoot(value); return { root, spec: parseSpec(await readTextDocument(safeChild(root, manifestName))) }; }
async function readBytes(path: string, max: number): Promise<Buffer> {
  if (!Number.isSafeInteger(max) || max < 1 || max > 20_000_000) throw new Error('Invalid bounded file size.');
  const absolute = safeChild(dirname(resolve(path)), basename(path));
  // lstat rejects FIFOs/devices before open; O_NOFOLLOW also protects the leaf from substitution.
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw new Error('Input must be a bounded regular file, not a symbolic link.');
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > max || before.dev !== info.dev || before.ino !== info.ino) throw new Error('Input changed or is not a bounded regular file.');
    const buffer = Buffer.alloc(Math.min(max + 1, before.size + 1)); let length = 0;
    while (length < buffer.length) { const next = await handle.read(buffer, length, buffer.length - length, length); if (!next.bytesRead) break; length += next.bytesRead; }
    const after = await handle.stat();
    if (length !== before.size || length > max || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Input changed while reading or exceeds its size limit.');
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
export async function readTextDocument(path: string, max = 2_000_000): Promise<string> { return new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(path, max)); }
function assertPlainData(value: unknown, ancestors = new Set<unknown>(), depth = 0, count = { value: 0 }): void {
  if (++count.value > 100_000 || depth > 100) throw new Error('Document structure exceeds inspection limits.');
  if (value === null || typeof value !== 'object') return;
  if (ancestors.has(value)) throw new Error('Cyclic documents are not supported.');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Prototype objects are not allowed in project data.');
  ancestors.add(value);
  for (const [key, item] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Prototype keys are not allowed in project data.'); assertPlainData(item, ancestors, depth + 1, count); }
  ancestors.delete(value);
}
export async function readDocument(path: string, max = 2_000_000): Promise<any> {
  const text = await readTextDocument(path, max); const parsed = extname(path).toLowerCase() === '.jsonl' ? text.split('\n').filter(x => x.trim()).map(x => JSON.parse(x)) : YAML.parse(text, { maxAliasCount: 20 });
  assertPlainData(parsed); return parsed;
}
export async function atomicProjectWrite(root: string, path: string, content: string, expectedHash?: string | null) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 5_000_000) throw new Error('Project document exceeds the 5 MB limit.');
  if (expectedHash !== undefined && expectedHash !== null && !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Expected SHA-256 must be a 64-character lowercase hexadecimal digest.');
  const dest = safeChild(root, path); await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  const lock = safeChild(root, '.instrilo/edit.lock'); await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  let acquired = false;
  const temporary = safeChild(root, path + '.' + randomUUID() + '.tmp');
  try {
    try { await writeFile(lock, JSON.stringify({ pid: process.pid, operation: path }) + '\n', { flag: 'wx', mode: 0o600 }); acquired = true; }
    catch (e: any) { if (e.code === 'EEXIST') throw new Error('Another project edit holds .instrilo/edit.lock. Finish that operation before retrying.'); throw e; }
    let original: string | undefined; try { original = await readTextDocument(safeChild(root, path), 5_000_000); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    if (expectedHash == null && original !== undefined) throw new Error('File appeared after inspection; refresh before creating it or provide its current SHA-256 to replace it.');
    if (expectedHash && (original === undefined || hashText(original) !== expectedHash)) throw new Error('The file changed; inspect it again and pass its current SHA-256.');
    if (original !== undefined) { const backup = safeChild(root, '.instrilo/backups/' + randomUUID() + '-' + path.replaceAll('/', '_')); await mkdir(dirname(backup), { recursive: true, mode: 0o700 }); await writeFile(backup, original, { flag: 'wx', mode: 0o600 }); }
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    safeChild(root, path);
    if (original === undefined) {
      // Linking an already-complete temporary file is an atomic create-if-absent.
      // rename would silently replace a file created after our initial inspection.
      try { await link(temporary, dest); } catch (error: any) { if (error.code === 'EEXIST') throw new Error('File appeared after inspection; refresh before creating it.'); throw error; }
    } else {
      const current = await readTextDocument(safeChild(root, path), 5_000_000);
      if (hashText(current) !== hashText(original)) throw new Error('The file changed immediately before replacement; inspect it again.');
      await rename(temporary, dest);
    }
    return { path, sha256: hashText(content) };
  } finally { await rm(temporary, { force: true }); if (acquired) await rm(lock, { force: true }); }
}
export async function mutateConfig(project: string, mutate: (spec: ProjectSpec) => void, expectedHash?: string) {
  const root = projectRoot(project), original = await readTextDocument(safeChild(root, manifestName)); const spec = parseSpec(original); mutate(spec); assertPlainData(spec);
  const check = validateSpec(spec); if (!check.spec || check.issues.some(x => x.level === 'error')) throw new Error(check.issues.filter(x => x.level === 'error').map(x => `${x.path || 'config'}: ${x.message}`).join('\n'));
  safeChild(root, check.spec.guidanceDir); safeChild(root, check.spec.evaluation.dataset);
  return { ...await atomicProjectWrite(root, manifestName, YAML.stringify(check.spec), expectedHash ?? hashText(original)), spec: check.spec, issues: check.issues, next: 'Configuration saved. Run instrilo build PROJECT --overwrite before execution.' };
}
function pathParts(path: string) { const parts = path.split('.'); if (!parts.length || parts.some(p => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(p) || ['__proto__', 'prototype', 'constructor'].includes(p))) throw new Error('Use a dotted configuration field path; prototype fields and array indexing are forbidden.'); return parts; }
export function getField(object: any, path?: string) { let value = object; for (const p of path ? pathParts(path) : []) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, p)) throw new Error(`Unknown configuration path: ${path}`); value = value[p]; } return value; }
export function setField(object: any, path: string, value: unknown) { const parts = pathParts(path), key = parts.pop()!; assertPlainData(value); let parent = object; for (const p of parts) { if (!Object.hasOwn(parent, p) || !parent[p] || typeof parent[p] !== 'object' || Array.isArray(parent[p])) throw new Error(`Unknown object path: ${path}`); parent = parent[p]; } parent[key] = value; }
export async function saveCases(project: string, values: EvalCase[], options: { append?: boolean; expectedHash?: string } = {}) {
  const { root, spec } = await projectSpec(project); const path = safeChild(root, spec.evaluation.dataset); const current = await readTextDocument(path, 5_000_000);
  const combined = options.append ? [...await readCases(path), ...values] : values;
  assertPlainData(combined);
  const serialized = combined.map(x => JSON.stringify(x)).join('\n') + '\n';
  if (Buffer.byteLength(serialized) > 5_000_000) throw new Error('Evaluation dataset exceeds the 5 MB limit.');
  const temp = await mkdtemp(join(tmpdir(), 'instrilo-cases-'));
  try { const file = join(temp, 'cases.jsonl'); await writeFile(file, serialized); const cases = await readCases(file); const output = extname(path).toLowerCase() === '.json' ? JSON.stringify(cases, null, 2) + '\n' : cases.map(x => JSON.stringify(x)).join('\n') + '\n'; return { ...await atomicProjectWrite(root, spec.evaluation.dataset, output, options.expectedHash ?? hashText(current)), count: cases.length }; }
  finally { await rm(temp, { recursive: true, force: true }); }
}
export async function writeGuidanceFile(project: string, path: string, content: string, options: { expectedHash?: string; replace?: boolean } = {}) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 64_000) throw new Error('Guidance files are limited to 64 KB.');
  const { root, spec } = await projectSpec(project); const guidanceRoot = safeChild(root, spec.guidanceDir); const dest = safeChild(guidanceRoot, path);
  const before = await inspectGuidance(guidanceRoot); if (before.issues.some(x => x.level === 'error')) throw new Error('Resolve existing guidance errors before editing.');
  const existing = before.files.find(x => x.path === path); if (existing && !options.replace) throw new Error('File exists. Inspect its hash, then use --replace --expected-sha HASH.');
  if (existing && options.expectedHash !== existing.sha256) throw new Error('Replacing guidance requires its current --expected-sha hash.');
  if (!existing) { try { await lstat(dest); throw new Error('An excluded or unmanaged file already occupies that path.'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
  const temporary = await mkdtemp(join(tmpdir(), 'instrilo-guidance-'));
  try {
    for (const file of [...before.files.filter(x => x.path !== path), { path, content }]) { const destination = safeChild(temporary, file.path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, file.content); }
    const checked = await inspectGuidance(temporary);
    if (checked.issues.some(x => x.level === 'error' || x.code === 'GUIDANCE_CONFLICT') || !checked.files.some(x => x.path === path) || checked.files.length !== before.files.length + (existing ? 0 : 1)) throw new Error('Guidance failed file, secret, size, or conflict checks. No source files changed.');
    return await atomicProjectWrite(root, join(spec.guidanceDir, path), content, existing ? options.expectedHash : null);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
export async function artifactFiles(project: string): Promise<string[]> {
  const root = safeChild(projectRoot(project), 'generated'), files: string[] = []; let total = 0, visited = 0;
  const excluded = new Set(['node_modules', '.venv', '.git', '.instrilo', '__pycache__', 'dist', '.deployment', 'artifacts', '.aws', '.ssh', 'secrets', 'credentials']);
  const secretName = /(^|[._-])(secrets?|credentials?|passwords?|private[._-]?keys?|id_rsa|id_ed25519)([._-]|$)|\.(pem|key|p12|pfx)$/i;
  async function walk(prefix = '', depth = 0) { if (depth > 32) throw new Error('Artifact directory nesting exceeds 32 levels.'); for (const entry of await readdir(safeChild(root, prefix || '.'), { withFileTypes: true })) {
    if (++visited > 10_000) throw new Error('Artifact inspection exceeds 10,000 directory entries.');
    if (entry.isSymbolicLink() || excluded.has(entry.name) || secretName.test(entry.name) || entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) await walk(name, depth + 1); else if (entry.isFile()) { const stat = await lstat(safeChild(root, name)); if (!stat.isFile()) throw new Error('Artifact changed during inspection.'); total += stat.size; if (total > 20_000_000 || files.length >= 2000) throw new Error('Export exceeds 20 MB or 2000 files.'); files.push(name); }
  } }
  await walk(); return files.sort();
}
async function exportSources(project: string) {
  const { root, spec } = await projectSpec(project), cases = await readCases(safeChild(root, spec.evaluation.dataset));
  const guidance = await inspectGuidance(safeChild(root, spec.guidanceDir));
  if (guidance.issues.some(i => i.level === 'error' || ['GUIDANCE_TOTAL_LIMIT', 'GUIDANCE_DEPTH_LIMIT', 'GUIDANCE_SCAN_INCOMPLETE'].includes(i.code))) throw new Error('Export requires a complete readable guidance inventory.');
  const inventory = guidance.files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { root, spec, cases, guidance, inventory, fingerprint: hashText(JSON.stringify({ spec, cases, inventory })) };
}
export async function createProjectArchive(project: string): Promise<{ bytes: Uint8Array; files: number; name: string }> {
  const initial = await exportSources(project), generated = safeChild(initial.root, 'generated');
  // Fail before acquiring a generation lock creates its state directory in an unbuilt project.
  for (const required of [manifestName, 'build-lock.json', initial.spec.language === 'python' ? 'agent.py' : 'agent.ts']) await readBytes(safeChild(generated, required), 2_000_000);
  return withGenerationLock(generated, async () => {
    const before = await exportSources(project), { root, spec } = before;
    const lock = await readDocument(safeChild(generated, 'build-lock.json'));
    if (lock.manifestHash !== hashText(JSON.stringify(spec))) throw new Error('Configuration changed after this build. Rebuild before exporting.');
    const builtInventory = Array.isArray(lock.guidance) ? [...lock.guidance].sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : null;
    if (JSON.stringify(builtInventory) !== JSON.stringify(before.inventory)) throw new Error('Guidance changed after this build. Rebuild before exporting.');
    if (lock.runtimeSnapshotHash !== hashText(await readBytes(safeChild(generated, 'agent-spec.json'), 2_000_000))) throw new Error('Generated runtime configuration changed; rebuild its source before exporting.');
    if (!lock.generatedFiles?.['guidance.md'] || lock.generatedFiles['guidance.md'] !== hashText(await readBytes(safeChild(generated, 'guidance.md'), 2_000_000))) throw new Error('Generated guidance changed; rebuild its source before exporting.');
    const generatedCases = await readCases(safeChild(generated, 'evals/cases.jsonl'));
    if (JSON.stringify(generatedCases) !== JSON.stringify(before.cases)) throw new Error('Dataset changed after this build. Rebuild before exporting.');
    const portable = parseSpec(await readTextDocument(safeChild(generated, manifestName)));
    const expectedPortable = parseSpec(YAML.stringify({ ...spec, guidanceDir: './guidance', evaluation: { ...spec.evaluation, dataset: './evals/cases.jsonl' } }));
    if (JSON.stringify(portable) !== JSON.stringify(expectedPortable)) throw new Error('Generated portable manifest differs from current source. Rebuild before exporting.');
    const portableGuidance = await inspectGuidance(safeChild(generated, 'guidance'));
    const portableInventory = portableGuidance.files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (portableGuidance.issues.some(i => i.level === 'error' || ['GUIDANCE_TOTAL_LIMIT', 'GUIDANCE_DEPTH_LIMIT', 'GUIDANCE_SCAN_INCOMPLETE'].includes(i.code)) || JSON.stringify(portableInventory) !== JSON.stringify(before.inventory)) throw new Error('Generated portable guidance differs from current source. Rebuild before exporting.');
    const files = await artifactFiles(root), entries: Record<string, Uint8Array> = Object.create(null); let total = 0;
    for (const file of files) { const bytes = await readBytes(safeChild(generated, file), 20_000_000); total += bytes.length; if (total > 20_000_000) throw new Error('Export exceeds 20 MB.'); entries[spec.name + '/' + file] = bytes; }
    if (JSON.stringify(files) !== JSON.stringify(await artifactFiles(root))) throw new Error('Generated files changed during export; retry.');
    for (const file of files) if (hashText(await readBytes(safeChild(generated, file), 20_000_000)) !== hashText(entries[spec.name + '/' + file])) throw new Error('A generated file changed during export; retry.');
    if ((await exportSources(project)).fingerprint !== before.fingerprint) throw new Error('Source configuration, guidance or cases changed during export; rebuild and retry.');
    return { bytes: zipSync(entries), files: files.length, name: spec.name };
  });
}
export async function exportProject(project: string, destination: string) {
  const archive = await createProjectArchive(project), output = safeChild(dirname(resolve(destination)), basename(destination));
  await writeFile(output, archive.bytes, { flag: 'wx', mode: 0o600 });
  return { path: output, files: archive.files, note: 'Source export excludes local evidence/run history and known credential paths. Inspect custom files before sharing. Rebuild the portable manifest after moving it.' };
}
