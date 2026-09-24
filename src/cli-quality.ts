import { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { projectRoot, projectSpec, readDocument } from './project-ops.js';
import { safeChild, planProject } from './workbench.js';
import { inspectGeneration, recoverGeneration, migrateGeneration, dependencyLockStatus, withGenerationLock } from './regeneration.js';
import { addRequirement, importRequirements, listRequirements, updateRequirement, linkRequirement, unlinkRequirement, waiveRequirement, evidenceStatus, registerEvidenceReport, releaseEvidence, importReleasePolicy, loadReleasePolicy, parseReleasePolicy } from './evidence.js';
import { reviewQueue, addReview, importReviews, exportReviews, calibrationReport, reviewAssessments } from './review.js';
import { startRecordedRun, resumeRecordedRun, replayRun, replayRunBundle, getRun, listRuns, approveRun, denyRun, reconcileRun, exportRunBundle, importRunBundle, runGraph, recoverRunLock } from './runs.js';
import { assertBuildCurrent, assertBuildContentCurrent } from './execution.js';
import { withCliCancellation } from './cli-runtime.js';
const print=(x:unknown)=>console.log(JSON.stringify(x,null,2));
const project=(cmd:Command)=>cmd.argument('[project]','project directory (default: current directory)','.');
const input=(cmd:Command)=>cmd.option('--file <path>','read a bounded JSON/YAML document').option('--data <json>','supply a JSON object directly');
async function document(o:any){if(Boolean(o.file)===Boolean(o.data))throw new Error('Provide exactly one of --file PATH or --data JSON.');return o.file?readDocument(resolve(o.file),16_000_000):JSON.parse(o.data);}
const generated=(p:string)=>safeChild(projectRoot(p),'generated');
function runStatus(run:any){print(run);if(['paused','needs_reconciliation'].includes(run.status))process.exitCode=3;else if(['failed','denied'].includes(run.status))process.exitCode=1;}
async function saveOutput(value:unknown,path?:string){if(path){await writeFile(resolve(path),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});print({output:resolve(path)});}else print(value);}
/** Keeps the caller's generation lock until the package manager has closed. */
export async function runDependencyCommand(command:string[],directory:string,options:{timeoutMs?:number}={}):Promise<void>{
 const timeoutMs=options.timeoutMs??300000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new Error('Invalid dependency operation timeout.');
 await new Promise<void>((yes,no)=>{
  const child=spawn(command[0],command.slice(1),{cwd:directory,shell:false,stdio:'inherit',env:process.env,detached:process.platform!=='win32'});
  let failure:Error|undefined, escalation:ReturnType<typeof setTimeout>|undefined;
  const kill=(signal:NodeJS.Signals)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{child.kill(signal);}};
  const interrupt=()=>{failure??=new Error('Dependency operation cancelled.');kill('SIGTERM');escalation??=setTimeout(()=>kill('SIGKILL'),250);};
  const timer=setTimeout(()=>{failure??=new Error('Dependency operation timed out.');kill('SIGKILL');},timeoutMs);
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  child.once('error',error=>{failure??=error;});
  child.once('exit',()=>kill('SIGKILL'));
  child.once('close',code=>{
   clearTimeout(timer);if(escalation)clearTimeout(escalation);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
   kill('SIGKILL');if(failure)no(failure);else if(code!==0)no(new Error('Dependency operation failed with exit '+code));else yes();
  });
 });
}
export function registerQualityCommands(program:Command){
 const requirements=program.command('requirements').description('Track guidance requirements, human-reviewed evidence links, stale sources and explicit waivers.');
 input(project(requirements.command('add').description('Add one requirement. Fields: id, text, sourcePath; optional title, reviewer, reason.'))).action(async(p,o)=>print(await addRequirement(projectRoot(p),await document(o))));
 input(project(requirements.command('import').description('Import a requirement array or {schemaVersion:"1",requirements:[...]}.'))).action(async(p,o)=>print(await importRequirements(projectRoot(p),await document(o))));
 project(requirements.command('list').description('List recorded requirements, source hashes, review metadata and case links.')).action(async p=>print(await listRequirements(projectRoot(p))));
 project(requirements.command('status').description('Show proposed, stale-source, uncovered, stale-link, ready and waived requirements.')).action(async p=>print(await evidenceStatus(projectRoot(p))));
 input(project(requirements.command('update <id>').description('Update a requirement and invalidate earlier review/link fingerprints.'))).option('--expected-revision <number>','refuse if this requirement revision changed').action(async(id,p,o)=>print(await updateRequirement(projectRoot(p),id,await document(o),{expectedRevision:o.expectedRevision?Number(o.expectedRevision):undefined})));
 project(requirements.command('link <id>').description('Link a human-reviewed case to an exact requirement version.')).requiredOption('--case <id>','existing case ID').requiredOption('--kind <kind>','deterministic, judge or human').requiredOption('--reviewer <name>','person who reviewed this relationship').requiredOption('--reason <text>','why this case covers the requirement').action(async(id,p,o)=>{if(!['deterministic','judge','human'].includes(o.kind))throw new Error('Unknown evidence kind.');print(await linkRequirement(projectRoot(p),id,{caseId:o.case,kind:o.kind,reviewer:o.reviewer,reason:o.reason}));});
 project(requirements.command('unlink <id>').description('Remove obsolete coverage links and preserve an audited reason and prior snapshot.')).requiredOption('--case <id>','case whose links should be removed').option('--kind <kind>','remove only deterministic, judge or human links; default removes all kinds for this case').requiredOption('--reviewer <name>','person removing this relationship').requiredOption('--reason <text>','why this link is obsolete').action(async(id,p,o)=>{if(o.kind&&!['deterministic','judge','human'].includes(o.kind))throw new Error('Unknown evidence kind.');print(await unlinkRequirement(projectRoot(p),id,{caseId:o.case,kind:o.kind,reviewer:o.reviewer,reason:o.reason}));});
 project(requirements.command('waive <id>').description('Record a reasoned waiver; release policy must separately allow waivers.')).requiredOption('--reviewer <name>','responsible reviewer').requiredOption('--reason <text>','explicit reason').option('--expires-at <date>','ISO8601 expiry').action(async(id,p,o)=>print(await waiveRequirement(projectRoot(p),id,{reviewer:o.reviewer,reason:o.reason,expiresAt:o.expiresAt})));
 requirements.command('example').description('Print an example requirement document to edit and review before import.').action(()=>print({id:'billing-human',title:'Escalate billing disputes',text:'Billing disputes require a human response.',sourcePath:'purpose.md',reviewer:'YOUR_NAME',reason:'Reviewed against the product guidance.'}));
 const evidence=program.command('evidence').description('Register immutable evaluation reports and inspect requirement coverage.');
 input(project(evidence.command('register').description('Register a report snapshot by immutable ID. CLI/app eval also register automatically.'))).action(async(p,o)=>print(await registerEvidenceReport(projectRoot(p),await document(o))));
 project(evidence.command('status').description('Inspect current guidance/case fingerprints and requirement coverage status.')).action(async p=>print(await evidenceStatus(projectRoot(p))));
 const release=project(program.command('release').description('Evaluate the project-owned release gate; exit 2 when blocked. Does not deploy.')).requiredOption('--report <id-or-path>','registered report ID or JSON path within the project').option('--policy <file>','explicit policy JSON/YAML; otherwise use project policy').option('--output <file>','write the release decision to a new file');
 release.action(async(p,o)=>{const result=await releaseEvidence(projectRoot(p),o.report,o.policy?await readDocument(resolve(o.policy)):undefined);await saveOutput(result,o.output);if(!result.allowed)process.exitCode=2;});
 const policy=program.command('policy').description('Inspect and set versioned release policy; defaults reject demo, synthetic and uncovered evidence.');
 policy.command('template').description('Print the versioned strict-default release policy as JSON.').action(()=>print(parseReleasePolicy()));
 project(policy.command('show').description('Show the effective saved policy or strict defaults when none is saved.')).action(async p=>print(await loadReleasePolicy(projectRoot(p))));
 input(project(policy.command('apply').description('Validate and atomically save an explicit project-owned release policy.'))).action(async(p,o)=>print(await importReleasePolicy(projectRoot(p),await document(o))));
 const review=program.command('review').description('Review exact outputs blindly, retain immutable labels, and calibrate judges against humans.');
 project(review.command('queue').description('Show exact evaluated outputs and binding hashes; automated/prior human verdicts are hidden by default.')).requiredOption('--report <id-or-path>','evaluation report').option('--unblind','include judge/check results and prior human verdicts').option('--output <file>','write the queue to a new JSON file').action(async(p,o)=>saveOutput(await reviewQueue(projectRoot(p),o.report,{blind:!o.unblind}),o.output));
 input(project(review.command('label').description('Append a bound human label: reportId, caseId, verdict, reviewer, reason, optional binding/supersedes.'))).action(async(p,o)=>print(await addReview(projectRoot(p),await document(o))));
 input(project(review.command('import').description('Import a versioned label export. Binding checksums and original report snapshots must match.'))).action(async(p,o)=>print(await importReviews(projectRoot(p),await document(o))));
 project(review.command('export').description('Export immutable human-label history, including superseded corrections.')).option('--output <file>','write labels to a new JSON file').action(async(p,o)=>saveOutput(await exportReviews(projectRoot(p)),o.output));
 project(review.command('assessments').description('Inspect active human consensus, abstentions and unresolved disagreements for each case.')).requiredOption('--report <id-or-path>','report').action(async(p,o)=>print(await reviewAssessments(projectRoot(p),o.report)));
 project(review.command('calibrate').description('Report sample size, judge-human agreement, false passes/fails and disagreements.')).requiredOption('--report <id-or-path>','report').action(async(p,o)=>print(await calibrationReport(projectRoot(p),o.report)));
 review.command('example').description('Print an example human label to edit; include the blind queue binding for asynchronous review.').action(()=>print({reportId:'REPORT_ID',caseId:'billing-escalation',verdict:'pass',reviewer:'YOUR_NAME',reason:'Escalates the billing dispute as required.'}));
 const generation=program.command('generation').description('Plan safe rebuilds, inspect retained baselines, migrate old builds and recover interrupted updates.');
 project(generation.command('plan')).option('--merge','attempt conservative non-overlapping three-way text merges').option('--output-directory <path>','custom generated directory').action(async(p,o)=>{const {root}=await projectSpec(p);const result=await planProject(join(root,'agent-studio.yaml'),o.outputDirectory,{merge:o.merge});print(result);});
 project(generation.command('inspect')).action(async p=>print(await inspectGeneration(generated(p))));
 project(generation.command('recover').description('Roll back an interrupted transaction only when affected files still match its journal.')).action(async p=>print(await recoverGeneration(generated(p))));
 project(generation.command('migrate')).option('--apply','apply the backward-compatible baseline migration; default is preview').action(async(p,o)=>print(await migrateGeneration(generated(p),{dryRun:!o.apply})));
 const deps=program.command('deps').description('Inspect, create and enforce actual npm/uv dependency locks. Registry access may be required.');
 project(deps.command('status')).action(async p=>print(await dependencyLockStatus(generated(p))));
 for(const operation of ['lock','install']as const)project(deps.command(operation).description(operation==='lock'?'Resolve and write package-lock.json or uv.lock explicitly.':'Install from an existing lock without updating it; stale locks fail.')).action(async p=>{
  const {spec}=await projectSpec(p),dir=generated(p);await assertBuildCurrent(spec,dir);
  const result=await withGenerationLock(dir,async()=>{
   await assertBuildContentCurrent(spec,dir);const state=await dependencyLockStatus(dir);
   if(!state.commands)throw new Error('Build the project first.');
   if(operation==='install'&&!state.present)throw new Error('Create a lock with instrilo deps lock PROJECT first.');
   if(operation==='install'&&state.consistency==='stale')throw new Error('Lock is stale. Review dependency changes and run deps lock.');
   const command=[...state.commands[operation]];if(spec.language==='python'&&process.env.NB_AGENT_PYTHON)command.push('--python',process.env.NB_AGENT_PYTHON);
   await runDependencyCommand(command,dir);await assertBuildContentCurrent(spec,dir);return dependencyLockStatus(dir);
  });print(result);
 });
 const runs=program.command('runs').description('Record local native/LangGraph runs, resume approved work and replay frozen model/tool responses.');
 project(runs.command('start').description('Persist sensitive input/model/tool content for durable replay and approval pauses.')).requiredOption('--input <text>','agent task').option('--record-content','explicitly consent to local content recording (required)').option('--caller <id>','local caller identity label').option('--tenant <id>','tenant label (tools still need resource authorization)').option('--scopes <list>','comma-separated operator-granted tool scopes').action(async(p,o)=>{if(!o.recordContent)throw new Error('Durable runs store input, model and tool content locally. Pass --record-content explicitly.');const {spec}=await projectSpec(p);runStatus(await withCliCancellation(signal=>startRecordedRun(spec,generated(p),o.input,{recordContent:true,caller:o.caller,tenant:o.tenant,scopes:o.scopes?.split(',').filter(Boolean),signal})));});
 project(runs.command('list')).action(async p=>print((await listRuns(generated(p))).map(({id,status,createdAt,updatedAt,framework,language,caller,tenant,replayable})=>({id,status,createdAt,updatedAt,framework,language,caller,tenant,replayable}))));
 project(runs.command('show <id>')).action(async(id,p)=>print(await getRun(generated(p),id)));
 for(const command of ['resume','replay']as const)project(runs.command(command+' <id>').description(command==='resume'?'Replay completed steps and continue approved work; ambiguous writes are never retried automatically.':'Execute the current pinned runtime against recorded responses with zero live model/tool calls.')).option('--caller <id>','must match the original caller').option('--tenant <id>','must match original tenant').option('--scopes <list>','must match original grants').action(async(id,p,o)=>{const {spec}=await projectSpec(p);const options={caller:o.caller,tenant:o.tenant,scopes:o.scopes?.split(',').filter(Boolean)};if(command==='resume')runStatus(await withCliCancellation(signal=>resumeRecordedRun(spec,generated(p),id,{...options,signal})));else{const result=await withCliCancellation(signal=>replayRun(spec,generated(p),id,{...options,signal}));print(result);if(!result.matched)process.exitCode=1;}});
 project(runs.command('recover-lock <id>').description('Remove a durable-run lock only after verifying its recorded process is no longer alive.')).action(async(id,p)=>{await recoverRunLock(generated(p),id);print({recovered:id});});
 project(runs.command('export <id>')).option('--include-content','include scrubbed input/model/tool content; inspect before sharing').option('--output <file>','new bundle JSON file; defaults to stdout').action(async(id,p,o)=>{const content=await exportRunBundle(generated(p),id,{includeContent:o.includeContent});if(o.output){await writeFile(resolve(o.output),content,{flag:'wx',mode:0o600});print({output:resolve(o.output)});}else process.stdout.write(content);});
 runs.command('inspect-bundle <file>').description('Validate and inspect an imported portable failure bundle; never executes bundled code.').action(async file=>{const path=resolve(file);const parsed=await readDocument(path,16*1024*1024);print(importRunBundle(JSON.stringify(parsed)));});
 project(runs.command('replay-bundle <file>').description('Replay portable recorded data against an exactly matching trusted local build; never installs imported code.')).option('--execute-local','explicitly run the matching local project against frozen responses').action(async(file,p,o)=>{const {spec}=await projectSpec(p);const bundle=await readDocument(resolve(file),16*1024*1024);const result=await withCliCancellation(signal=>replayRunBundle(spec,generated(p),JSON.stringify(bundle),{executeLocal:!!o.executeLocal,signal}));print(result);if(!result.matched)process.exitCode=1;});
 project(runs.command('graph <id>')).option('--format <format>','json or mermaid','mermaid').action(async(id,p,o)=>{const graph=runGraph(await getRun(generated(p),id));if(o.format==='mermaid')process.stdout.write(graph.mermaid);else if(o.format==='json')print(graph);else throw new Error('Format must be json or mermaid.');});
 const approvals=program.command('approvals').description('Inspect and decide exact pending tool actions as the local OS operator.');
 project(approvals.command('show <run-id>')).action(async(id,p)=>{const run=await getRun(generated(p),id);print({runId:id,status:run.status,caller:run.caller,tenant:run.tenant,pending:run.events.filter(e=>['pending','started','ambiguous','denied'].includes(e.status))});});
 project(approvals.command('approve <run-id>').description('Approve the inspected digest once, with expiry. Resume is a separate explicit action.')).requiredOption('--digest <sha256>','exact approvalDigest displayed by approvals show').option('--expires-in <seconds>','approval lifetime in seconds','300').option('--reviewer <name>','audit label; OS ownership remains the trust boundary').action(async(id,p,o)=>{const seconds=Number(o.expiresIn);if(!Number.isFinite(seconds)||seconds<=0)throw new Error('Expiry must be a positive number.');print(await approveRun(generated(p),id,{expectedDigest:o.digest,expiresInMs:seconds*1000,reviewer:o.reviewer}));});
 project(approvals.command('deny <run-id>')).requiredOption('--digest <sha256>','exact pending approval digest').option('--reviewer <name>','audit label').action(async(id,p,o)=>print(await denyRun(generated(p),id,{expectedDigest:o.digest,reviewer:o.reviewer})));
 input(project(approvals.command('reconcile <run-id>').description('Record a confirmed external result after an ambiguous operation; never repeats the external action.'))).requiredOption('--digest <sha256>','exact pending request/approval digest').requiredOption('--note <text>','how the outcome was verified outside Instrilo').option('--reviewer <name>','responsible local operator').action(async(id,p,o)=>print(await reconcileRun(generated(p),id,{expectedDigest:o.digest,response:await document(o),note:o.note,reviewer:o.reviewer})));
}
