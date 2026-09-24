import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = dirname(dirname(fileURLToPath(import.meta.url)));
export async function loadScenarios({ complete = true } = {}) {
  const directory = join(repository, 'website/scenarios');
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  const scenarios = await Promise.all(files.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
  if (complete && scenarios.length !== 10) throw new Error('Publish exactly ten complete walkthroughs.');
  const ids = new Set(), orders = new Set();
  for (const scenario of scenarios) {
    if (!/^[a-z][a-z0-9-]+$/.test(scenario.id) || ids.has(scenario.id)) throw new Error('Invalid or duplicate scenario ID.');
    ids.add(scenario.id);
    if (!Number.isInteger(scenario.order) || scenario.order < 1 || scenario.order > 10 || orders.has(scenario.order)) throw new Error('Invalid or duplicate scenario order.');
    orders.add(scenario.order);
    for (const key of ['title', 'summary', 'category', 'duration', 'outcome']) if (typeof scenario[key] !== 'string' || !scenario[key].trim()) throw new Error(`${scenario.id}: missing ${key}.`);
    if (!Array.isArray(scenario.prerequisites) || !scenario.prerequisites.every(value => typeof value === 'string')) throw new Error(`${scenario.id}: prerequisites must be strings.`);
    if (typeof scenario.verification?.scope !== 'string' || !Array.isArray(scenario.verification?.limitations)) throw new Error(`${scenario.id}: verification scope and limitations are required.`);
    if (!Array.isArray(scenario.steps) || !scenario.steps.length || !scenario.steps.some(step => step.code)) throw new Error(`${scenario.id}: executable steps are required.`);
    for (const step of scenario.steps) {
      for (const key of ['title', 'body', 'expected']) if (typeof step[key] !== 'string' || !step[key].trim()) throw new Error(`${scenario.id}: every step needs ${key}.`);
      if (step.code && step.manualCode) throw new Error(`${scenario.id}: separate tested commands from manual account steps.`);
      for (const key of ['code', 'manualCode']) if (step[key] !== undefined && (typeof step[key] !== 'string' || step[key].length > 50_000)) throw new Error(`${scenario.id}: invalid command block.`);
    }
  }
  return scenarios.sort((left, right) => left.order - right.order);
}

async function filesBelow(directory) {
  const results = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return results; throw error; }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Walkthrough source must not contain symbolic links.');
    if (entry.isDirectory()) results.push(...await filesBelow(path));
    else if (entry.isFile()) results.push(path);
  }
  return results;
}

export async function scenarioFingerprint(scenario) {
  const hash = createHash('sha256').update(JSON.stringify(scenario));
  const files = [
    ...await filesBelow(join(repository, 'src')),
    ...await filesBelow(join(repository, 'examples/quickstarts')),
    ...['package.json', 'package-lock.json', 'tsconfig.json', 'scripts/scenario-utils.mjs', 'scripts/test-scenarios.mjs'].map(path => join(repository, path)),
  ];
  for (const file of files.sort()) hash.update(relative(repository, file)).update('\0').update(await readFile(file)).update('\0');
  return hash.digest('hex');
}
