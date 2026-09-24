// Assertions used by the published walkthroughs. These only read tutorial files.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [check, project] = process.argv.slice(2);
if (!project) throw new Error('Usage: node verify.mjs CHECK PROJECT');
const root = resolve(project);
const text = file => readFile(join(root, file), 'utf8');
const json = async file => JSON.parse(await text(file));
switch (check) {
  case 'install-plans':
    for (const [provider, pkg] of [['codex', '@openai/codex'], ['claude', '@anthropic-ai/claude-code'], ['grok', '@xai-official/grok']]) {
      assert.ok((await text(`${provider}-plan.json`)).includes(pkg), 'Plan must name the expected official package.');
      console.log(`${provider}: ${pkg} plan ready`);
    }
    break;
  case 'baseline': {
    const report = await json('reports/baseline.json');
    assert.equal(report.total, 2); assert.equal(report.passed, 2);
    assert.ok(report.results.every(result => result.judge?.score === 1));
    console.log('2/2 cases passed with a separate fixture judge.');
    break;
  }
  case 'comparison': {
    const report = await json('comparison.json');
    assert.equal(report.comparableCases, 2); assert.equal(report.passRateDelta, -1);
    assert.deepEqual(report.regressions, ['billing-escalation', 'ticket-reference']);
    console.log(report); break;
  }
  case 'eval-counts': {
    const counts = await json('fixture-counts.json');
    assert.equal(counts.runtime, 4); assert.equal(counts.judge, 4);
    console.log(counts); break;
  }
  case 'blocked-release': {
    const report = await json('release-decision.json');
    assert.equal(report.allowed, false);
    for (const code of ['DEMO_EVIDENCE', 'SYNTHETIC_EVIDENCE', 'NO_REQUIREMENTS']) assert.ok(report.issues.some(issue => issue.code === code));
    assert.equal(await text('policy-before.json'), await text('policy-after.json'), 'Policy must remain unchanged.');
    console.log(report.issues); break;
  }
  case 'approval-pause': {
    const report = await json('pending.json'), counts = await json('before-counts.json');
    assert.equal(report.status, 'paused'); assert.equal(report.pending.length, 1);
    assert.equal(report.pending[0].name, 'update'); assert.equal(counts.reads, 1); assert.equal(counts.writes, 0);
    console.log(report.pending); break;
  }
  case 'approved-run': {
    const report = await json('completed.json'), counts = await json('after-counts.json');
    assert.equal(report.status, 'completed'); assert.equal(counts.reads, 1);
    assert.equal(counts.writes, 1); assert.equal(counts.runtime, 2);
    console.log(report.output, counts); break;
  }
  case 'offline-replay': {
    const report = await json('replay.json');
    assert.equal(report.matched, true); assert.equal(report.modelCalls, 0); assert.equal(report.toolCalls, 0);
    console.log(report); break;
  }
  case 'platform-artifacts': {
    const platforms = await json('platforms.json'), aws = platforms.find(item => item.target === 'aws-agentcore');
    assert.equal(aws.architecture, 'linux/arm64'); assert.equal(aws.port, 8080);
    for (const target of ['cloud-run', 'azure-container-apps']) assert.equal(platforms.find(item => item.target === target).architecture, 'linux/amd64');
    assert.ok((await text('generated/deploy/aws-agentcore.sh')).includes('linux/arm64'));
    for (const file of ['Dockerfile', 'DEPLOYMENT.md', 'deployment-plan.json', 'deploy/aws-runtime.json']) await access(join(root, 'generated', file));
    console.log('AgentCore ARM64 artifacts and all three cloud contracts verified.'); break;
  }
  case 'container-plan': {
    const plan = await json('container-test-plan.json');
    assert.equal(plan.kind, 'deployment-test-plan'); assert.equal(plan.execute, false); assert.equal(plan.architecture, 'linux/arm64');
    console.log(plan); break;
  }
  default: throw new Error(`Unknown walkthrough check: ${check}`);
}
