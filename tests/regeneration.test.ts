import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertGenerationReady, dependencyLockStatus, inspectGeneration, mergeText, migrateGeneration, planRegeneration, recoverGeneration, regenerate, RegenerationConflictError, withGenerationLock, type GeneratorMetadata } from '../src/regeneration.js';
import type { Artifact } from '../src/types.js';

const sha = (content: string) => createHash('sha256').update(content).digest('hex');
const metadata: GeneratorMetadata = { version: 'test-1', fingerprint: sha('generator-test-1'), sourceHashes: { test: sha('test-source') }, templateHashes: { 'agent.tpl': sha('test-template') } };
const files = (content = 'one\ntwo\nthree\nfour\n'): Artifact[] => [{ path: 'agent.ts', content }];
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-regeneration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('generation retains immutable original content, preserves custom code and unrelated user files', async t => {
  const root = await fixture(t);
  const first = await regenerate(root, files(), metadata);
  const original = await readFile(join(root, '.instrilo/baselines', first.plan.generationId + '.json'), 'utf8');
  await writeFile(join(root, 'agent.ts'), 'one\nuser-custom-code\nthree\nfour\n');
  await writeFile(join(root, 'my-notes.md'), 'User-owned notes');
  const plan = await planRegeneration(root, files(), metadata);
  assert.equal(plan.changes.find(c => c.path === 'agent.ts')?.action, 'preserve');
  assert.equal(plan.changes.find(c => c.path === 'my-notes.md')?.action, 'preserve');
  const applied = await regenerate(root, files(), metadata, { expectedPlanHash: plan.planHash });
  assert.equal(applied.plan.generationId, first.plan.generationId);
  assert.match(await readFile(join(root, 'agent.ts'), 'utf8'), /user-custom-code/);
  assert.equal(await readFile(join(root, 'my-notes.md'), 'utf8'), 'User-owned notes');
  assert.equal(await readFile(join(root, '.instrilo/baselines', first.plan.generationId + '.json'), 'utf8'), original);
  assert.equal((await inspectGeneration(root)).schemaVersion, '2');
});

test('a dry run creates no destination and unchanged generation preserves content', async t => {
  const root = join(await fixture(t), 'not-created');
  const preview = await regenerate(root, files(), metadata, { dryRun: true });
  assert.equal(preview.applied, false); assert.equal(preview.plan.changes[0].action, 'add');
  await assert.rejects(access(root), { code: 'ENOENT' });
  await regenerate(root, files(), metadata);
  const plan = await planRegeneration(root, files(), metadata);
  assert.equal(plan.changes.find(c => c.path === 'agent.ts')?.action, 'unchanged');
  await regenerate(root, files(), metadata);
  assert.equal(await readFile(join(root, 'agent.ts'), 'utf8'), files()[0].content);
});

test('overlapping regeneration conflicts refuse all writes, including otherwise safe additions', async t => {
  const root = await fixture(t);
  await regenerate(root, files(), metadata);
  await writeFile(join(root, 'agent.ts'), 'one\nUSER\nthree\nfour\n');
  const before = await readFile(join(root, '.instrilo/current.json'));
  const incoming = [...files('one\nGENERATOR\nthree\nfour\n'), { path: 'new.ts', content: 'must not exist' }];
  const plan = await planRegeneration(root, incoming, metadata, { merge: true });
  assert.deepEqual(plan.conflicts, ['agent.ts']);
  await assert.rejects(regenerate(root, incoming, metadata, { merge: true }), RegenerationConflictError);
  assert.equal(await readFile(join(root, 'agent.ts'), 'utf8'), 'one\nUSER\nthree\nfour\n');
  assert.deepEqual(await readFile(join(root, '.instrilo/current.json')), before);
  await assert.rejects(access(join(root, 'new.ts')), { code: 'ENOENT' });
  await assert.rejects(access(join(root, '.instrilo/write.lock')), { code: 'ENOENT' });
});

test('explicit three-way merge combines separate line edits and retains both baselines', async t => {
  const root = await fixture(t);
  const first = await regenerate(root, files(), metadata);
  await writeFile(join(root, 'agent.ts'), 'one\nUSER\nthree\nfour\n');
  const incoming = files('one\ntwo\nthree\nGENERATOR\n');
  assert.deepEqual((await planRegeneration(root, incoming, metadata)).conflicts, ['agent.ts']);
  const result = await regenerate(root, incoming, metadata, { merge: true });
  assert.equal(result.plan.changes[0].action, 'merge');
  assert.equal(await readFile(join(root, 'agent.ts'), 'utf8'), 'one\nUSER\nthree\nGENERATOR\n');
  const baseline = JSON.parse(await readFile(join(root, '.instrilo/baselines', result.plan.generationId + '.json'), 'utf8'));
  assert.equal(baseline.files['agent.ts'].content, incoming[0].content);
  await access(join(root, '.instrilo/baselines', first.plan.generationId + '.json'));
  assert.equal((await planRegeneration(root, incoming, metadata)).changes[0].action, 'preserve');
});

test('line merge handles insertions, deletions, CRLF and ambiguous overlaps conservatively', () => {
  assert.equal(mergeText('a\nb\nc\nd\n', 'a\nuser\nb\nc\nd\n', 'a\nb\nc\nnew\n').content, 'a\nuser\nb\nc\nnew\n');
  assert.equal(mergeText('a\nb\nc\nd\n', 'a\nc\nd\n', 'a\nb\nc\nnew\n').content, 'a\nc\nnew\n');
  assert.equal(mergeText('a\r\nb\r\nc\r\n', 'A\r\nb\r\nc\r\n', 'a\r\nb\r\nC\r\n').content, 'A\r\nb\r\nC\r\n');
  assert.ok(mergeText('a\nb\n', 'a\nX\nb\n', 'a\nY\nb\n').conflict);
  assert.ok(mergeText('a\nb\nc\n', 'a\nX\nb\nc\n', 'a\nB\nc\n').conflict);
});

test('generator permission changes apply, while independent user permissions survive content updates', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  await regenerate(root, files(), metadata);
  await regenerate(root, [{ ...files()[0], executable: true }], metadata);
  assert.equal((await stat(join(root, 'agent.ts'))).mode & 0o777, 0o755);
  await chmod(join(root, 'agent.ts'), 0o700);
  await regenerate(root, [{ ...files('new content\n')[0], executable: true }], metadata);
  assert.equal((await stat(join(root, 'agent.ts'))).mode & 0o777, 0o700);
  const next = [{ ...files('next content\n')[0], executable: true }];
  const reviewed = await planRegeneration(root, next, metadata);
  await chmod(join(root, 'agent.ts'), 0o750);
  await assert.rejects(regenerate(root, next, metadata, { expectedPlanHash: reviewed.planHash }), /stale/);
  const obsolete = await regenerate(root, [], metadata);
  assert.equal(obsolete.plan.changes.find(c => c.path === 'agent.ts')?.action, 'preserve');
  assert.equal((await stat(join(root, 'agent.ts'))).mode & 0o777, 0o750);
});

test('new collisions and source mirrors cannot silently adopt or overwrite user content', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'agent.ts'), files()[0].content);
  await assert.rejects(regenerate(root, files(), metadata), /conflicts/);
  assert.deepEqual(await readdir(root), ['agent.ts']);
  await rm(join(root, 'agent.ts'));
  await regenerate(root, [{ path: 'agent-spec.json', content: '{"source":1}\n' }], metadata);
  await writeFile(join(root, 'agent-spec.json'), '{"source":2}\n');
  const next = [{ path: 'agent-spec.json', content: '{"source":1}\n' }];
  await assert.rejects(regenerate(root, next, metadata, { merge: true, protectedPaths: ['agent-spec.json'] }), /conflicts/);
});

test('external dependency mutations share the generation lock and release it after failure', async t => {
  const root = await fixture(t);
  await regenerate(root, files(), metadata);
  let started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const exit = new Promise<void>(resolve => { finish = resolve; });
  const mutation = withGenerationLock(root, async directory => { assert.equal(directory, root); started(); await exit; return 'done'; });
  await entered;
  try {
    await assert.rejects(regenerate(root, files('changed\n'), metadata), /locked/);
    await assert.rejects(withGenerationLock(root, async () => undefined), /locked/);
  } finally { finish(); }
  assert.equal(await mutation, 'done');
  await assertGenerationReady(root);
  await assert.rejects(withGenerationLock(root, async () => { throw new Error('package manager failed'); }), /package manager failed/);
  await assertGenerationReady(root);
  await writeFile(join(root, '.instrilo/transaction.json'), JSON.stringify({ schemaVersion: '1', id: 'pending', phase: 'prepared', operations: [] }));
  let invoked = false;
  await assert.rejects(withGenerationLock(root, async () => { invoked = true; }), /incomplete/);
  assert.equal(invoked, false);
  await assert.rejects(access(join(root, '.instrilo/write.lock')), { code: 'ENOENT' });
});

test('obsolete untouched artifacts are deleted; changed obsolete artifacts and user deletions survive', async t => {
  const root = await fixture(t);
  await regenerate(root, [...files(), { path: 'old.ts', content: 'old' }, { path: 'edited.ts', content: 'generated' }], metadata);
  await writeFile(join(root, 'edited.ts'), 'my customization');
  await rm(join(root, 'agent.ts'));
  const result = await regenerate(root, files(), metadata);
  assert.equal(result.plan.changes.find(c => c.path === 'old.ts')?.action, 'delete');
  assert.equal(result.plan.changes.find(c => c.path === 'edited.ts')?.action, 'preserve');
  await assert.rejects(access(join(root, 'old.ts')), { code: 'ENOENT' });
  await assert.rejects(access(join(root, 'agent.ts')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'edited.ts'), 'utf8'), 'my customization');
  assert.deepEqual((await planRegeneration(root, files('generator changed\n'), metadata)).conflicts, ['agent.ts']);
});

test('reviewed plans detect newer edits and exclusive locks reject concurrent writers', async t => {
  const root = await fixture(t);
  await regenerate(root, files(), metadata);
  const incoming = files('new\ntwo\nthree\nfour\n');
  const plan = await planRegeneration(root, incoming, metadata);
  await writeFile(join(root, 'notes.txt'), 'another user change');
  await assert.rejects(regenerate(root, incoming, metadata, { expectedPlanHash: plan.planHash }), /stale/);
  await writeFile(join(root, '.instrilo/write.lock'), JSON.stringify({ schemaVersion: '1', pid: process.pid, host: hostname(), token: 'active', createdAt: new Date().toISOString() }));
  await assert.rejects(regenerate(root, incoming, metadata), /locked/);
  await assert.rejects(recoverGeneration(root), /still alive/);
  await assert.rejects(assertGenerationReady(root), /locked/);
  assert.equal(await readFile(join(root, 'agent.ts'), 'utf8'), files()[0].content);
});

test('managed symlink paths and modified immutable baselines are rejected', async t => {
  const parent = await fixture(t), root = join(parent, 'project'), outside = join(parent, 'outside');
  await mkdir(root); await mkdir(outside); await writeFile(join(outside, 'secret'), 'unchanged');
  await symlink(outside, join(root, 'linked'));
  await assert.rejects(regenerate(root, [{ path: 'linked/secret', content: 'wrong' }], metadata), /Symbolic/);
  assert.equal(await readFile(join(outside, 'secret'), 'utf8'), 'unchanged');
  const result = await regenerate(root, files(), metadata);
  await writeFile(join(root, '.instrilo/baselines', result.plan.generationId + '.json'), '{}');
  await assert.rejects(inspectGeneration(root), /fingerprint/);
});

test('v1 migration previews without writes and preserves a backup without inventing edited base content', async t => {
  const root = await fixture(t);
  const legacy = JSON.stringify({ schemaVersion: '1', generator: '0.1.0', generatedFiles: { 'agent.ts': sha('original\n') } });
  await writeFile(join(root, 'agent.ts'), 'user edit\n');
  await writeFile(join(root, 'build-lock.json'), legacy);
  const preview = await migrateGeneration(root, { dryRun: true });
  assert.equal(preview.needed, true); assert.deepEqual(preview.unavailableBaselines, ['agent.ts']);
  await assert.rejects(access(join(root, '.instrilo')), { code: 'ENOENT' });
  const migrated = await migrateGeneration(root);
  assert.equal(migrated.applied, true);
  assert.equal(await readFile(join(root, migrated.backup!), 'utf8'), legacy);
  assert.equal(await readFile(join(root, 'build-lock.json'), 'utf8'), legacy);
  assert.equal((await inspectGeneration(root)).schemaVersion, '2');
  assert.ok((await planRegeneration(root, files('different incoming\n'), metadata, { merge: true })).conflicts.includes('agent.ts'));
  assert.equal((await migrateGeneration(root)).needed, false);
});

async function interrupted(root: string, phase: 'prepared' | 'committed' = 'prepared') {
  await mkdir(join(root, '.instrilo'), { recursive: true });
  const operation = (path: string, before: string | null, after: string | null) => ({ path, before: before === null ? null : Buffer.from(before).toString('base64'), after: after === null ? null : Buffer.from(after).toString('base64'), beforeMode: 0o644, afterMode: 0o644 });
  await writeFile(join(root, 'first.ts'), 'new first', { mode: 0o644 });
  await writeFile(join(root, 'second.ts'), phase === 'committed' ? 'new second' : 'old second', { mode: 0o644 });
  await writeFile(join(root, 'added.ts'), 'new addition', { mode: 0o644 });
  await writeFile(join(root, '.instrilo/transaction.json'), JSON.stringify({ schemaVersion: '1', id: 'fixture-interruption', phase, operations: [operation('first.ts', 'old first', 'new first'), operation('second.ts', 'old second', 'new second'), operation('added.ts', null, 'new addition')] }));
}

test('interrupted generation recovers applied, unapplied and newly added files as one rollback', async t => {
  const root = await fixture(t); await interrupted(root);
  await writeFile(join(root, '.instrilo/write.lock'), JSON.stringify({ schemaVersion: '1', pid: 2147483647, host: hostname(), token: 'dead-writer', createdAt: new Date().toISOString() }));
  await assert.rejects(assertGenerationReady(root), /incomplete/);
  await assert.rejects(planRegeneration(root, files(), metadata), /recovery/);
  const result = await recoverGeneration(root);
  assert.equal(result.status, 'rolled-back');
  assert.equal(await readFile(join(root, 'first.ts'), 'utf8'), 'old first');
  assert.equal(await readFile(join(root, 'second.ts'), 'utf8'), 'old second');
  await assert.rejects(access(join(root, 'added.ts')), { code: 'ENOENT' });
  await assertGenerationReady(root);
  assert.equal((await recoverGeneration(root)).status, 'nothing-to-recover');
});

test('legacy regeneration retains the prior baseline before applying its first upgrade', async t => {
  const root = await fixture(t);
  const content = 'original legacy source\n';
  await writeFile(join(root, 'agent.ts'), content);
  await writeFile(join(root, 'build-lock.json'), JSON.stringify({ schemaVersion: '1', generator: '0.1.0', generatedFiles: { 'agent.ts': sha(content) } }));
  const oldId = (await inspectGeneration(root)).generationId!;
  await regenerate(root, files('upgraded source\n'), metadata);
  const retained = JSON.parse(await readFile(join(root, '.instrilo/baselines', oldId + '.json'), 'utf8'));
  assert.equal(retained.files['agent.ts'].content, content);
  assert.equal(await readFile(join(root, 'agent.ts'), 'utf8'), 'upgraded source\n');
});

test('recovery refuses newer user edits without a partial rollback; committed transactions finalize', async t => {
  const root = await fixture(t); await interrupted(root);
  await writeFile(join(root, 'first.ts'), 'new user edit after crash');
  await assert.rejects(recoverGeneration(root), /newer user edit/);
  assert.equal(await readFile(join(root, 'added.ts'), 'utf8'), 'new addition');
  assert.equal(await readFile(join(root, 'first.ts'), 'utf8'), 'new user edit after crash');
  await interrupted(root, 'committed');
  assert.equal((await recoverGeneration(root)).status, 'finalized');
  assert.equal(await readFile(join(root, 'first.ts'), 'utf8'), 'new first');
});

test('dependency locks remain user-owned and report actual manifest agreement separately', async t => {
  const root = await fixture(t);
  const packageFile = { path: 'package.json', content: JSON.stringify({ dependencies: { example: '^1' } }) };
  await regenerate(root, [packageFile], metadata);
  assert.equal((await dependencyLockStatus(root)).consistency, 'missing');
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { example: '^1' } } } });
  await writeFile(join(root, 'package-lock.json'), lock);
  assert.equal((await dependencyLockStatus(root)).consistency, 'matches');
  await regenerate(root, [{ ...packageFile, content: JSON.stringify({ dependencies: { example: '^2' } }) }], metadata);
  assert.equal((await dependencyLockStatus(root)).consistency, 'stale');
  assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), lock);
});
