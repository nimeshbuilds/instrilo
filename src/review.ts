import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalEvidence, evidenceHash, loadRegisteredReport, readEvidenceDocument, reportFreshness, withEvidenceLock, writeEvidenceDocument } from './evidence.js';
import type { RegisteredReport } from './evidence.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const reviewer = z.string().trim().min(1).max(500);
const reason = z.string().trim().min(1).max(10_000);
const bindingSchema = z.object({ reportId: identifier, reportHash: digest, caseId: identifier, caseHash: digest, outputHash: digest, judgeHash: digest }).strict();
export type ReviewBinding = z.infer<typeof bindingSchema>;
const labelSchema = z.object({ schemaVersion: z.literal('1'), id: identifier, binding: bindingSchema, verdict: z.enum(['pass', 'fail', 'abstain']), reviewer, reason, createdAt: z.string().datetime({ offset: true }), supersedes: identifier.optional(), checksum: digest }).strict();
export type ReviewLabel = z.infer<typeof labelSchema>;
const storeSchema = z.object({ schemaVersion: z.literal('1'), revision: z.number().int().nonnegative(), labels: z.array(labelSchema).max(20_000) }).strict();
const exportSchema = z.object({ schemaVersion: z.literal('1'), labels: z.array(labelSchema).max(20_000) }).strict();

function labelDigest(label: Omit<ReviewLabel, 'checksum'> | ReviewLabel) { const { checksum: _checksum, ...fields } = label as ReviewLabel; return evidenceHash(fields); }
async function state(projectDir: string) {
  const parsed = storeSchema.parse(await readEvidenceDocument(projectDir, 'reviews.json') ?? { schemaVersion: '1', revision: 0, labels: [] });
  if (new Set(parsed.labels.map(label => label.id)).size !== parsed.labels.length || parsed.labels.some(label => label.checksum !== labelDigest(label))) throw new Error('Review history was altered or contains duplicate identifiers.');
  const history: ReviewLabel[] = [];
  for (const label of parsed.labels) { validateAppend(history, label); history.push(label); }
  return parsed;
}
function bindingFor(registered: RegisteredReport, caseId: string): ReviewBinding {
  const item = registered.report.results.find(item => item.id === caseId);
  if (!item) throw new Error(`Case ${caseId} does not occur in this report.`);
  if (!item.caseHash || !registered.report.judgeHash) throw new Error('This report lacks case/judge fingerprints. Re-evaluate before collecting bound reviews.');
  return { reportId: registered.report.id, reportHash: registered.reportHash, caseId, caseHash: item.caseHash, outputHash: evidenceHash(item.output), judgeHash: registered.report.judgeHash };
}
function activeLabels(labels: ReviewLabel[]): ReviewLabel[] { const replaced = new Set(labels.map(label => label.supersedes).filter(Boolean)); return labels.filter(label => !replaced.has(label.id)); }
function sameReviewer(a: string, b: string) { return a.normalize('NFKC').toLocaleLowerCase('en-US') === b.normalize('NFKC').toLocaleLowerCase('en-US'); }
function validateAppend(labels: ReviewLabel[], label: ReviewLabel) {
  const prior = activeLabels(labels).find(item => sameReviewer(item.reviewer, label.reviewer) && evidenceHash(item.binding) === evidenceHash(label.binding));
  if (label.supersedes) {
    if (!prior || prior.id !== label.supersedes) throw new Error('A correction must supersede the same reviewer’s current label for this exact evidence.');
  } else if (prior) throw new Error('This reviewer already labeled this exact case/output. Add an explicit correction with supersedes; original labels are immutable.');
  if (label.checksum !== labelDigest(label)) throw new Error('Imported review checksum mismatch.');
  if (Date.parse(label.createdAt) > Date.now() + 60_000) throw new Error('Review dates cannot be in the future.');
}

export async function addReview(projectDir: string, input: { reportId: string; caseId: string; verdict: ReviewLabel['verdict']; reviewer: string; reason: string; supersedes?: string; binding?: ReviewBinding }): Promise<ReviewLabel> {
  const parsed = z.object({ reportId: identifier, caseId: identifier, verdict: z.enum(['pass', 'fail', 'abstain']), reviewer, reason, supersedes: identifier.optional(), binding: bindingSchema.optional() }).strict().parse(input);
  const registered = await loadRegisteredReport(projectDir, parsed.reportId), binding = bindingFor(registered, parsed.caseId);
  if (parsed.binding && canonicalEvidence(parsed.binding) !== canonicalEvidence(binding)) throw new Error('The reviewed evidence changed. Reload the queue instead of labeling a different output.');
  return withEvidenceLock(projectDir, async () => {
    const stored = await state(projectDir);
    const base = { schemaVersion: '1' as const, id: randomUUID(), binding, verdict: parsed.verdict, reviewer: parsed.reviewer, reason: parsed.reason, createdAt: new Date().toISOString(), ...(parsed.supersedes ? { supersedes: parsed.supersedes } : {}) };
    const label = labelSchema.parse({ ...base, checksum: labelDigest(base) });
    validateAppend(stored.labels, label); stored.labels.push(label); stored.revision++;
    await writeEvidenceDocument(projectDir, 'reviews.json', storeSchema.parse(stored)); return label;
  });
}
export async function importReviews(projectDir: string, input: unknown): Promise<{ imported: number; existing: number }> {
  const imported = exportSchema.parse(input);
  const reports = new Map<string, RegisteredReport>();
  for (const label of imported.labels) {
    if (!reports.has(label.binding.reportId)) reports.set(label.binding.reportId, await loadRegisteredReport(projectDir, label.binding.reportId));
    const binding = bindingFor(reports.get(label.binding.reportId)!, label.binding.caseId);
    if (canonicalEvidence(binding) !== canonicalEvidence(label.binding)) throw new Error('Imported label does not match the immutable report/case/output/judge snapshot.');
  }
  return withEvidenceLock(projectDir, async () => {
    const stored = await state(projectDir); let added = 0, existing = 0;
    for (const label of imported.labels) {
      const prior = stored.labels.find(l => l.id === label.id);
      if (prior) { if (canonicalEvidence(prior) !== canonicalEvidence(label)) throw new Error('An immutable label ID was reused with different contents.'); existing++; continue; }
      validateAppend(stored.labels, label); stored.labels.push(label); added++;
    }
    if (added) { stored.revision++; await writeEvidenceDocument(projectDir, 'reviews.json', storeSchema.parse(stored)); }
    return { imported: added, existing };
  });
}
export async function exportReviews(projectDir: string): Promise<{ schemaVersion: '1'; labels: ReviewLabel[] }> { return { schemaVersion: '1', labels: (await state(projectDir)).labels }; }
export async function reviewEvidenceRevision(projectDir: string): Promise<number> { return (await state(projectDir)).revision; }

export async function reviewAssessments(projectDir: string, idOrPath: string) {
  const registered = await loadRegisteredReport(projectDir, idOrPath), stored = await state(projectDir);
  const active = activeLabels(stored.labels);
  const cases = registered.report.results.map(item => {
    const binding = bindingFor(registered, item.id), labels = active.filter(label => canonicalEvidence(label.binding) === canonicalEvidence(binding));
    const substantive = labels.filter(label => label.verdict !== 'abstain');
    const decisions = new Set(substantive.map(label => label.verdict));
    const status = decisions.size > 1 ? 'disagreement' : substantive.length ? 'agreed' : labels.length ? 'abstained' : 'unreviewed';
    const verdict = decisions.size === 1 ? substantive[0].verdict as 'pass' | 'fail' : null;
    return { caseId: item.id, binding, status, verdict, reviewers: substantive.length, abstentions: labels.length - substantive.length, labels };
  });
  return { schemaVersion: '1' as const, reportId: registered.report.id, reportHash: registered.reportHash, revision: stored.revision, cases };
}
export async function reviewQueue(projectDir: string, idOrPath: string, options: { blind?: boolean } = {}) {
  const registered = await loadRegisteredReport(projectDir, idOrPath), assessments = await reviewAssessments(projectDir, registered.report.id), freshness = await reportFreshness(projectDir, registered);
  const blind = options.blind !== false;
  return {
    schemaVersion: '1' as const, reportId: registered.report.id, reportHash: registered.reportHash, blind, current: freshness.current, issues: freshness.issues,
    cases: registered.report.results.map(item => {
      const assessment = assessments.cases.find(c => c.caseId === item.id)!;
      const original = registered.cases.find(c => c.id === item.id);
      return { binding: assessment.binding, input: item.input, output: item.output, reference: original?.expected ?? null, source: original?.source ?? 'unknown', split: original?.split ?? 'unknown', priorReviewCount: assessment.labels.length, ...(item.error ? { executionError: item.error } : {}),
        ...(!blind ? { automated: { passed: item.passed, checks: item.checks, judge: item.judge ?? null }, human: assessment } : {}) };
    }),
    note: blind ? 'Judge scores, checks and prior human verdicts are omitted from this response. Binding fingerprints remain opaque identifiers.' : 'Unblinded review includes automated and human judgments.',
  };
}
export async function calibrationReport(projectDir: string, idOrPath: string) {
  const registered = await loadRegisteredReport(projectDir, idOrPath), assessments = await reviewAssessments(projectDir, registered.report.id), freshness = await reportFreshness(projectDir, registered);
  let agreedPass = 0, agreedFail = 0, falsePass = 0, falseFail = 0, unscored = 0;
  const items = assessments.cases.map(item => {
    const result = registered.report.results.find(result => result.id === item.caseId)!;
    // Use the recorded decision of the old rubric, not today's possibly changed threshold.
    const judgeCheck = result.checks.filter(check => check.name === 'Judge rubric');
    const usable = !!result.judge && judgeCheck.length === 1 && registered.report.mode === 'live' && !result.error;
    const judgeVerdict = usable ? (judgeCheck[0].passed ? 'pass' : 'fail') : null;
    if (item.verdict && judgeVerdict) {
      if (item.verdict === 'pass' && judgeVerdict === 'pass') agreedPass++;
      else if (item.verdict === 'fail' && judgeVerdict === 'fail') agreedFail++;
      else if (item.verdict === 'fail') falsePass++;
      else falseFail++;
    } else if (item.verdict) unscored++;
    return { caseId: item.caseId, human: item.verdict, judge: judgeVerdict, status: item.status, reviewers: item.reviewers, abstentions: item.abstentions };
  });
  const sampleCount = agreedPass + agreedFail + falsePass + falseFail;
  return {
    schemaVersion: '1' as const, reportId: registered.report.id, reportHash: registered.reportHash, judgeHash: registered.report.judgeHash, reviewsRevision: assessments.revision,
    current: freshness.current, usableForCurrentRelease: freshness.current && registered.report.mode === 'live', issues: freshness.issues,
    totalCases: registered.report.total, sampleCount, agreementRate: sampleCount ? (agreedPass + agreedFail) / sampleCount : null,
    confusion: { agreedPass, agreedFail, falsePass, falseFail }, unscored,
    unresolvedDisagreements: items.filter(item => item.status === 'disagreement').length, unreviewed: items.filter(item => item.status === 'unreviewed').length, abstained: items.filter(item => item.status === 'abstained').length,
    cases: items,
    limitations: ['Descriptive agreement on this labeled sample is not a reliability estimate for unseen tasks.', 'Reviewer identities are local operator assertions; corrections append history and do not erase prior labels.', 'Disagreements, abstentions, missing judges and demo reports are excluded from agreement counts.'],
  };
}
