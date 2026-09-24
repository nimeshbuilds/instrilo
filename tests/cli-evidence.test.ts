import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { captureEvidenceSnapshot, reportCompatibleHash } from '../src/evidence.js';
import type { EvalCase, EvalReport } from '../src/types.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const tsx = join(repository, 'node_modules/tsx/dist/cli.mjs');
const cli = join(repository, 'src/cli.ts');
type Result = { code: number | null; stdout: string; stderr: string };
async function run(args: string[], cwd = repository): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, cli, ...args], { cwd, env: process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI fixture timed out.')); }, 20_000);
    child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
function success(result: Result): void { assert.equal(result.code, 0, result.stderr + '\n' + result.stdout); }
function json(result: Result): any { success(result); return JSON.parse(result.stdout); }
const data = (value: unknown) => ['--data', JSON.stringify(value)];

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-cli-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  success(await run(['init', 'review-demo', '--directory', root]));
  const project = join(root, 'review-demo');
  const item: EvalCase = { id: 'fixture-grounding', input: 'A fixture task.', expected: 'A grounded result.', contains: ['grounded'], source: 'reviewed', split: 'holdout' };
  json(await run(['cases', 'add', project, ...data(item)]));
  const snapshot = await captureEvidenceSnapshot(project);
  const report: EvalReport = {
    id: randomUUID(), createdAt: new Date().toISOString(), project: 'review-demo', mode: 'demo', split: 'holdout', total: 1, passed: 1, passRate: 1, reviewed: 1, synthetic: 0,
    results: [{ id: item.id, caseHash: reportCompatibleHash(item), input: item.input, output: 'A grounded result.', passed: true, checks: [{ name: 'Required content: grounded', passed: true, detail: 'Explicit fixture check; no model ran.' }], durationMs: 1 }],
    ...snapshot, datasetHash: reportCompatibleHash([item]), warnings: ['Constructed offline test fixture, no model quality measured.'],
  };
  await mkdir(join(project, 'reports'));
  const reportPath = join(project, 'reports/fixture.json'); await writeFile(reportPath, JSON.stringify(report));
  const requirement = { id: 'REQ-FIXTURE', text: 'Draft a grounded result.', sourcePath: 'purpose.md', reviewer: 'Owner', reason: 'A human-reviewed fixture relationship, not product quality evidence.' };
  const link = ['requirements', 'link', requirement.id, project, '--case', item.id, '--kind', 'deterministic', '--reviewer', 'Owner', '--reason', 'Checks the fixture output.'];
  return { root, project, item, report, reportPath, requirement, link };
}

test('real CLI requirements, report, policy and review flow remains explicit offline evidence', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const registered = json(await run(['evidence', 'register', f.project, '--file', f.reportPath]));
  assert.equal(registered.report.id, f.report.id);
  assert.equal(json(await run(['evidence', 'register', f.project, '--file', f.reportPath])).reportHash, registered.reportHash);
  const noRequirements = await run(['release', f.project, '--report', f.report.id]);
  assert.equal(noRequirements.code, 2); assert.ok(JSON.parse(noRequirements.stdout).issues.some((i: any) => i.code === 'NO_REQUIREMENTS'));
  const requirement = json(await run(['requirements', 'add', f.project, ...data(f.requirement)]));
  assert.equal(requirement.review.state, 'reviewed');
  json(await run(f.link));
  assert.equal(json(await run(['requirements', 'status'], f.project)).counts.ready, 1);
  assert.equal(json(await run(['requirements', 'list', f.project])).length, 1);
  const blocked = await run(['release', f.project, '--report', 'reports/fixture.json']);
  assert.equal(blocked.code, 2); assert.ok(JSON.parse(blocked.stdout).issues.some((i: any) => i.code === 'DEMO_EVIDENCE'));
  const policy = json(await run(['policy', 'template'])); assert.equal(policy.schemaVersion, '1'); assert.equal(policy.allowDemo, false);
  json(await run(['policy', 'apply', f.project, ...data({ schemaVersion: '1', allowDemo: true, requireHumanReview: true })]));
  assert.equal(json(await run(['policy', 'show', f.project])).requireHumanReview, true);
  const missingHuman = await run(['release', f.project, '--report', f.report.id]);
  assert.equal(missingHuman.code, 2); assert.ok(JSON.parse(missingHuman.stdout).issues.some((i: any) => i.code === 'HUMAN_REVIEW_REQUIRED'));
  const queuePath = join(f.root, 'queue.json');
  json(await run(['review', 'queue', f.project, '--report', f.report.id, '--output', queuePath]));
  const queue = JSON.parse(await readFile(queuePath, 'utf8')); assert.equal(queue.blind, true); assert.equal(queue.cases[0].automated, undefined);
  const label = json(await run(['review', 'label', f.project, ...data({ reportId: f.report.id, caseId: f.item.id, binding: queue.cases[0].binding, verdict: 'pass', reviewer: 'Alice', reason: 'Matches this fixture, independently reviewed.' })]));
  assert.equal(json(await run(['review', 'assessments', f.project, '--report', f.report.id])).cases[0].reviewers, 1);
  const outputPath = join(f.root, 'release.json');
  json(await run(['release', f.project, '--report', f.report.id, '--output', outputPath]));
  const smoke = JSON.parse(await readFile(outputPath, 'utf8')); assert.equal(smoke.allowed, true); assert.equal(smoke.classification, 'smoke-only');
  const calibration = json(await run(['review', 'calibrate', f.project, '--report', f.report.id])); assert.equal(calibration.sampleCount, 0); assert.equal(calibration.usableForCurrentRelease, false);
  const exportPath = join(f.root, 'labels.json'); json(await run(['review', 'export', f.project, '--output', exportPath]));
  assert.deepEqual(json(await run(['review', 'import', f.project, '--file', exportPath])), { imported: 0, existing: 1 });
  const duplicate = await run(['review', 'label', f.project, ...data({ reportId: f.report.id, caseId: f.item.id, verdict: 'fail', reviewer: 'alice', reason: 'Cannot overwrite.' })]); assert.equal(duplicate.code, 1); assert.match(duplicate.stderr, /already labeled/);
  json(await run(['review', 'label', f.project, ...data({ reportId: f.report.id, caseId: f.item.id, verdict: 'fail', reviewer: 'Alice', reason: 'Corrected after checking the reference.', supersedes: label.id })]));
  const rejected = await run(['release', f.project, '--report', f.report.id]); assert.equal(rejected.code, 2); assert.ok(JSON.parse(rejected.stdout).issues.some((i: any) => i.code === 'HUMAN_REVIEW_REJECTED'));
  assert.equal(json(await run(['review', 'export', f.project])).labels.length, 2);
});

test('real CLI detects stale sources and supports audited unlink, imports and waivers', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  json(await run(['requirements', 'import', f.project, ...data({ schemaVersion: '1', requirements: [f.requirement] })]));
  json(await run(f.link));
  await writeFile(join(f.project, 'guidance/purpose.md'), '# Purpose\n\nThe fixture guidance changed.\n');
  assert.equal(json(await run(['evidence', 'status', f.project])).requirements[0].status, 'stale-source');
  const staleLink = await run(f.link); assert.equal(staleLink.code, 1); assert.match(staleLink.stderr, /changed/);
  json(await run(['requirements', 'update', f.requirement.id, f.project, '--expected-revision', '1', ...data({ reviewer: 'Owner', reason: 'Rechecked the changed guidance.' })]));
  assert.equal(json(await run(['requirements', 'status', f.project])).requirements[0].status, 'stale-link');
  const wrongRevision = await run(['requirements', 'update', f.requirement.id, f.project, '--expected-revision', '1', ...data({ text: 'Concurrent stale update.' })]); assert.equal(wrongRevision.code, 1);
  const unlink = ['requirements', 'unlink', f.requirement.id, f.project, '--case', f.item.id, '--reviewer', 'Owner', '--reason', 'Obsolete coverage.'];
  assert.equal((await run([...unlink, '--kind', 'made-up'])).code, 1);
  json(await run([...unlink, '--kind', 'deterministic']));
  assert.equal(json(await run(['requirements', 'status', f.project])).requirements[0].status, 'uncovered');
  json(await run(['requirements', 'waive', f.requirement.id, f.project, '--reviewer', 'Owner', '--reason', 'Explicit test waiver.']));
  assert.equal(json(await run(['requirements', 'status', f.project])).requirements[0].status, 'waived');
  json(await run(f.link)); assert.equal(json(await run(['requirements', 'status', f.project])).requirements[0].status, 'ready');
  const duplicate = await run(['requirements', 'add', f.project, ...data(f.requirement)]); assert.equal(duplicate.code, 1);
  const badPolicy = await run(['policy', 'apply', f.project, ...data({ schemaVersion: '1', allowDemo: 'false' })]); assert.equal(badPolicy.code, 1);
  const bothInputs = await run(['requirements', 'add', f.project, '--file', f.reportPath, ...data(f.requirement)]); assert.equal(bothInputs.code, 1); assert.match(bothInputs.stderr, /exactly one/);
  const escaped = await run(['release', f.project, '--report', '../outside.json']); assert.equal(escaped.code, 1); assert.match(escaped.stderr, /inside/);
});

test('CLI help describes every evidence operation with one project argument and discoverable guides', { timeout: 30_000 }, async () => {
  const reference = json(await run(['help', '--json'])) as any[];
  for (const command of ['requirements add', 'requirements import', 'requirements list', 'requirements update', 'requirements link', 'requirements unlink', 'requirements waive', 'requirements status', 'evidence register', 'evidence status', 'policy show', 'policy apply', 'review queue', 'review label', 'review import', 'review export', 'review assessments', 'review calibrate', 'release']) {
    const item = reference.find(c => c.command === `instrilo ${command}`);
    assert.ok(item, command); assert.ok(item.description.length > 0, command);
    assert.equal(item.arguments.filter((a: any) => a.name === 'project').length, 1, command);
    assert.equal(item.arguments.find((a: any) => a.name === 'project').required, false, command);
    assert.ok(['requirements', 'review', 'release'].includes(item.topic), command);
  }
  const help = await run(['help', 'requirements', 'unlink']); success(help); assert.match(help.stdout, /--reviewer/); assert.match(help.stdout, /--kind/); assert.match(help.stdout, /Guide: instrilo explain requirements/);
  const release = reference.find(c => c.command === 'instrilo release'); assert.ok(release.options.find((o: any) => o.flags === '--report <id-or-path>' && o.required));
  const manual = await run(['explain', 'release']); success(manual); assert.match(manual.stdout, /exit 2/i); assert.match(manual.stdout, /does not.*deploy/);
  const noRequiredReport = await run(['release']); assert.equal(noRequiredReport.code, 1); assert.match(noRequiredReport.stderr, /required option/);
});
