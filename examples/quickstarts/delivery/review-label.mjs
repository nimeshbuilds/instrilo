// Create an explicitly abstained tutorial label bound to this saved report.
// It does not claim a human reviewed or approved model quality.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const project = resolve(process.argv[2]);
const report = JSON.parse(await readFile(join(project, 'reports/demo.json'), 'utf8'));
const label = {
  reportId: report.id,
  caseId: 'review-demo',
  verdict: 'abstain',
  reviewer: 'Tutorial operator',
  reason: 'Synthetic demo output; no real model answer quality has been verified.',
};
await writeFile(join(project, 'abstention.json'), JSON.stringify(label, null, 2) + '\n', { flag: 'wx' });
console.log(label);
