import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSpec } from '../src/core.js';
import { evaluateProject, compareReports, saveReport } from '../src/execution.js';
import type { EvalCase } from '../src/types.js';

const cases: EvalCase[] = [{ id: 'ticket-one', input: 'Draft an answer.', expected: 'Ask for the ticket details.', contains: ['ticket'], excludes: ['sent email'], source: 'reviewed', split: 'holdout' }];
const runner = async () => ({ output: 'Please provide the ticket details.', durationMs: 1, trace: [{ kind: 'model', step: 1 }] });

test('evaluation calls the configured judge, preserves trajectories, and requires both judge and deterministic checks', async t => {
  let request: any; let score = 0.9;
  const server = http.createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; request = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score, rationale: 'Requests the missing details.' }) }, finish_reason: 'stop' }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const spec = defaultSpec('judge-test');
  spec.connections.live = { kind: 'gateway', model: 'test-fixture', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, auth: { type: 'none' } };
  spec.roles.runtime = spec.roles.judge = 'live';
  let report = await evaluateProject(spec, '.', cases, { split: 'holdout', runner });
  assert.equal(report.mode, 'live'); assert.equal(report.passed, 1); assert.equal(report.reviewed, 1);
  assert.deepEqual(report.results[0].trace, [{ kind: 'model', step: 1 }]);
  assert.equal(report.results[0].judge?.score, 0.9);
  assert.equal(JSON.parse(request.messages[1].content).reference, cases[0].expected);
  assert.match(report.datasetHash!, /^[a-f0-9]{64}$/); assert.match(report.judgeHash!, /^[a-f0-9]{64}$/);
  score = 0.1;
  report = await evaluateProject(spec, '.', cases, { split: 'holdout', runner });
  assert.equal(report.passed, 0);
  score = 0.9;
  report = await evaluateProject(spec, '.', cases, { split: 'holdout', runner: async () => ({ output: 'I sent email about the ticket.', durationMs: 1 }) });
  assert.equal(report.passed, 0, 'A judge cannot override a failed deterministic exclusion.');
});

test('failed runs and cancellation cannot become successful quality evidence', async () => {
  const spec = defaultSpec('failure-test');
  const report = await evaluateProject(spec, '.', cases, { runner: async () => { throw new Error('Unavailable provider'); } });
  assert.equal(report.passed, 0); assert.equal(report.results[0].error, 'Unavailable provider');
  await assert.rejects(evaluateProject(spec, '.', cases, { signal: AbortSignal.abort(), runner }), /cancelled/);
  await assert.rejects(evaluateProject(spec, '.', [], { runner }), /No cases/);
});

test('comparison matches case content and warns when references or judging criteria change', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nb-eval-comparison-')); t.after(() => rm(root, { recursive: true, force: true }));
  const spec = defaultSpec('compare-test');
  const a = await evaluateProject(spec, '.', cases, { runner });
  const b = await evaluateProject(spec, '.', cases, { runner: async () => ({ output: 'I sent email.', durationMs: 1 }) });
  const first = join(root, 'a.json'), second = join(root, 'b.json');
  await saveReport(first, a); await saveReport(second, b);
  let comparison = await compareReports(first, second);
  assert.deepEqual(comparison.regressions, ['ticket-one']); assert.equal(comparison.comparableCases, 1); assert.equal(comparison.warning, undefined);
  spec.evaluation.rubric = 'Changed requirements';
  const changed = await evaluateProject(spec, '.', [{ ...cases[0], expected: 'A different reference' }], { runner });
  await assert.rejects(() => saveReport(second, changed), /EEXIST/);
  const third = join(root, 'third.json'); await saveReport(third, changed); comparison = await compareReports(first, third);
  assert.equal(comparison.comparableCases, 0); assert.deepEqual(comparison.regressions, []);
  assert.match(comparison.warning!, /Dataset content differs/); assert.match(comparison.warning!, /Judge, rubric or threshold differs/);
});
