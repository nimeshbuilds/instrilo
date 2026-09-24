/** Real Docker smoke, separate from unit tests. Uses an already running local engine.
 * Run: node --import tsx tests/deployment-container-smoke.mjs --execute
 * Builds generated TypeScript/Python native images, invokes local HTTP/JWT/model
 * fixtures and verifies cleanup. Downloads public images/dependencies; no cloud
 * services, real provider credentials or paid model calls are used.
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultSpec } from '../src/core.ts';
import { createProject, buildProject, manifestName } from '../src/workbench.ts';
import { deploymentTest } from '../src/deployment-testing.ts';

if (process.argv.slice(2).join(' ') !== '--execute') {
  console.log('Review this script, start your local Docker engine, then pass --execute to build and run two isolated generated containers. Public image and dependency downloads may occur. Reports are retained in a temporary workspace; exact run-owned container resources are removed automatically.');
  process.exit(0);
}
const root = await mkdtemp(join(tmpdir(), 'instrilo-real-containers-'));
console.log('Retained smoke workspace: ' + root);
let checks = 0;
for (const language of ['typescript', 'python']) {
  const spec = defaultSpec('container-' + language);
  spec.language = language;
  spec.framework = 'native';
  spec.delivery.target = 'docker';
  spec.connections.demo = { kind: 'gateway', model: 'mock', baseUrl: 'https://unused.example/v1', auth: { type: 'api-key', env: 'INSTRILO_SMOKE_UNUSED_KEY' } };
  spec.security = {
    inbound: { mode: 'jwt', issuer: 'https://unused.example', audience: 'test', jwksUrl: 'https://unused.example/jwks', algorithms: ['RS256'] },
    requiredScopes: ['test:invoke'],
  };
  const { dir } = await createProject(root, { name: spec.name, spec });
  await buildProject(join(dir, manifestName));
  const report = await deploymentTest(dir, { engine: 'docker', execute: true, onProgress: message => console.log(language + ': ' + message) });
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.status, 'passed', language + ' real container checks failed; inspect the retained report above.');
  assert.equal(report.cleanup.complete, true, 'Every run-owned resource must be removed.');
  assert.ok(report.resources.length > 0 && report.resources.every(resource => resource.removed));
  assert.ok(report.checks.every(check => check.passed));
  checks += report.checks.length;
}
console.log(`${checks} real Docker checkpoints passed across TypeScript and Python native agents. Cloud deployment and other frameworks/architectures are not verified by this smoke.`);
