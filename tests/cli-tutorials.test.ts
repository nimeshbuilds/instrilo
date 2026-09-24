import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const entry = resolve('src/cli.ts');
const cli = (...args: string[]) => exec(process.execPath, ['--import', 'tsx', entry, ...args], { maxBuffer: 2_000_000 });

test('tutorials are discoverable offline with exact CLI commands and explicit manual steps', async () => {
  const entries = JSON.parse((await cli('tutorials', 'list')).stdout);
  assert.equal(entries.length, 10);
  assert.ok(entries.some((item: any) => item.id === 'deployment-artifacts'));
  const rendered = (await cli('tutorials', 'show', 'subscription-setup')).stdout;
  assert.match(rendered, /instrilo tutorials setup/);
  assert.match(rendered, /instrilo setup codex/);
  assert.match(rendered, /Optional live\/manual step/);
  assert.match(rendered, /https:\/\/nimeshbuilds\.github\.io\/instrilo\/quickstarts\/evaluate-and-compare\//);
  assert.doesNotMatch(rendered, /\]\(#/);
  assert.match(rendered, /## Clean up after the guide/);
  assert.doesNotMatch(rendered, /node dist\/cli\.js/);
  await assert.rejects(() => cli('tutorials', 'show', '../../package.json'), (error: any) => error.code === 1 && /Unknown tutorial/.test(error.stderr));
});

test('tutorial setup creates an independent workspace, preserving existing work and symlink destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-tutorials-test-'));
  try {
    const workspace = join(root, 'fresh workspace');
    const result = JSON.parse((await cli('tutorials', 'setup', workspace)).stdout);
    assert.equal(result.directory, workspace);
    assert.equal(result.tutorials, 10);
    const copied = join(workspace, 'examples/quickstarts/foundations/answers.json');
    assert.equal(await readFile(copied, 'utf8'), await readFile('examples/quickstarts/foundations/answers.json', 'utf8'));
    assert.equal((await readdir(join(workspace, 'guides'))).length, 10);
    assert.match(await readFile(join(workspace, 'guides/first-typescript-agent.md'), 'utf8'), /instrilo init first-typescript-agent/);
    assert.ok(!(await readdir(workspace)).includes('node_modules'));
    await writeFile(copied, 'user edits to preserve');
    await assert.rejects(() => cli('tutorials', 'setup', workspace), (error: any) => error.code === 1 && /already exists/.test(error.stderr));
    assert.equal(await readFile(copied, 'utf8'), 'user edits to preserve');
    const link = join(root, 'linked workspace');
    await symlink(workspace, link);
    await assert.rejects(() => cli('tutorials', 'setup', link), (error: any) => error.code === 1 && /already exists/.test(error.stderr));
    assert.equal(await readFile(copied, 'utf8'), 'user edits to preserve');
    assert.notEqual(await readFile('examples/quickstarts/foundations/answers.json', 'utf8'), 'user edits to preserve');
  } finally { await rm(root, { recursive: true, force: true }); }
});
