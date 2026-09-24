import { projectSpec, readTextDocument } from './project-ops.js';
import { join } from 'node:path';
import { deploymentPlatform } from './deployment-platforms.js';
import { deploymentTest, deploymentTestReports, deploymentTestCleanup } from './deployment-testing.js';
import { containerEngineStatus, containerEngineInstallPlan, installContainerEngine, containerEngineStartPlan, startContainerEngine, containerEngineCleanupPlan, cleanupContainerEngine } from './container-engines.js';

type Start = (kind: string, run: (signal: AbortSignal, progress: (message: string) => void) => Promise<unknown>) => { jobId: string };
const engineId = (value: unknown): 'docker' | 'podman' => { if (value !== 'docker' && value !== 'podman') throw new Error('Choose docker or podman.'); return value; };
function options(body: any, keys: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw new Error('Unsupported deployment options.');
  for (const key of ['execute','keep','consent','removeMachineData']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new Error(key + ' must be a boolean.');
}
export async function engineRequest(action: string, method: string, body: any, start: Start, query = new URLSearchParams()) {
  if (!action && method === 'GET') return { result: await Promise.all(['docker','podman'].map(async input => { const engine = engineId(input); return { status: await containerEngineStatus(engine), install: await containerEngineInstallPlan(engine), start: await containerEngineStartPlan(engine), cleanup: await containerEngineCleanupPlan(engine) }; })) };
  const match = action.match(/^(docker|podman)(?:\/(install|start|cleanup))?$/);
  if (!match) throw new Error('Unknown container engine operation.');
  const engine = engineId(match[1]), operation = match[2];
  if (method === 'GET') return { result: operation === 'install' ? await containerEngineInstallPlan(engine) : operation === 'start' ? await containerEngineStartPlan(engine) : operation === 'cleanup' ? await containerEngineCleanupPlan(engine, { removeMachineData: query.get('removeMachineData') === 'true' }) : await containerEngineStatus(engine) };
  if (method !== 'POST' || !operation) return { result: { error: 'Method not allowed.' }, status: 405 };
  options(body, operation === 'cleanup' ? ['consent','removeMachineData'] : ['consent']); if (body.consent !== true) throw new Error('Review the engine plan and explicitly consent before continuing.');
  const run = operation === 'install' ? installContainerEngine : operation === 'start' ? startContainerEngine : cleanupContainerEngine;
  return { result: start('engine-' + engine + '-' + operation, (signal, onProgress) => run(engine, { consent: true, signal, onProgress, ...(operation === 'cleanup' ? { removeMachineData: body.removeMachineData === true } : {}) })), status: 202 };
}
export async function deploymentRequest(project: string, action: string, method: string, query: URLSearchParams, body: any, start: Start) {
  if (action === 'prerequisites' && method === 'GET') { const { spec } = await projectSpec(project); return { result: { platform: deploymentPlatform(spec.delivery.target), engine: await containerEngineStatus(engineId(query.get('engine') || 'docker')) } }; }
  if (action === 'guide' && method === 'GET') { const { root } = await projectSpec(project); return { result: { content: await readTextDocument(join(root, 'generated/DEPLOYMENT.md')) } }; }
  if (action === 'reports' && method === 'GET') return { result: await deploymentTestReports(project) };
  if (action === 'test' && method === 'GET') return { result: await deploymentTest(project, { engine: engineId(query.get('engine') || 'docker') }) };
  if (action === 'test' && method === 'POST') {
    options(body, ['engine','execute','keep']); if (body.execute !== true) throw new Error('Review the local test plan and explicitly request execution.');
    const engine = engineId(body.engine || 'docker');
    return { result: start('deployment-test', (signal, onProgress) => deploymentTest(project, { engine, execute: true, keep: body.keep === true, signal, onProgress })), status: 202 };
  }
  const cleanup = action.match(/^cleanup\/([a-zA-Z0-9-]+)$/);
  if (cleanup && method === 'GET') return { result: await deploymentTestCleanup(project, cleanup[1], {}) };
  if (cleanup && method === 'POST') {
    options(body, ['execute']); if (body.execute !== true) throw new Error('Review the cleanup plan and explicitly request execution.');
    return { result: start('deployment-cleanup', signal => deploymentTestCleanup(project, cleanup[1], { execute: true, signal })), status: 202 };
  }
  return { result: { error: 'Deployment endpoint or method not found.' }, status: 404 };
}
