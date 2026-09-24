import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject, buildProject, manifestName } from '../src/workbench.js';
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
