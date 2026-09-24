export function createDeploymentUI({ api, state, render, toast, escape, pretty }) {
  const pages = new Map(); let pending;
  const current = () => { const id = state.project?.id; if (!pages.has(id)) pages.set(id,{ engine:'docker', output:null, removeMachineData:false }); return pages.get(id); };
  const button = (text, action, extra='') => `<button class="btn" data-deployment="${action}" ${extra}>${text}</button>`;
  function panel() {
    const page = current();
    return `<section class="card" style="margin:18px 0"><div class="eyebrow">PLATFORM CHECKS AND LOCAL EVIDENCE</div><h2>Test your deployment before shipping.</h2><p class="subtitle">Read platform prerequisites, then build and exercise the generated container with isolated model and identity fixtures.</p><div class="actions"><label>Container engine <select name="deployment-engine"><option value="docker" ${page.engine==='docker'?'selected':''}>Docker</option><option value="podman" ${page.engine==='podman'?'selected':''}>Podman</option></select></label>${button('Platform prerequisites','prerequisites')}${button('Read deployment guide','guide')}${button('Review local test','test')}${button('Test reports','reports')}</div><p class="locked-note">Local tests do not deploy cloud resources or verify cloud IAM, quotas, secret-manager access, or model quality. Test resources are removed automatically; evidence is retained.</p><details><summary>Container dependencies and cleanup</summary><p>Review each operation before execution. Existing runtimes and unrelated resources are preserved.</p><label class="check-label"><input type="checkbox" name="deployment-machine-data" ${page.removeMachineData?'checked':''}>Include the entire disk of an Instrilo-owned Podman VM in the cleanup review</label><div class="actions">${button('Check engine','engine-status')}${button('Review installation','engine-install')}${button('Review startup','engine-start')}${button('Review dependency removal','engine-cleanup')}</div><div class="form-grid" style="margin-top:12px"><label>Test run ID<input class="input" name="deployment-run-id" placeholder="ID from a retained test report" autocomplete="off"></label><div>${button('Review test cleanup','cleanup')}</div></div></details><div id="deployment-progress" aria-live="polite"></div>${page.output ? `<details open><summary>Deployment evidence and instructions</summary><pre class="code">${escape(typeof page.output==='string'?page.output:pretty(page.output))}</pre></details>` : ''}</section>`;
  }
  function review(title, plan, path, body) {
    pending = { path, body, project:state.project.id };
    const modal = document.createElement('div'); modal.className='modal-backdrop';
    modal.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="deployment-review-title"><h2 id="deployment-review-title">${escape(title)}</h2><p>Inspect the exact prerequisites, effects and cleanup boundaries below.</p><pre class="code" style="max-height:50vh">${escape(pretty(plan))}</pre><div class="footer-actions">${button('Cancel','dismiss')}${button('Execute reviewed operation','execute',plan.supported===false?'disabled':'')}</div></section>`;
    document.body.append(modal); modal.querySelector('[data-deployment="execute"]').focus();
  }
  async function run(operation) {
    if(state.busy) throw new Error('Wait for the current operation or cancel it first.');
    state.busy=true;
    try {
      const {jobId}=await api(operation.path,{method:'POST',body:operation.body});
      state.job={id:jobId,kind:'Deployment operation',status:'running'};render();
      let job;
      do {
        await new Promise(resolve=>setTimeout(resolve,650)); job=await api('/jobs/'+jobId);state.job=job;
        const progress=document.querySelector('#deployment-progress');if(progress)progress.textContent=(job.progressMessages||[]).filter(event=>event.type==='message').map(event=>event.text).join('\n');
      } while(['running','cancelling'].includes(job.status));
      const page=pages.get(operation.project);if(page)page.output=job.result||{status:job.status,error:job.error};
      if(job.status==='failed')toast(job.error||'Checks failed. Inspect the retained report.',true);
      else toast(job.status==='cancelled'?'Operation cancelled. Inspect its report for cleanup status.':'Operation finished. Review the result below.');
    } finally {state.busy=false;state.job=null;render();}
  }
  document.addEventListener('change',event=>{if(event.target.name==='deployment-machine-data'){current().removeMachineData=event.target.checked;return;}if(event.target.name==='deployment-engine'){current().engine=event.target.value;current().output=null;render();}});
  document.addEventListener('click',async event=>{
    const control=event.target.closest('[data-deployment]');if(!control)return;
    try {
      const action=control.dataset.deployment;
      if(action==='dismiss'){pending=null;control.closest('.modal-backdrop')?.remove();return;}
      if(action==='execute'){if(!pending)throw new Error('Review an operation first.');const operation=pending;pending=null;control.closest('.modal-backdrop')?.remove();await run(operation);return;}
      const page=current(),base='/projects/'+state.project.id+'/deployment',engine=page.engine;
      if(action==='test'){const path=base+'/test';review('Run local container checks',await api(path+'?engine='+engine),path,{engine,execute:true});return;}
      if(action==='cleanup'){const id=document.querySelector('[name="deployment-run-id"]').value.trim();if(!/^[a-zA-Z0-9-]+$/.test(id))throw new Error('Enter a test run ID from the retained reports.');const path=base+'/cleanup/'+id;review('Clean up test resources',await api(path),path,{execute:true});return;}
      if(action.startsWith('engine-')){const operation=action.slice(7),path='/container-engines/'+engine+(operation==='status'?'':'/'+operation);const data=await api(path+(operation==='cleanup'&&page.removeMachineData?'?removeMachineData=true':''));if(operation==='status')page.output=data;else{review('Review '+engine+' '+operation,data,path,{consent:true,...(operation==='cleanup'?{removeMachineData:page.removeMachineData}:{})});return;}}
      else if(action==='prerequisites')page.output=await api(base+'/prerequisites?engine='+engine);
      else if(action==='guide')page.output=(await api(base+'/guide')).content;
      else if(action==='reports')page.output=await api(base+'/reports');
      render();
    } catch(error){toast(error.message,true);}
  });
  return { panel };
}
