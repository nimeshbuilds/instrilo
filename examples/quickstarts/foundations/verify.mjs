/** Read-only assertions for the first five public walkthroughs.
 * Usage: node verify.mjs CHECK PROJECT. Reads the CLI's saved JSON outputs;
 * never starts services, installs packages, changes files or calls a model.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const [check, project] = process.argv.slice(2);
if (!project) throw new Error('Usage: verify.mjs CHECK PROJECT');
const read = async name => JSON.parse(await readFile(join(project, name), 'utf8'));
const lookup = (result, event) => {
  assert.equal(result.output, 'Order ORD-1042 is shipped. Tracking: LOCAL-123.');
  assert.deepEqual(result.trace.map(item => item.event), [event, 'tool', event]);
  assert.equal(result.trace[1].name, 'lookup_order');
};
if (check === 'guidance') {
  assert.equal((await read('guidance-check.json')).missing.length, 0);
  console.log('All ten guidance sections are present.');
} else if (check === 'offline-typescript' || check === 'offline-python') {
  const result = await read('run.json');
  assert.equal(result.output, check === 'offline-typescript' ? '[DEMO ONLY] When can I return an item?' : '[DEMO ONLY] Explain the shop return policy.');
  assert.ok(result.trace.some(item => item.event === 'model'));
  console.log('Generated ' + (check === 'offline-typescript' ? 'TypeScript' : 'Python') + ' runtime verified in offline demo mode.');
} else if (check === 'builder') {
  assert.ok((await read('plan.json')).rationale.includes('Deterministic fixture'));
  console.log('Builder response parsed.');
} else if (check === 'runtime') {
  assert.ok((await read('run.json')).output.includes('30 days'));
  console.log('Runtime used the local gateway.');
} else if (check === 'evaluation') {
  const result = await read('evaluation.json');
  assert.equal(result.passed, 1); assert.equal(result.total, 1); assert.equal(result.results[0].judge.score, 1);
  console.log('Synthetic evaluation: one case passed; no model quality measured.');
} else if (check === 'roles') {
  assert.deepEqual((await read('roles.json')).roles, { builder: 'planning', runtime: 'answering', judge: 'scoring' });
  console.log('Builder, runtime and judge are independently assigned.');
} else if (check === 'role-requests') {
  const result = await read('fixture-stats.json');
  assert.equal(result.builder, 1); assert.equal(result.runtime, 2); assert.equal(result.judge, 1); assert.ok(result.token >= 1);
  console.log('All three roles and the OAuth token exchange were observed.');
} else if (check === 'native-tool' || check === 'native-baseline') {
  lookup(await read(check === 'native-tool' ? 'run.json' : 'native-run.json'), 'model');
  console.log('Observed native model → HTTP tool → model.');
} else if (check === 'tool-requests') {
  const result = await read('fixture-stats.json'); assert.equal(result.toolModel, 2); assert.equal(result.lookup, 1);
  console.log('Two model HTTP requests and one actual order lookup verified.');
} else if (check === 'graph-package') {
  assert.ok((await read('generated/package.json')).dependencies['@langchain/langgraph']);
  console.log('LangGraph is declared in the generated package.');
} else if (check === 'graph-run') {
  lookup(await read('langgraph-run.json'), 'langgraph.model');
  console.log('Actual LangGraph model → tool → model nodes verified.');
} else if (check === 'graph-requests') {
  const result = await read('fixture-stats.json'); assert.equal(result.lookup, 2); assert.equal(result.toolModel, 4);
  console.log('Both frameworks performed their own HTTP lookup.');
} else throw new Error('Unknown tutorial verification check: ' + check);
