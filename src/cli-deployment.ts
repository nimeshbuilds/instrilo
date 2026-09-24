import { Command } from 'commander';
import { join } from 'node:path';
import { withCliCancellation } from './cli-runtime.js';
import { projectSpec, readTextDocument } from './project-ops.js';
import { deploymentPlatform } from './deployment-platforms.js';
import { deploymentTest, deploymentTestReports, deploymentTestCleanup } from './deployment-testing.js';
import { containerEngineStatus, containerEngineInstallPlan, installContainerEngine, containerEngineStartPlan, startContainerEngine, containerEngineCleanupPlan, cleanupContainerEngine } from './container-engines.js';

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
export function engineId(value: string): 'docker' | 'podman' { if (value !== 'docker' && value !== 'podman') throw new Error('Choose docker or podman.'); return value; }
const progress = (message: string) => console.error(message);
export function registerDeploymentCommands(program: Command) {
  const deployment = program.command('deployment').description('Inspect platform requirements, test generated containers with mocks, retain evidence and clean owned resources.');
  deployment.command('platforms').description('List verified platform contracts, architecture, prerequisites and official references.').action(() => print(['local','docker','aws-agentcore','cloud-run','azure-container-apps'].map(target => deploymentPlatform(target as any))));
  deployment.command('guide [project]').description('Read the generated platform-specific prerequisite and deployment guide. Build first.').action(async (project = '.') => { const { root } = await projectSpec(project); console.log(await readTextDocument(join(root, 'generated/DEPLOYMENT.md'))); });
  deployment.command('prerequisites [project]').description('Inspect the selected platform contract and local container engine without changing the machine.')
    .option('--engine <engine>', 'docker or podman', 'docker').action(async (project = '.', options: { engine: string }) => { const { spec } = await projectSpec(project); print({ platform: deploymentPlatform(spec.delivery.target), engine: await withCliCancellation(signal => containerEngineStatus(engineId(options.engine), { signal })) }); });
  deployment.command('test [project]').description('Preview or execute isolated local container contract tests with mocked model/identity/services; no cloud deployment.')
    .option('--engine <engine>', 'docker or podman', 'docker').option('--execute', 'build and run the reviewed local test; may download public images/dependencies')
    .option('--keep', 'retain run-owned resources for inspection; otherwise clean them after testing')
    .action(async (project = '.', options: { engine: string; execute?: boolean; keep?: boolean }) => {
      const result = await withCliCancellation(signal => deploymentTest(project, { engine: engineId(options.engine), execute: options.execute === true, keep: options.keep === true, signal, onProgress: progress }));
      print(result); if (result.kind === 'deployment-test-report' && (result.status === 'failed' || result.status === 'cancelled')) process.exitCode = 1;
    });
  deployment.command('reports [project]').description('Read retained deployment test evidence, including mocks, actual checks and unverified cloud dependencies.').action(async (project = '.') => print(await deploymentTestReports(project)));
  deployment.command('cleanup <run-id> [project]').description('Preview or remove only exact resources owned by a recorded deployment test; preserve its report.')
    .option('--execute', 'apply the reviewed cleanup after verifying recorded IDs and ownership labels')
    .action(async (id: string, project = '.', options: { execute?: boolean }) => { const result = await withCliCancellation(signal => deploymentTestCleanup(project, id, { execute: options.execute === true, signal })); print(result); if ('complete' in result && !result.complete) process.exitCode = 1; });
  const engine = deployment.command('engine').description('Check Docker/Podman, review installation/startup, or clean up dependencies Instrilo owns.');
  engine.command('status [engine]').description('Check one or both official container clients and server readiness without starting anything.').action(async (input?: string) => print(await withCliCancellation(async signal => input ? containerEngineStatus(engineId(input), { signal }) : Promise.all(['docker','podman'].map(id => containerEngineStatus(engineId(id), { signal }))))));
  for (const [name, description, plan, execute] of [
    ['install', 'Review platform-specific prerequisites and install a supported official runtime with explicit consent.', containerEngineInstallPlan, installContainerEngine],
    ['start', 'Review and start supported runtime dependencies; owned Podman machines are separate from existing machines.', containerEngineStartPlan, startContainerEngine],
    ['cleanup', 'Review removal of dependencies Instrilo owns; pre-existing or shared dependencies are preserved.', containerEngineCleanupPlan, cleanupContainerEngine],
  ] as const) {
    const command = engine.command(name + ' <engine>').description(description).option('--execute', 'consent to the reviewed supported operation; otherwise print its plan');
    if (name === 'cleanup') command.option('--remove-machine-data', 'include the entire disk of the exact Instrilo-owned Podman VM after reviewing its storage inventory');
    command.action(async (input: string, options: { execute?: boolean; removeMachineData?: boolean }) => {
      const id = engineId(input), reviewed = name === 'cleanup' ? await containerEngineCleanupPlan(id, { removeMachineData: options.removeMachineData === true }) : await plan(id);
      if (!options.execute) return print(reviewed);
      console.error(JSON.stringify(reviewed, null, 2));
      print(await withCliCancellation<unknown>(signal => execute(id, { consent: true, signal, onProgress: progress, ...(name === 'cleanup' ? { removeMachineData: options.removeMachineData === true } : {}) })));
    });
  }
}
