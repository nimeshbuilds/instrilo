import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../scripts/build-site.mjs';
import { loadScenarios, scenarioFingerprint } from '../scripts/scenario-utils.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let directory: string;
let scenarios: Awaited<ReturnType<typeof loadScenarios>>;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'instrilo-site-'));
  scenarios = await loadScenarios();
  await buildSite(directory);
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function htmlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await htmlFiles(join(root, entry.name)));
    else if (entry.name.endsWith('.html')) files.push(join(root, entry.name));
  }
  return files;
}

test('site publishes ten static walkthroughs with source-exact commands, expected outcomes and manual labels', async () => {
  const index = await readFile(join(directory, 'index.html'), 'utf8');
  assert.equal((index.match(/data-scenario data-category=/g) ?? []).length, 10);
  assert.equal((await htmlFiles(directory)).length, 12);
  assert.match(index, /First guide: no model account needed/);
  assert.match(index, /instrilo web enable/);
  assert.match(index, /node dist\/cli\.js web enable/);
  const { version } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  assert.ok(index.includes(`npm install --global https://github.com/nimeshbuilds/instrilo/releases/download/v${version}/nimeshbuilds-instrilo-${version}.tgz`));
  assert.ok(index.includes(`https://github.com/nimeshbuilds/instrilo/releases/tag/v${version}`));
  assert.equal((index.match(/class="installation-card"/g) ?? []).length, 2, 'Two clear installation paths');
  assert.match(index, /<h3>Download the release<\/h3>/);
  assert.match(index, /<h3>Build from source<\/h3>/);
  assert.match(index, /--no-open/);
  assert.match(index, /Keep the terminal running and stop with Ctrl\+C/);
  assert.match(index, /These exact guides use the source checkout and bundled fixtures/);
  assert.match(index, /id="source-setup"/);
  for (const scenario of scenarios) {
    const html = await readFile(join(directory, 'quickstarts', scenario.id, 'index.html'), 'utf8');
    assert.ok(html.includes(`<h1>${escape(scenario.title)}</h1>`), scenario.id);
    assert.ok(html.includes(escape(scenario.outcome)), `${scenario.id}: outcome`);
    assert.ok(html.includes(escape(scenario.verification.scope)), `${scenario.id}: scope`);
    for (const prerequisite of scenario.prerequisites) assert.ok(html.includes(escape(prerequisite)), `${scenario.id}: prerequisite`);
    for (const limitation of scenario.verification.limitations) assert.ok(html.includes(escape(limitation)), `${scenario.id}: limitation`);
    const commands = [...html.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map(match => decode(match[1]));
    assert.deepEqual(commands, scenario.steps.flatMap((step: { code?: string; manualCode?: string }) => step.code || step.manualCode ? [step.code ?? step.manualCode] : []), `${scenario.id}: displayed commands differ from executable source`);
    assert.equal((html.match(/Manual step · not executed by walkthrough checks/g) ?? []).length, scenario.steps.filter((step: { manualCode?: string }) => step.manualCode).length);
    for (const [index, step] of scenario.steps.entries()) {
      assert.ok(html.includes(`id="step-${index + 1}"`), `${scenario.id}: step anchor`);
      assert.ok(html.includes(escape(step.expected)), `${scenario.id}: expected result`);
    }
    assert.ok(html.includes('id="cleanup"'), `${scenario.id}: cleanup`);
    assert.match(html, /href="\.\.\/\.\.\/index\.html#source-setup">source installation/);
  }
});

test('site resolves every local link, fragment and asset at a GitHub project subpath', async () => {
  for (const file of await htmlFiles(directory)) {
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const link = decode(match[1]);
      if (/^https?:\/\//.test(link)) {
        if (link.startsWith('https://github.com/nimeshbuilds/instrilo/blob/main/')) {
          const relative = link.slice('https://github.com/nimeshbuilds/instrilo/blob/main/'.length).split('#')[0];
          assert.ok((await stat(join(repository, relative))).isFile(), `Missing repository source link: ${link}`);
        }
        continue;
      }
      assert.ok(!link.startsWith('/'), `Project Pages links must remain relative: ${link}`);
      assert.ok(!/^[a-z]+:/i.test(link), `Unexpected link protocol: ${link}`);
      const [path, fragment] = link.split('#');
      const target = path ? resolve(dirname(file), path) : file;
      assert.ok(target === directory || target.startsWith(directory + sep), `Link escapes site: ${link}`);
      assert.ok((await stat(target)).isFile(), `Missing local file: ${link} from ${file}`);
      if (fragment) assert.ok((await readFile(target, 'utf8')).includes(`id="${fragment}"`), `Missing fragment: ${link} from ${file}`);
    }
  }
  const css = await readFile(join(directory, 'assets/styles.css'), 'utf8');
  for (const match of css.matchAll(/url\(['"]?(\.\/[^)'"\s]+)['"]?\)/g)) assert.ok((await stat(resolve(directory, 'assets', match[1]))).isFile());
  assert.ok((await stat(join(directory, '.nojekyll'))).isFile());
  const sitemap = await readFile(join(directory, 'sitemap.xml'), 'utf8');
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 11);
});

test('walkthroughs remain readable without scripts and contain accessible navigation and copy targets', async () => {
  for (const file of await htmlFiles(directory)) {
    const html = await readFile(file, 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /class="skip-link" href="#main"/);
    assert.match(html, /<main id="main"/);
    assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
    assert.match(html, /aria-label="Main navigation"/);
    assert.match(html, /<link rel="icon"/);
    for (const dependency of html.matchAll(/<(?:script|link\s+rel="stylesheet")[^>]+(?:src|href)="([^"]+)"/g)) {
      if (/^https?:\/\//.test(dependency[1])) assert.ok(dependency[1].startsWith('https://nimeshbuilds.github.io/instrilo/'), 'No third-party script or font dependency');
    }
    for (const image of html.matchAll(/<img\b[^>]*>/g)) assert.match(image[0], /\balt="/);
    for (const command of html.matchAll(/<pre\b[^>]*>/g)) assert.match(command[0], /tabindex="0"/);
  }
  const index = await readFile(join(directory, 'index.html'), 'utf8');
  assert.match(index, /class="guide-tools" hidden/);
  assert.equal((index.match(/<article[^>]+\bhidden\b/g) ?? []).length, 0);
  assert.match(index, /aria-live="polite"/);
});

test('published verification only claims a pass for the matching scenario fingerprint', async () => {
  const separate = await mkdtemp(join(tmpdir(), 'instrilo-site-evidence-'));
  try {
    const matching = scenarios[0];
    const stale = scenarios[1];
    const report = {
      schemaVersion: 1,
      generatedAt: '2026-09-24T00:00:00.000Z',
      platform: 'test', node: '22', privateField: 'must not publish',
      scenarios: [
        { id: matching.id, status: 'passed', scenarioHash: await scenarioFingerprint(matching), steps: matching.steps.filter((step: { code?: string }) => step.code).length, durationMs: 123 },
        { id: stale.id, status: 'passed', scenarioHash: 'obsolete', steps: 999, durationMs: 456 },
      ],
    };
    const result = await buildSite(separate, { verification: report });
    assert.equal(result.verified, 1);
    const currentPage = await readFile(join(separate, 'quickstarts', matching.id, 'index.html'), 'utf8');
    assert.match(currentPage, /Local steps checked/);
    const stalePage = await readFile(join(separate, 'quickstarts', stale.id, 'index.html'), 'utf8');
    assert.match(stalePage, /Checks need a refresh/);
    assert.doesNotMatch(stalePage, /Local steps checked/);
    const publicReport = JSON.parse(await readFile(join(separate, 'verification.json'), 'utf8'));
    assert.equal(publicReport.scenarios.filter((item: { status: string }) => item.status === 'passed').length, 1);
    assert.equal(publicReport.scenarios.find((item: { id: string }) => item.id === stale.id).status, 'unverified');
    assert.equal(publicReport.privateField, undefined);
    const absent = await buildSite(separate, { verification: null });
    assert.equal(absent.verified, 0);
    assert.doesNotMatch(await readFile(join(separate, 'index.html'), 'utf8'), /Local steps checked/);
  } finally {
    await rm(separate, { recursive: true, force: true });
  }
});
