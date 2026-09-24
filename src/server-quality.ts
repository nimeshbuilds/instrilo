import { evidenceStatus, addRequirement, updateRequirement, linkRequirement, unlinkRequirement, waiveRequirement, releaseEvidence, loadReleasePolicy, importReleasePolicy, readEvidenceDocument, evidenceHash, registerEvidenceReport } from './evidence.js';
import { reviewQueue, addReview, calibrationReport, exportReviews } from './review.js';
import { getRun, approveRun, denyRun, reconcileRun, runGraph, exportRunBundle } from './runs.js';
import { listAdapters } from './adapters.js';
import { planProject, safeChild } from './workbench.js';
import { inspectGeneration, dependencyLockStatus } from './regeneration.js';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

async function registeredReport(project:string,url:URL):Promise<string>{
 const id=url.searchParams.get('report')||'';
 // CLI report loading can import a file. A GET endpoint must only inspect a prior registration.
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)||!await readEvidenceDocument(project,`reports/${evidenceHash(id)}.json`))throw new Error('Choose a registered report ID; GET requests cannot import report files.');
 return id;
}
async function existingRuns(project:string,generated:string){
 let names:string[];
 try{names=await readdir(safeChild(project,'.instrilo/runs'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 const runs=await Promise.all(names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>getRun(generated,name.slice(0,-5))));
 return runs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export async function qualityRequest(project:string,action:string,method:string,url:URL,body:unknown):Promise<{handled:boolean;result?:unknown}>{
 const data=body as any,generated=safeChild(project,'generated');
 const done=(result:unknown)=>({handled:true,result});
 if(action==='quality'&&method==='GET')return done({evidence:await evidenceStatus(project),policy:await loadReleasePolicy(project),adapters:await listAdapters(project)});
 if(action==='quality/evidence/register'&&method==='POST')return done(await registerEvidenceReport(project,data));
 if(action==='quality/requirements'&&method==='POST')return done(await addRequirement(project,data));
 if(action==='quality/requirements/update'&&method==='POST')return done(await updateRequirement(project,data.id,data.patch,{expectedRevision:data.expectedRevision}));
 if(action==='quality/requirements/link'&&method==='POST')return done(await linkRequirement(project,data.id,data.link));
 if(action==='quality/requirements/unlink'&&method==='POST')return done(await unlinkRequirement(project,data.id,data.link));
 if(action==='quality/requirements/waive'&&method==='POST')return done(await waiveRequirement(project,data.id,data.waiver));
 if(action==='quality/policy'&&method==='PUT')return done(await importReleasePolicy(project,data));
 if(action==='quality/release'&&method==='POST')return done(await releaseEvidence(project,data.report,data.policy));
 if(action==='quality/review/queue'&&method==='GET')return done(await reviewQueue(project,await registeredReport(project,url),{blind:url.searchParams.get('unblind')!=='true'}));
 if(action==='quality/review/label'&&method==='POST')return done(await addReview(project,data));
 if(action==='quality/review/calibrate'&&method==='GET')return done(await calibrationReport(project,await registeredReport(project,url)));
 if(action==='quality/review/export'&&method==='GET')return done(await exportReviews(project));
 if(action==='generation/plan'&&method==='POST')return done(await planProject(join(project,'agent-studio.yaml'),undefined,{merge:!!data.merge}));
 if(action==='generation/inspect'&&method==='GET')return done(await inspectGeneration(generated));
 if(action==='generation/dependencies'&&method==='GET')return done(await dependencyLockStatus(generated));
 if(action==='runs'&&method==='GET')return done((await existingRuns(project,generated)).map(({id,status,createdAt,updatedAt,framework,language,caller,tenant,replayable})=>({id,status,createdAt,updatedAt,framework,language,caller,tenant,replayable})));
 const match=action.match(/^runs\/([a-f0-9-]+)(?:\/(approve|deny|reconcile|export))?$/);
 if(match){const id=match[1],operation=match[2];if(!operation&&method==='GET'){const run=await getRun(generated,id);return done({run,graph:runGraph(run)});}if(operation==='approve'&&method==='POST')return done(await approveRun(generated,id,data));if(operation==='deny'&&method==='POST')return done(await denyRun(generated,id,data));if(operation==='reconcile'&&method==='POST')return done(await reconcileRun(generated,id,data));if(operation==='export'&&method==='GET')return done(JSON.parse(await exportRunBundle(generated,id,{includeContent:url.searchParams.get('includeContent')==='true'})));}
 return {handled:false};
}
