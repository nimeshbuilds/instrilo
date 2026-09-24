import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject, manifestName } from '../src/workbench.js';
import { loadSpec, saveSpec } from '../src/core.js';
import { captureEvidenceSnapshot, registerEvidenceReport, reportCompatibleHash } from '../src/evidence.js';
import { addReview, calibrationReport, exportReviews, importReviews, reviewAssessments, reviewQueue } from '../src/review.js';
import type { EvalCase, EvalReport } from '../src/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-review-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { dir } = await createProject(root, { name: 'review-agent' });
  const spec = await loadSpec(join(dir, manifestName));
  spec.connections = { fixture: { kind: 'gateway', model: 'fake-local-model', baseUrl: 'http://127.0.0.1:19999/v1', auth: { type: 'none' } } }; spec.roles = { builder: 'fixture', runtime: 'fixture', judge: 'fixture' };
  await saveSpec(join(dir, manifestName), spec);
  const cases: EvalCase[] = ['correct', 'incorrect', 'disputed', 'unseen'].map(id => ({ id, input: `Task ${id}`, expected: `Expected ${id}`, source: 'reviewed', split: 'holdout' }));
  await writeFile(join(dir, 'evals/cases.jsonl'), cases.map(c => JSON.stringify(c)).join('\n') + '\n');
  const snapshot = await captureEvidenceSnapshot(dir);
  const report: EvalReport = { id: randomUUID(), createdAt: new Date().toISOString(), project: spec.name, mode: 'live', split: 'holdout', total: 4, passed: 3, passRate: .75, reviewed: 4, synthetic: 0,
    results: cases.map(c => ({ id: c.id, caseHash: reportCompatibleHash(c), input: c.input, output: `Output ${c.id}`, passed: c.id !== 'disputed', checks: [{ name: 'Judge rubric', passed: c.id !== 'disputed', detail: 'HIDDEN-JUDGE-RATIONALE' }], judge: { score: c.id === 'disputed' ? .2 : .9, rationale: 'HIDDEN-JUDGE-RATIONALE' }, durationMs: 1 })), ...snapshot, warnings: [] };
  await registerEvidenceReport(dir, report);
  const label = (caseId: string, verdict: 'pass' | 'fail' | 'abstain', reviewer = 'Alice') => addReview(dir, { reportId: report.id, caseId, verdict, reviewer, reason: `Human fixture assessment of ${caseId}.` });
  return { dir, spec, report, label };
}

test('blind queues bind exact evidence while omitting automated and prior human verdicts', async t => {
  const f = await fixture(t); await f.label('correct', 'pass');
  const queue = await reviewQueue(f.dir, f.report.id);
  assert.equal(queue.blind, true); assert.equal(queue.current, true);
  assert.ok(queue.cases.every(c => c.automated === undefined && c.human === undefined));
  assert.ok(!JSON.stringify(queue).includes('HIDDEN-JUDGE-RATIONALE'));
  assert.match(queue.cases[0].binding.outputHash, /^[a-f0-9]{64}$/);
  const visible = await reviewQueue(f.dir, f.report.id, { blind: false });
  assert.equal(visible.cases[0].automated?.judge?.score, .9);
  const wrong = structuredClone(queue.cases[1].binding); wrong.outputHash = 'a'.repeat(64);
  await assert.rejects(addReview(f.dir, { reportId: f.report.id, caseId: 'incorrect', verdict: 'fail', reviewer: 'Alice', reason: 'Stale screen.', binding: wrong }), /changed/);
});

test('labels are immutable, corrections append history, and disagreements remain unresolved', async t => {
  const f = await fixture(t); const first = await f.label('correct', 'pass');
  await assert.rejects(f.label('correct', 'fail', 'alice'), /already labeled/);
  const opposing = await f.label('correct', 'fail', 'Bob');
  assert.equal((await reviewAssessments(f.dir, f.report.id)).cases[0].status, 'disagreement');
  assert.equal((await calibrationReport(f.dir, f.report.id)).sampleCount, 0);
  await assert.rejects(addReview(f.dir, { reportId: f.report.id, caseId: 'correct', verdict: 'pass', reviewer: 'Charlie', reason: 'Not my review', supersedes: opposing.id }), /same reviewer/);
  const corrected = await addReview(f.dir, { reportId: f.report.id, caseId: 'correct', verdict: 'pass', reviewer: 'Bob', reason: 'Rechecked the reference.', supersedes: opposing.id });
  const exported = await exportReviews(f.dir);
  assert.equal(exported.labels.length, 3);
  assert.equal(exported.labels.find(l => l.id === first.id)?.verdict, 'pass');
  assert.equal(exported.labels.find(l => l.id === opposing.id)?.verdict, 'fail');
  assert.equal(corrected.supersedes, opposing.id);
  const assessment = (await reviewAssessments(f.dir, f.report.id)).cases[0];
  assert.equal(assessment.status, 'agreed'); assert.equal(assessment.reviewers, 2);
});

test('calibration reports sample counts, false passes/fails, disagreements and abstentions separately', async t => {
  const f = await fixture(t);
  await f.label('correct', 'pass'); await f.label('incorrect', 'fail'); await f.label('disputed', 'pass'); await f.label('unseen', 'abstain');
  const report = await calibrationReport(f.dir, f.report.id);
  assert.equal(report.sampleCount, 3);
  assert.equal(report.agreementRate, 1 / 3);
  assert.deepEqual(report.confusion, { agreedPass: 1, agreedFail: 0, falsePass: 1, falseFail: 1 });
  assert.equal(report.abstained, 1); assert.equal(report.unresolvedDisagreements, 0);
  await f.label('disputed', 'fail', 'Bob');
  const disputed = await calibrationReport(f.dir, f.report.id);
  assert.equal(disputed.unresolvedDisagreements, 1); assert.equal(disputed.sampleCount, 2);
});

test('changed judge or guidance marks historical reviews unusable for current release', async t => {
  const f = await fixture(t); await f.label('correct', 'pass');
  f.spec.evaluation.threshold = .99; await saveSpec(join(f.dir, manifestName), f.spec);
  const calibration = await calibrationReport(f.dir, f.report.id);
  assert.equal(calibration.current, false); assert.equal(calibration.usableForCurrentRelease, false);
  assert.equal(calibration.confusion.agreedPass, 1, 'Historical decision uses the original recorded judge result.');
  assert.ok(calibration.issues.some(i => i.code === 'REPORT_JUDGE_CHANGED'));
  await writeFile(join(f.dir, 'guidance/purpose.md'), '# Purpose\nChanged since evaluation.');
  assert.ok((await reviewQueue(f.dir, f.report.id)).issues.some(i => i.code === 'REPORT_GUIDANCE_CHANGED'));
});

test('review import is idempotent, bounded and rejects altered labels or bindings', async t => {
  const f = await fixture(t); await f.label('correct', 'pass');
  const exported = await exportReviews(f.dir);
  assert.deepEqual(await importReviews(f.dir, exported), { imported: 0, existing: 1 });
  const changed = structuredClone(exported); changed.labels[0].reason = 'Replaced original reason';
  await assert.rejects(importReviews(f.dir, changed), /immutable/);
  const unbound = structuredClone(exported); unbound.labels[0].binding.outputHash = 'b'.repeat(64);
  await assert.rejects(importReviews(f.dir, unbound), /snapshot/);
  const unknown = structuredClone(exported); unknown.labels[0].binding.reportId = 'unknown-report';
  await assert.rejects(importReviews(f.dir, unknown));
  const path = join(f.dir, '.instrilo/evidence/reviews.json'), raw = JSON.parse(await readFile(path, 'utf8')); raw.data.labels[0].verdict = 'fail'; await writeFile(path, JSON.stringify(raw));
  await assert.rejects(exportReviews(f.dir), /checksum/);
});

test('demo reports and absent judges never count as calibrated model judgments', async t => {
  const f = await fixture(t);
  const report = structuredClone(f.report); report.id = randomUUID(); report.mode = 'demo';
  await registerEvidenceReport(f.dir, report);
  await addReview(f.dir, { reportId: report.id, caseId: 'correct', verdict: 'pass', reviewer: 'owner', reason: 'Smoke output only.' });
  const calibration = await calibrationReport(f.dir, report.id);
  assert.equal(calibration.sampleCount, 0); assert.equal(calibration.agreementRate, null); assert.equal(calibration.unscored, 1);
  assert.equal(calibration.usableForCurrentRelease, false);
});
