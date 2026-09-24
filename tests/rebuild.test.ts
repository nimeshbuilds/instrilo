import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject, buildProject, planProject, manifestName } from '../src/workbench.js';
import { saveSpec } from '../src/core.js';

test('rebuilding removes obsolete owned artifacts and preserves obsolete files with manual edits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nb-rebuild-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { dir, spec } = await createProject(root, { name: 'rebuild-test' });
  spec.delivery.hosts = ['codex']; const manifest = join(dir, manifestName); await saveSpec(manifest, spec);
  await buildProject(manifest);
  const generated = join(dir, 'generated');
  assert.match(await readFile(join(generated, 'AGENTS.md'), 'utf8'), /rebuild-test/);
  const modifiedPath = 'hosts/codex-config.toml';
  await writeFile(join(generated, modifiedPath), '# Manual project-specific configuration\n');
  spec.delivery.hosts = []; await saveSpec(manifest, spec);
  const rebuilt = await buildProject(manifest, undefined, true);
  await assert.rejects(access(join(generated, 'AGENTS.md')));
  assert.equal(await readFile(join(generated, modifiedPath), 'utf8'), '# Manual project-specific configuration\n');
  assert.ok(rebuilt.issues.some(issue => issue.code === 'MODIFIED_OBSOLETE_ARTIFACT' && issue.path === modifiedPath));
  const lock = JSON.parse(await readFile(join(generated, 'build-lock.json'), 'utf8'));
  assert.match(lock.generatedFiles['agent.ts'], /^[a-f0-9]{64}$/); assert.equal(lock.generatedFiles['AGENTS.md'], undefined);
});

test('changed source guidance updates generated mirrors while preserving custom runtime code', async t => {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-guidance-upgrade-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { dir } = await createProject(root, { name: 'guidance-upgrade' });
  const manifest = join(dir, manifestName), generated = join(dir, 'generated');
  const first = await buildProject(manifest);
  const agent = await readFile(join(generated, 'agent.ts'), 'utf8');
  await writeFile(join(generated, 'agent.ts'), agent + '\n// User-owned application customization\n');
  const beforeGuidance = await readFile(join(generated, 'guidance.md'), 'utf8');
  await writeFile(join(dir, 'guidance/purpose.md'), '# Purpose\n\nHelp a user draft an accurate support response.\n');
  const plan = await planProject(manifest);
  assert.equal(plan.changes.find(change => change.path === 'agent.ts')?.action, 'preserve');
  assert.equal(plan.changes.find(change => change.path === 'guidance.md')?.action, 'update');
  assert.deepEqual(plan.conflicts, []);
  assert.equal(await readFile(join(generated, 'guidance.md'), 'utf8'), beforeGuidance, 'Planning must not update the generated source');
  const rebuilt = await buildProject(manifest, undefined, true, { expectedPlanHash: plan.planHash });
  assert.equal(rebuilt.applied, true);
  assert.match(await readFile(join(generated, 'agent.ts'), 'utf8'), /User-owned application customization/);
  assert.match(await readFile(join(generated, 'guidance.md'), 'utf8'), /accurate support response/);
  await access(join(generated, '.instrilo/baselines', first.plan.generationId + '.json'));
  const lock = JSON.parse(await readFile(join(generated, 'build-lock.json'), 'utf8'));
  assert.match(lock.generatorFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(Object.keys(lock.templateHashes).length > 0);
});
