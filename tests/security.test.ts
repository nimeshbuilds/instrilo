import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadSpec, saveSpec } from '../src/core.js';
import { runProject } from '../src/execution.js';
import { startServer } from '../src/server.js';
import { buildProject, createProject, listProjects, manifestName } from '../src/workbench.js';

async function projectFixture(language: 'typescript' | 'python' = 'typescript') {
  const temp = await mkdtemp(join(tmpdir(), 'nb-security-'));
  const root = join(temp, 'workspace');
  const project = await createProject(root, { name: 'security-agent', language });
  const manifest = join(project.dir, manifestName);
  return { temp, root, ...project, manifest, generated: join(project.dir, 'generated'), cleanup: () => rm(temp, { recursive: true, force: true }) };
}

async function withApp(run: (fixture: Awaited<ReturnType<typeof projectFixture>>, call: (path: string, body?: unknown) => Promise<Response>) => Promise<void>) {
  const fixture = await projectFixture();
  const app = await startServer({ workspace: fixture.root, port: 0 });
  const call = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${app.port}/api/projects/security-agent/${path}`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'X-Studio-Token': app.token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try { await run(fixture, call); }
  finally { app.server.closeAllConnections(); await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve())); await fixture.cleanup(); }
}

test('artifact preview cannot read through a nested directory symlink', async () => {
  await withApp(async (fixture, call) => {
    const outside = join(fixture.temp, 'outside');
    await mkdir(outside); await mkdir(fixture.generated);
    await writeFile(join(outside, 'private.txt'), 'outside-private-sentinel');
    await symlink(outside, join(fixture.generated, 'linked'));
    const response = await call('artifact?path=linked%2Fprivate.txt');
    const data = await response.json();
    assert(response.status >= 400, 'Preview must reject the symlink path');
    assert(!JSON.stringify(data).includes('outside-private-sentinel'));
  });
});

test('download cannot traverse a symlinked generated root', async () => {
  await withApp(async (fixture, call) => {
    const outside = join(fixture.temp, 'outside');
    await mkdir(outside); await writeFile(join(outside, 'private.txt'), 'outside-private-sentinel');
    await symlink(outside, fixture.generated);
    const response = await call('download');
    assert(response.status >= 400, 'Export must reject the symlinked root');
  });
});

test('dataset saving does not overwrite symlink targets at temporary or final paths', async () => {
  await withApp(async (fixture, call) => {
    const outside = join(fixture.temp, 'unrelated.txt');
    const dataset = join(fixture.dir, fixture.spec.evaluation.dataset);
    const cases = [{ id: 'one', input: 'hello', expected: 'hello', source: 'reviewed', split: 'holdout' }];
    await writeFile(outside, 'untouched');
    await symlink(outside, dataset + '.pending');
    await call('cases', { cases });
    assert.equal(await readFile(outside, 'utf8'), 'untouched', 'Temporary-path symlink must not be followed');
    await rm(dataset + '.pending', { force: true });
    await rm(dataset);
    await symlink(outside, dataset);
    await call('cases', { cases });
    assert.equal(await readFile(outside, 'utf8'), 'untouched', 'Final-path symlink must not be followed');
  });
});

test('app rejects guidance and dataset paths outside the selected project before saving', async () => {
  await withApp(async (fixture, call) => {
    for (const field of ['guidanceDir', 'dataset']) {
      const spec = structuredClone(fixture.spec);
      if (field === 'guidanceDir') spec.guidanceDir = '../outside';
      else spec.evaluation.dataset = '../outside.jsonl';
      const response = await call('spec', { spec });
      assert(response.status >= 400, `${field} must be project-contained`);
      const saved = await loadSpec(fixture.manifest);
      assert.equal(saved.guidanceDir, fixture.spec.guidanceDir);
      assert.equal(saved.evaluation.dataset, fixture.spec.evaluation.dataset);
    }
  });
});

test('project listing never exposes unsafe directory names as HTML action identifiers', async () => {
  const fixture = await projectFixture();
  try {
    const bad = join(fixture.root, 'bad" data-action="build');
    await mkdir(bad); await saveSpec(join(bad, manifestName), fixture.spec);
    const projects = await listProjects(fixture.root);
    assert(projects.every(project => /^[a-z][a-z0-9-]{1,62}$/.test(project.id)));
  } finally { await fixture.cleanup(); }
});

test('changed manifest is refused before running an old generated agent', async () => {
  const fixture = await projectFixture();
  try {
    await buildProject(fixture.manifest);
    const changed = await loadSpec(fixture.manifest);
    changed.agent.systemPrompt = 'A new instruction set that is not in the existing build.';
    await saveSpec(fixture.manifest, changed);
    await assert.rejects(runProject(changed, fixture.generated, 'no inference should occur'), /configuration changed|stale|rebuild/i);
  } finally { await fixture.cleanup(); }
});

test('changed guidance is refused before running an old generated agent', async () => {
  const fixture = await projectFixture();
  try {
    await buildProject(fixture.manifest);
    await writeFile(join(fixture.dir, 'guidance', 'purpose.md'), '# Purpose\n\nChanged after the build.');
    await assert.rejects(runProject(await loadSpec(fixture.manifest), fixture.generated, 'no inference should occur'), /guidance changed|stale|rebuild/i);
  } finally { await fixture.cleanup(); }
});

test('changed generated connection snapshot is refused before executing it', async () => {
  const fixture = await projectFixture();
  try {
    await buildProject(fixture.manifest);
    const path = join(fixture.generated, 'agent-spec.json');
    const generated = JSON.parse(await readFile(path, 'utf8'));
    generated.agent.systemPrompt = 'A different generated snapshot.';
    await writeFile(path, JSON.stringify(generated));
    await assert.rejects(runProject(await loadSpec(fixture.manifest), fixture.generated, 'no inference should occur'), /snapshot|generated.*changed|stale|rebuild|build.*match/i);
  } finally { await fixture.cleanup(); }
});

test('run cancellation terminates child work rather than only its launcher', { skip: process.platform === 'win32' }, async () => {
  const fixture = await projectFixture('python');
  const originalPython = process.env.NB_AGENT_PYTHON;
  const marker = join(fixture.temp, 'unexpected-side-effect');
  const ready = join(fixture.temp, 'ready');
  const fakeRuntime = join(fixture.temp, 'fake-python');
  try {
    await buildProject(fixture.manifest);
    const childCode = `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'continued after cancellation'); }, 500);`;
    await writeFile(fakeRuntime, `#!${process.execPath}\nconst {spawn}=require('node:child_process'); const fs=require('node:fs'); spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}).unref(); fs.writeFileSync(${JSON.stringify(ready)},'ready'); setInterval(()=>{},1000);\n`, { mode: 0o755 });
    process.env.NB_AGENT_PYTHON = fakeRuntime;
    const controller = new AbortController();
    const result = runProject(await loadSpec(fixture.manifest), fixture.generated, 'fixture', controller.signal).then(() => null, error => error);
    for (let tries = 0; tries < 100; tries++) {
      try { await access(ready); break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    controller.abort();
    const error = await result;
    assert(error instanceof Error && /cancel/i.test(error.message));
    await new Promise(resolve => setTimeout(resolve, 650));
    await assert.rejects(access(marker), { code: 'ENOENT' });
  } finally {
    if (originalPython === undefined) delete process.env.NB_AGENT_PYTHON; else process.env.NB_AGENT_PYTHON = originalPython;
    await fixture.cleanup();
  }
});
