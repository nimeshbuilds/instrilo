// Read-only assertions for the documented CLI walkthrough, not an agent builder.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [check, project] = process.argv.slice(2);
if (!project) throw new Error('Use verify.mjs CHECK PROJECT.');
const root = resolve(project), text = file => readFile(join(root, file), 'utf8'), json = async file => JSON.parse(await text(file));
if (check === 'architecture') {
  const spec = await json('config.json');
  assert.equal(spec.framework, 'langgraph'); assert.equal(spec.language, 'typescript');
  assert.deepEqual(spec.roles, { builder: 'planning', runtime: 'answering', judge: 'scoring' });
  assert.equal(new Set(Object.values(spec.roles).map(role => spec.connections[role].model)).size, 3);
  assert.equal(spec.agent.limits.maxSteps, 6); assert.equal(spec.agent.tools[0].name, 'lookup_policy');
  assert.equal(spec.agent.tools[0].method, 'GET'); assert.ok(!spec.agent.systemPrompt.includes('UNDECIDED'));
  assert.ok((await text('generated/agent.ts')).includes('StateGraph'));
  assert.ok((await text('guidance/architecture.md')).includes('LangGraph'));
  const generated = await json('generated/agent-spec.json');
  assert.deepEqual(Object.keys(generated.connections), ['runtime']);
  console.log('Actual TypeScript LangGraph, bounded read-only tool and three separate roles verified.');
} else if (check === 'run') {
  const run = await json('recorded-run.json'), graph = await json('run-graph.json');
  assert.equal(run.status, 'completed'); assert.equal(run.framework, 'langgraph');
  assert.match(run.output, /30 days.*RET-30/);
  assert.deepEqual(run.events.map(event => event.kind), ['model', 'tool', 'model']);
  assert.equal(run.events[1].name, 'lookup_policy');
  assert.deepEqual(graph.nodes.map(node => node.kind), ['start', 'model', 'tool', 'model', 'end']);
  assert.equal(graph.edges.length, 4); assert.ok((await text('run-graph.mmd')).startsWith('flowchart TD'));
  console.log('Recorded model → policy tool → model trajectory and both graph formats verified.');
} else if (check === 'evidence') {
  for (const split of ['development', 'holdout']) {
    const report = await json(`reports/${split}.json`);
    assert.equal(report.total, 1); assert.equal(report.passed, 1); assert.equal(report.synthetic, 1);
    assert.equal(report.reviewed, 0); assert.equal(report.results[0].judge.score, 1);
  }
  const release = await json('release-decision.json'); assert.equal(release.allowed, false);
  assert.ok(release.issues.some(issue => issue.code === 'SYNTHETIC_EVIDENCE'));
  assert.ok(release.issues.some(issue => issue.code === 'REQUIREMENT_NOT_READY'));
  assert.equal(release.policy.requireHumanReview, true); assert.equal(release.policy.allowSynthetic, false);
  const requirements = await json('requirements-status.json'); assert.equal(requirements.counts.proposed, 2);
  assert.equal(await text('policy-before.json'), await text('policy-after.json'));
  const stats = await json('fixture-stats.json'); assert.deepEqual(stats, { builder: 2, runtime: 6, judge: 2, policy: 3 });
  console.log('Both synthetic splits exercised the separate judge; strict production gate correctly blocked them.');
} else if (check === 'replay') {
  const replay = await json('replay.json'); assert.equal(replay.matched, true); assert.equal(replay.modelCalls, 0); assert.equal(replay.toolCalls, 0);
  console.log('Recorded LangGraph run replayed after the fixture stopped, without live model/tool calls.');
} else if (check === 'cloud') {
  const spec = await json('generated/agent-spec.json'), plan = await json('generated/deployment-plan.json');
  const target = spec.delivery.target;
  assert.ok(['aws-agentcore', 'cloud-run', 'azure-container-apps'].includes(target));
  assert.equal(plan.target, target); assert.equal(plan.status, 'generated-not-deployed'); assert.equal(plan.port, 8080);
  assert.equal(plan.architecture, target === 'aws-agentcore' ? 'linux/arm64' : 'linux/amd64');
  assert.equal(spec.security.inbound.mode, 'jwt'); assert.deepEqual(spec.security.requiredScopes, ['agent:invoke']);
  assert.equal(spec.security.inbound.issuer, 'https://identity.example.invalid/');
  assert.equal(spec.connections.runtime.auth.env, 'RUNTIME_GATEWAY_TOKEN');
  assert.equal(spec.agent.tools[0].authEnv, 'POLICY_SERVICE_TOKEN');
  assert.ok(!JSON.stringify(spec).includes('127.0.0.1')); assert.ok(!JSON.stringify(spec).includes('production-fixture'));
  assert.deepEqual(plan.secretEnvironmentNames.sort(), ['POLICY_SERVICE_TOKEN', 'RUNTIME_GATEWAY_TOKEN']);
  const script = { 'aws-agentcore': 'aws-agentcore.sh', 'cloud-run': 'cloud-run.sh', 'azure-container-apps': 'azure.sh' }[target];
  assert.ok((await text('generated/deploy/' + script)).includes(plan.architecture));
  for (const file of ['Dockerfile', 'DEPLOYMENT.md', 'SECURITY.md', 'agent.ts', 'server.ts', 'package.json']) await access(join(root, 'generated', file));
  assert.ok((await text('generated/DEPLOYMENT.md')).includes('prerequisite'));
  const preview = await json('container-test-plan.json'); assert.equal(preview.execute, false); assert.equal(preview.architecture, plan.architecture);
  if (target === 'aws-agentcore') {
    const config = await json('generated/deploy/aws-runtime.json');
    assert.deepEqual(config.authorizerConfiguration.customJWTAuthorizer.allowedAudience, ['support-agent']);
    assert.deepEqual(config.requestHeaderConfiguration.requestHeaderAllowlist, ['Authorization']);
    assert.equal(config.environmentVariables.PORT, '8080');
  } else if (target === 'cloud-run') {
    assert.ok((await text('generated/deploy/cloud-run.sh')).includes('--no-allow-unauthenticated'));
    assert.ok((await json('generated/deploy/gcp-secrets.json')).RUNTIME_GATEWAY_TOKEN);
  } else {
    const config = await json('generated/deploy/azure-container-app.json');
    assert.equal(config.properties.configuration.ingress.targetPort, 8080);
    assert.equal(config.identity.type, 'UserAssigned');
  }
  const zip = await readFile(join(root, 'deployment-bundle.zip')); assert.equal(zip.subarray(0, 2).toString(), 'PK'); assert.ok(zip.length > 1000);
  console.log(`${target}: platform architecture, JWT, secret references, generated runbook, test preview and source ZIP verified.`);
} else throw new Error('Unknown check ' + check);
