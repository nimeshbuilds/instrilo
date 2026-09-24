import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject, manifestName } from '../src/workbench.js';
import { loadSpec, saveSpec } from '../src/core.js';
import {
  addRequirement, captureEvidenceSnapshot, evidenceStatus, importReleasePolicy, importRequirements, linkRequirement, listRequirements,
  loadRegisteredReport, parseReleasePolicy, registerEvidenceReport, releaseEvidence, reportCompatibleHash, unlinkRequirement, updateRequirement, waiveRequirement,
} from '../src/evidence.js';
import { addReview } from '../src/review.js';
import type { EvalCase, EvalReport } from '../src/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }, extraCases: EvalCase[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { dir } = await createProject(root, { name: 'evidence-agent' });
  const spec = await loadSpec(join(dir, manifestName));
  spec.connections = { fixture: { kind: 'gateway', model: 'local-fixture-only', baseUrl: 'http://127.0.0.1:19999/v1', auth: { type: 'none' } } };
  spec.roles = { builder: 'fixture', runtime: 'fixture', judge: 'fixture' };
  await saveSpec(join(dir, manifestName), spec);
  await writeFile(join(dir, 'guidance/purpose.md'), '# Purpose\n\nDraft a grounded answer. Escalate billing disputes.\n');
  const cases: EvalCase[] = [{ id: 'grounded-answer', input: 'Draft an answer.', expected: 'A grounded answer.', contains: ['grounded'], source: 'reviewed', split: 'holdout' }, ...extraCases];
  await writeFile(join(dir, 'evals/cases.jsonl'), cases.map(c => JSON.stringify(c)).join('\n') + '\n');
  const report = async (overrides: Partial<EvalReport> = {}): Promise<EvalReport & { guidanceHash: string }> => {
    const snapshot = await captureEvidenceSnapshot(dir);
    return { id: randomUUID(), createdAt: new Date().toISOString(), project: spec.name, mode: 'live', split: 'holdout', total: cases.length, passed: cases.length, passRate: 1, reviewed: cases.filter(c => c.source === 'reviewed').length, synthetic: cases.filter(c => c.source === 'synthetic').length,
      results: cases.map(c => ({ id: c.id, caseHash: reportCompatibleHash(c), input: c.input, output: 'A grounded answer.', passed: true, checks: [{ name: 'Contains expected text', passed: true, detail: 'grounded' }, { name: 'Judge rubric', passed: true, detail: 'Fixture judgment, no model invoked.' }], judge: { score: .95, rationale: 'Fixture judgment, no model invoked.' }, durationMs: 1 })), ...snapshot, warnings: [], ...overrides };
  };
  const requirement = () => addRequirement(dir, { id: 'REQ-GROUNDING', title: 'Ground the answer', text: 'Draft a grounded answer.', sourcePath: 'purpose.md', reviewer: 'owner', reason: 'Checked this requirement against the project brief.' });
  const link = () => linkRequirement(dir, 'REQ-GROUNDING', { caseId: cases[0].id, kind: 'deterministic', reviewer: 'owner', reason: 'The required output assertion covers this fixture requirement.' });
  return { root, dir, spec, cases, report, requirement, link };
}

test('requirements are reviewed explicitly and imports are atomic', async t => {
  const f = await fixture(t);
  const proposed = await addRequirement(f.dir, { id: 'REQ-1', text: 'Keep sources.', sourcePath: 'purpose.md' });
  assert.equal(proposed.review.state, 'proposed');
  await assert.rejects(linkRequirement(f.dir, 'REQ-1', { caseId: f.cases[0].id, kind: 'deterministic', reviewer: 'owner', reason: 'test' }), /Review/);
  await assert.rejects(importRequirements(f.dir, { schemaVersion: '1', requirements: [{ id: 'REQ-2', text: 'New', sourcePath: 'purpose.md' }, { id: 'REQ-1', text: 'Duplicate', sourcePath: 'purpose.md' }] }), /already exists/);
  assert.equal((await listRequirements(f.dir)).length, 1);
  await assert.rejects(addRequirement(f.dir, { id: 'REQ-ESCAPE', text: 'Invalid source', sourcePath: '../outside.md' }));
  await assert.rejects(addRequirement(f.dir, { id: 'REQ-SECRET', text: 'Invalid source', sourcePath: '.env' }), /eligible/);
});

test('changed guidance and cases invalidate previous review and coverage links', async t => {
  const f = await fixture(t);
  await f.requirement(); await f.link();
  assert.equal((await evidenceStatus(f.dir)).requirements[0].status, 'ready');
  await writeFile(join(f.dir, 'guidance/purpose.md'), '# Purpose\n\nDraft grounded answers with new source requirements.\n');
  assert.equal((await evidenceStatus(f.dir)).requirements[0].status, 'stale-source');
  await assert.rejects(f.link(), /changed/);
  const reviewed = await updateRequirement(f.dir, 'REQ-GROUNDING', { reviewer: 'owner', reason: 'Reviewed the revised source.' }, { expectedRevision: 1 });
  assert.equal(reviewed.revision, 2);
  assert.equal((await evidenceStatus(f.dir)).requirements[0].status, 'stale-link');
  await assert.rejects(updateRequirement(f.dir, 'REQ-GROUNDING', { text: 'Old editor draft' }, { expectedRevision: 1 }), /changed/);
  await f.link();
  f.cases[0].expected = 'A more specific grounded answer.';
  await writeFile(join(f.dir, 'evals/cases.jsonl'), JSON.stringify(f.cases[0]) + '\n');
  assert.equal((await evidenceStatus(f.dir)).requirements[0].status, 'stale-link');
});

test('current reviewed deterministic holdout evidence passes the strict release gate', async t => {
  const f = await fixture(t); await f.requirement(); await f.link();
  const report = await f.report(); await registerEvidenceReport(f.dir, report);
  const gate = await releaseEvidence(f.dir, report.id);
  assert.equal(gate.allowed, true, JSON.stringify(gate.issues));
  assert.equal(gate.classification, 'release-evidence');
  assert.equal(gate.requirements[0].linkedCases[0], 'grounded-answer');
  await addReview(f.dir, { reportId: report.id, caseId: f.cases[0].id, verdict: 'pass', reviewer: 'reviewer-one', reason: 'Output matches the reviewed fixture.' });
  assert.equal((await releaseEvidence(f.dir, report.id, { schemaVersion: '1', requireHumanReview: true })).allowed, true);
  const missingQuorum = await releaseEvidence(f.dir, report.id, { schemaVersion: '1', requireHumanReview: true, minHumanReviews: 2 });
  assert.equal(missingQuorum.allowed, false);
  assert.ok(missingQuorum.issues.some(i => i.code === 'HUMAN_REVIEW_REQUIRED'));
  await addReview(f.dir, { reportId: report.id, caseId: f.cases[0].id, verdict: 'fail', reviewer: 'reviewer-two', reason: 'An additional reviewer rejected the answer.' });
  const disputed = await releaseEvidence(f.dir, report.id);
  assert.equal(disputed.allowed, false);
  assert.ok(disputed.issues.some(i => i.code === 'HUMAN_REVIEW_REJECTED'));
  assert.equal(disputed.reviewsRevision, 2);
});

test('stale links can be removed explicitly without discarding retained coverage or its audit', async t => {
  const extra: EvalCase = { id: 'removed-case', input: 'Old task.', contains: ['grounded'], source: 'reviewed', split: 'holdout' };
  const f = await fixture(t, [extra]); await f.requirement(); await f.link();
  await linkRequirement(f.dir, 'REQ-GROUNDING', { caseId: extra.id, kind: 'judge', reviewer: 'owner', reason: 'An additional semantic check.' });
  await writeFile(join(f.dir, 'evals/cases.jsonl'), JSON.stringify(f.cases[0]) + '\n');
  assert.equal((await evidenceStatus(f.dir)).requirements[0].status, 'stale-link');
  await assert.rejects(unlinkRequirement(f.dir, 'REQ-GROUNDING', { caseId: extra.id, reviewer: 'owner', reason: '' }));
  await unlinkRequirement(f.dir, 'REQ-GROUNDING', { caseId: extra.id, reviewer: 'owner', reason: 'The obsolete case was removed from this dataset.' });
  assert.equal((await evidenceStatus(f.dir)).requirements[0].status, 'ready');
  const envelope = JSON.parse(await readFile(join(f.dir, '.instrilo/evidence/requirements.json'), 'utf8'));
  assert.equal(envelope.data.linkRemovals[0].caseId, extra.id);
  assert.equal(envelope.data.history.at(-1).links.length, 2);
  assert.equal(envelope.data.requirements[0].links.length, 1);
});

test('strict gates reject synthetic reports and links; exceptions are explicit', async t => {
  const extra: EvalCase = { id: 'synthetic-extra', input: 'Fixture only.', contains: ['grounded'], source: 'synthetic', split: 'holdout' };
  const f = await fixture(t, [extra]); await f.requirement(); await f.link();
  await assert.rejects(linkRequirement(f.dir, 'REQ-GROUNDING', { caseId: extra.id, kind: 'judge', reviewer: 'owner', reason: 'Trying to cover a requirement with generated data.' }), /human-reviewed/);
  const report = await f.report(); await registerEvidenceReport(f.dir, report);
  assert.ok((await releaseEvidence(f.dir, report.id)).issues.some(i => i.code === 'SYNTHETIC_EVIDENCE'));
  const permitted = await releaseEvidence(f.dir, report.id, { schemaVersion: '1', allowSynthetic: true });
  assert.equal(permitted.allowed, true); assert.ok(permitted.exceptions.some(e => /Synthetic/.test(e)));
});

test('waivers and demo evidence never silently satisfy a strict release policy', async t => {
  const f = await fixture(t); await f.requirement();
  await waiveRequirement(f.dir, 'REQ-GROUNDING', { reviewer: 'owner', reason: 'Temporary manual launch review is recorded separately.' });
  const report = await f.report(); await registerEvidenceReport(f.dir, report);
  assert.ok((await releaseEvidence(f.dir, report.id)).issues.some(i => i.code === 'WAIVER_DISALLOWED'));
  assert.equal((await releaseEvidence(f.dir, report.id, { schemaVersion: '1', allowWaived: true })).allowed, true);
  await assert.rejects(waiveRequirement(f.dir, 'REQ-GROUNDING', { reviewer: 'owner', reason: 'Already expired', expiresAt: '2020-01-01T00:00:00Z' }), /future/);
  f.spec.connections.fixture = { kind: 'demo', auth: { type: 'none' } }; await saveSpec(join(f.dir, manifestName), f.spec);
  const demo = await f.report({ mode: 'demo' }); await registerEvidenceReport(f.dir, demo);
  assert.ok((await releaseEvidence(f.dir, demo.id)).issues.some(i => i.code === 'DEMO_EVIDENCE'));
  const smoke = await releaseEvidence(f.dir, demo.id, { schemaVersion: '1', allowWaived: true, allowDemo: true });
  assert.equal(smoke.allowed, true); assert.equal(smoke.classification, 'smoke-only');
  const disguised = await f.report({ mode: 'live' }); await registerEvidenceReport(f.dir, disguised);
  assert.ok((await releaseEvidence(f.dir, disguised.id, { schemaVersion: '1', allowWaived: true })).issues.some(i => i.code === 'REPORT_MODE_MISMATCH'));
});

test('release independently checks output constraints and cannot replace deterministic coverage with a judge', async t => {
  const f = await fixture(t); await f.requirement(); await f.link();
  const report = await f.report(); report.results[0].output = 'Unsupported answer with the required word absent.';
  await registerEvidenceReport(f.dir, report);
  const failed = await releaseEvidence(f.dir, report.id);
  assert.equal(failed.allowed, false); assert.ok(failed.issues.some(i => i.code === 'LINKED_CASE_FAILED'));
  delete f.cases[0].contains; await writeFile(join(f.dir, 'evals/cases.jsonl'), JSON.stringify(f.cases[0]) + '\n');
  await linkRequirement(f.dir, 'REQ-GROUNDING', { caseId: f.cases[0].id, kind: 'judge', reviewer: 'owner', reason: 'Semantic judgment only.' });
  const judgeOnly = await f.report(); await registerEvidenceReport(f.dir, judgeOnly);
  assert.ok((await releaseEvidence(f.dir, judgeOnly.id)).issues.some(i => i.code === 'DETERMINISTIC_EVIDENCE_REQUIRED'));
});

test('changed report inputs, missing cases and legacy guidance fingerprints cannot pass release', async t => {
  const f = await fixture(t); await f.requirement(); await f.link();
  const report = await f.report(); await registerEvidenceReport(f.dir, report);
  f.spec.agent.systemPrompt = 'Changed after evaluation.'; await saveSpec(join(f.dir, manifestName), f.spec);
  assert.ok((await releaseEvidence(f.dir, report.id)).issues.some(i => i.code === 'REPORT_CONFIG_CHANGED'));
  const current = await f.report(); delete (current as { guidanceHash?: string }).guidanceHash; await registerEvidenceReport(f.dir, current);
  assert.ok((await releaseEvidence(f.dir, current.id)).issues.some(i => i.code === 'REPORT_GUIDANCE_CHANGED'));
  const legacy = await f.report(); delete legacy.judgeHash; delete legacy.results[0].caseHash; await registerEvidenceReport(f.dir, legacy);
  const unbound = await releaseEvidence(f.dir, legacy.id);
  assert.equal(unbound.allowed, false); assert.ok(unbound.issues.some(i => i.code === 'REPORT_REVIEW_BINDING_MISSING'));
  f.cases[0].input = 'Changed task after evaluation.'; await writeFile(join(f.dir, 'evals/cases.jsonl'), JSON.stringify(f.cases[0]) + '\n');
  const stale = await releaseEvidence(f.dir, report.id);
  assert.ok(stale.issues.some(i => i.code === 'REPORT_DATASET_CHANGED'));
  assert.ok(stale.issues.some(i => i.code === 'REPORT_CASE_CHANGED'));
});

test('uncovered requirements and missing linked cases cannot be accepted by a passing report', async t => {
  const development: EvalCase = { id: 'dev-only', input: 'Development task.', contains: ['grounded'], source: 'reviewed', split: 'development' };
  const f = await fixture(t, [development]);
  const report = await f.report(); report.results.pop(); report.total = report.passed = report.reviewed = 1; report.datasetHash = reportCompatibleHash([f.cases[0]]);
  await registerEvidenceReport(f.dir, report);
  assert.ok((await releaseEvidence(f.dir, report.id)).issues.some(i => i.code === 'NO_REQUIREMENTS'));
  await f.requirement();
  assert.ok((await releaseEvidence(f.dir, report.id)).issues.some(i => i.code === 'REQUIREMENT_NOT_READY'));
  await linkRequirement(f.dir, 'REQ-GROUNDING', { caseId: development.id, kind: 'deterministic', reviewer: 'owner', reason: 'This test exists only in development.' });
  assert.ok((await releaseEvidence(f.dir, report.id)).issues.some(i => i.code === 'LINKED_CASE_MISSING'));
});

test('policy documents reject unknown fields and non-boolean weakening flags', async t => {
  const f = await fixture(t);
  assert.throws(() => parseReleasePolicy({ schemaVersion: '1', allowDemo: 'false' }));
  assert.throws(() => parseReleasePolicy({ schemaVersion: '1', allowAll: true }));
  assert.throws(() => parseReleasePolicy({ allowDemo: true }));
  await importReleasePolicy(f.dir, { schemaVersion: '1', requireHumanReview: true });
  const envelope = JSON.parse(await readFile(join(f.dir, '.instrilo/evidence/release-policy.json'), 'utf8'));
  assert.equal(envelope.data.requireHumanReview, true);
});

test('requirements and reports detect alteration and refuse path or symlink escape', async t => {
  const f = await fixture(t); await f.requirement();
  const path = join(f.dir, '.instrilo/evidence/requirements.json');
  const envelope = JSON.parse(await readFile(path, 'utf8')); envelope.data.requirements[0].text = 'Tampered'; await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(listRequirements(f.dir), /checksum/);
  const report = await f.report(); await registerEvidenceReport(f.dir, report);
  const modified = structuredClone(report); modified.results[0].output = 'Altered output';
  await assert.rejects(registerEvidenceReport(f.dir, modified), /immutable|different report/);
  await assert.rejects(loadRegisteredReport(f.dir, '../outside.json'), /inside/);
  const outside = join(f.root, 'outside'); await mkdir(outside);
  const second = await createProject(f.root, { name: 'symlink-evidence' });
  await symlink(outside, join(second.dir, '.instrilo'));
  await assert.rejects(addRequirement(second.dir, { id: 'REQ-1', text: 'Do not escape.', sourcePath: 'purpose.md' }), /Symbolic/);
  await assert.rejects(readFile(join(outside, 'evidence/requirements.json')));
});
