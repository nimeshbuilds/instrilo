import http from 'node:http';
import { readFile, writeFile, readdir, mkdir, lstat, unlink, open, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import YAML from 'yaml';
import { defaultSpec, validateSpec, loadSpec, saveSpec, inspectGuidance, writeGuidance, guidanceQuestions, readCases } from './core.js';
import { providerCapabilities, diagnoseConnection } from './providers.js';
import { createProject, listProjects, safeChild, manifestName, buildProject, refineProject, parseManifestText } from './workbench.js';
import { runProject, evaluateProject, saveReport, sanitizeError, prepareProject } from './execution.js';
import type { GuidanceAnswers, GuidanceReport } from './types.js';

interface Job { id: string; project: string; kind: string; status: 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'; progress?: { done: number; total: number }; result?: unknown; error?: string; startedAt: string; controller: AbortController }
async function readBody(req: http.IncomingMessage): Promise<any> { let body = ''; for await (const data of req) { body += data; if (body.length > 2_000_000) throw new Error('Request exceeds 2 MB.'); } return body ? JSON.parse(body) : {}; }
export async function startServer(options: { workspace: string; port?: number }) {
  const root = resolve(options.workspace); await mkdir(root, { recursive: true });
  const token = randomBytes(32).toString('hex'); const jobs = new Map<string, Job>();
  const guidanceMutations = new Set<string>();
  const webRoot = fileURLToPath(new URL('./web/', import.meta.url));
  let activePort = options.port ?? 4317;
  function authorized(req: http.IncomingMessage) {
    const supplied = String(req.headers['x-studio-token'] || '');
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return false;
    const origin = req.headers.origin;
    return !origin || origin === `http://127.0.0.1:${activePort}` || origin === `http://localhost:${activePort}`;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (!['127.0.0.1', 'localhost'].includes((req.headers.host || '').split(':')[0])) return json({ error: 'Invalid local host.' }, 403);
      const url = new URL(req.url || '/', `http://127.0.0.1:${activePort}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!['index.html', 'app.js', 'style.css', 'icon.svg'].includes(file)) return json({ error: 'Not found.' }, 404);
        const content = await readFile(join(webRoot, file));
        res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' }); res.end(content); return;
      }
      if (!authorized(req)) return json({ error: 'Open the authenticated URL printed by instrilo app.' }, 401);
      if (url.pathname === '/api/meta') return json({ version: '0.1.0', workspace: root, providers: providerCapabilities, questions: guidanceQuestions, defaultSpec: defaultSpec('my-agent'), frameworks: ['native', 'langgraph', 'openai-agents', 'crewai'], targets: ['local', 'docker', 'aws-agentcore', 'cloud-run', 'azure-container-apps'] });
      if (url.pathname === '/api/projects' && req.method === 'GET') return json(await listProjects(root));
      if (url.pathname === '/api/projects' && req.method === 'POST') { const body = await readBody(req); const created = await createProject(root, { name: body.name, language: body.language || 'typescript' }); return json({ id: body.name, ...created }, 201); }
      const jm = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(\/cancel)?$/);
      if (jm) { const job = jobs.get(jm[1]); if (!job) return json({ error: 'Job not found.' }, 404); if (jm[2] && req.method === 'POST' && job.status === 'running') { job.status = 'cancelling'; job.controller.abort(); } const { controller, ...publicJob } = job; return json(publicJob); }
      const match = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{1,62})(?:\/(.*))?$/);
      if (!match) return json({ error: 'Not found.' }, 404);
      const id = match[1], action = match[2] || '', projectDir = safeChild(root, id), manifest = join(projectDir, manifestName);
      const spec = await loadSpec(manifest);
      safeChild(projectDir, spec.guidanceDir); safeChild(projectDir, spec.evaluation.dataset);
      const locked = guidanceMutations.has(id) || [...jobs.values()].some(j => j.project === id && ['running', 'cancelling'].includes(j.status));
      if (locked && ['POST', 'PUT', 'DELETE'].includes(req.method || '')) return json({ error: 'A job is already running for this project. Wait or cancel it first.' }, 409);
      if (!action && req.method === 'GET') {
        const guidance = await inspectGuidance(resolve(projectDir, spec.guidanceDir));
        let cases: unknown[] = [], reports: unknown[] = [], files: string[] = [];
        try { cases = await readCases(resolve(projectDir, spec.evaluation.dataset)); } catch { /* new project */ }
        try { const reportDir = safeChild(projectDir, 'reports'); for (const f of (await readdir(reportDir)).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 20)) { const r = JSON.parse(await readFile(safeChild(reportDir, f), 'utf8')); if (validReport(r)) reports.push(r); } } catch { /* no valid reports */ }
        try { files = await walk(safeChild(projectDir, 'generated')); } catch { /* not built */ }
        return json({ id, spec, yaml: YAML.stringify(spec), guidance, cases, reports, files, issues: validateSpec(spec).issues });
      }
      if (action === 'spec' && req.method === 'PUT') { const body = await readBody(req); const parsed = await parseManifestText(body.yaml || JSON.stringify(body.spec)); safeChild(projectDir, parsed.guidanceDir); safeChild(projectDir, parsed.evaluation.dataset); await saveSpec(manifest, parsed); return json({ spec: parsed, issues: validateSpec(parsed).issues }); }
      if ((action === 'guidance' && ['POST', 'PUT'].includes(req.method || '')) || (action === 'guidance/clarifications' && req.method === 'POST')) {
        const guidancePath = safeChild(projectDir, spec.guidanceDir);
        if (guidanceMutations.has(id)) return json({ error: 'Guidance is being updated. Retry after the current save finishes.' }, 409);
        guidanceMutations.add(id);
        try {
        const body = await readBody(req);
        if (req.method === 'PUT') {
          if (typeof body.path !== 'string' || typeof body.content !== 'string' || typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)) throw new Error('Provide an inspected file path, text content, and its current SHA-256.');
          const report = await inspectGuidance(guidancePath);
          const existing = report.files.find(file => file.path === body.path);
          if (!existing) throw new Error('Only an existing eligible guidance file may be edited. Refresh the guidance inventory.');
          if (existing.sha256 !== body.sha256) return json({ error: 'This file changed since you opened it. Refresh its content before saving; your draft has not been written.' }, 409);
          const checked = await validateGuidanceChange(report, body.path, body.content);
          const destination = safeChild(guidancePath, body.path);
          const file = await open(destination, constants.O_RDWR | constants.O_NOFOLLOW);
          try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.size > 64_000) throw new Error('The guidance file is no longer an eligible bounded regular file.');
            const buffer = Buffer.alloc(64_001); let length = 0;
            while (length < buffer.length) { const { bytesRead } = await file.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
            if (length > 64_000 || createHash('sha256').update(buffer.subarray(0, length)).digest('hex') !== body.sha256) return json({ error: 'This file changed during validation. Refresh it before saving; your draft has not been written.' }, 409);
            const bytes = Buffer.from(body.content, 'utf8');
            // Positional writes avoid the offset used while checking the old contents.
            let written = 0;
            while (written < bytes.length) { const next = await file.write(bytes, written, bytes.length - written, written); if (!next.bytesWritten) throw new Error('Unable to finish writing guidance.'); written += next.bytesWritten; }
            await file.truncate(bytes.length);
            await file.sync();
          } finally { await file.close(); }
          return json({ path: body.path, sha256: createHash('sha256').update(body.content).digest('hex'), issues: checked.issues });
        }
        if (action === 'guidance/clarifications') {
          if (!Array.isArray(body.answers) || !body.answers.length || body.answers.length > 30) throw new Error('Provide between 1 and 30 answered clarification questions.');
          const answers: { question: string; answer: string }[] = body.answers.map((item: any) => {
            if (!item || typeof item.question !== 'string' || typeof item.answer !== 'string' || !item.question.trim() || !item.answer.trim() || item.question.length > 4000 || item.answer.length > 20_000) throw new Error('Each clarification requires a question (up to 4,000 characters) and an answer (up to 20,000 characters).');
            return { question: item.question.trim(), answer: item.answer.trim() };
          });
          const path = `clarifications-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.md`;
          const content = '# Project owner clarifications\n\nThese answers were supplied by the project owner. They do not independently grant runtime permissions.\n\n' + answers.map(item => `## ${item.question.replace(/\s+/g, ' ')}\n\n${item.answer}\n`).join('\n');
          const report = await inspectGuidance(guidancePath);
          const checked = await validateGuidanceChange(report, path, content);
          await writeFile(safeChild(guidancePath, path), content, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode: 0o600 });
          return json({ path, sha256: createHash('sha256').update(content).digest('hex'), saved: answers.length, issues: checked.issues }, 201);
        }
        if (body.importPath) { const report = await inspectGuidance(resolve(body.importPath)); if (report.issues.some(i => i.level === 'error')) throw new Error(report.issues.map(i => i.message).join('\n')); await mkdir(guidancePath, { recursive: true }); for (const file of report.files) { const dest = safeChild(guidancePath, file.path); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, file.content); } return json({ imported: report.files.length, issues: report.issues }); }
        if (!body.answers || typeof body.answers !== 'object') throw new Error('Guidance answers are required.');
        const answers = Object.fromEntries(guidanceQuestions.map(q => [q.key, String(body.answers[q.key] || '')])) as unknown as GuidanceAnswers;
        return json({ files: await writeGuidance(guidancePath, answers) });
        } finally { guidanceMutations.delete(id); }
      }
      if (action === 'cases' && req.method === 'PUT') {
        const body = await readBody(req); if (!Array.isArray(body.cases)) throw new Error('Expected an array of evaluation cases.');
        const path = safeChild(projectDir, spec.evaluation.dataset); const temporary = path + '.' + randomUUID() + '.pending'; await mkdir(dirname(path), { recursive: true });
        try { await writeFile(temporary, body.cases.map((c: unknown) => JSON.stringify(c)).join('\n') + '\n', { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode: 0o600 });
          const checked = await readCases(temporary); await writeFile(path, checked.map(c => JSON.stringify(c)).join('\n') + '\n', { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, mode: 0o600 }); return json({ saved: checked.length });
        } finally { await unlink(temporary).catch(() => {}); }
      }
      if (action === 'artifact' && req.method === 'GET') { const path = safeChild(safeChild(projectDir, 'generated'), url.searchParams.get('path') || 'README.md'); const info = await lstat(path); if (info.isSymbolicLink() || info.size > 2_000_000) throw new Error('This artifact cannot be previewed.'); return json({ content: await readFile(path, 'utf8') }); }
      if (action === 'download' && req.method === 'GET') { const base = safeChild(projectDir, 'generated'); const files = await walk(base); const entries: Record<string, Uint8Array> = {}; let total = 0; for (const f of files) { const data = await readFile(safeChild(base, f)); total += data.length; if (total > 20_000_000) throw new Error('Export exceeds 20 MB. Use the project directory directly.'); entries[`${spec.name}/${f}`] = data; } const archive = zipSync(entries); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}.zip"` }); res.end(archive); return; }
      if (['build', 'prepare', 'run', 'eval', 'refine', 'doctor'].includes(action) && req.method === 'POST') {
        const body = await readBody(req); const job: Job = { id: randomUUID(), project: id, kind: action, status: 'running', startedAt: new Date().toISOString(), controller: new AbortController() }; jobs.set(job.id, job);
        const task = async () => {
          if (action === 'build') return buildProject(manifest, join(projectDir, 'generated'), true);
          if (action === 'prepare') return prepareProject(spec, join(projectDir, 'generated'), job.controller.signal);
          if (action === 'run') { if (typeof body.input !== 'string' || !body.input.trim()) throw new Error('Enter an input to run.'); return runProject(spec, join(projectDir, 'generated'), body.input, job.controller.signal); }
          if (action === 'eval') { const cases = await readCases(resolve(projectDir, spec.evaluation.dataset)); const report = await evaluateProject(spec, join(projectDir, 'generated'), cases, { split: body.split || 'all', signal: job.controller.signal, onProgress: (done, total) => { job.progress = { done, total }; } }); await saveReport(join(projectDir, 'reports', `${Date.now()}-${report.id}.json`), report); return report; }
          if (action === 'refine') return refineProject(spec, await inspectGuidance(resolve(projectDir, spec.guidanceDir)), job.controller.signal);
          return Object.fromEntries(await Promise.all(Object.entries(spec.connections).map(async ([key, connection]) => [key, await diagnoseConnection(connection)])));
        };
        void task().then(result => { if (job.controller.signal.aborted) job.status = 'cancelled'; else { job.result = result; job.status = 'completed'; } }).catch(error => { if (job.controller.signal.aborted) job.status = 'cancelled'; else { job.error = sanitizeError(error.message || String(error)); job.status = 'failed'; } });
        return json({ jobId: job.id }, 202);
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error: any) { return json({ error: sanitizeError(error.message || String(error)) }, error.code === 'ENOENT' ? 404 : 400); }
  });
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(activePort, '127.0.0.1', () => { activePort = (server.address() as any).port; res(); }); });
  return { server, url: `http://127.0.0.1:${activePort}/#token=${token}`, token, port: activePort, workspace: root };
}
async function validateGuidanceChange(report: GuidanceReport, path: string, content: string): Promise<GuidanceReport> {
  if (Buffer.byteLength(content, 'utf8') > 64_000) throw new Error('A guidance file may contain at most 64,000 UTF-8 bytes.');
  if (report.issues.some(issue => issue.level === 'error' || ['GUIDANCE_TOTAL_LIMIT', 'GUIDANCE_DEPTH_LIMIT', 'GUIDANCE_SCAN_INCOMPLETE'].includes(issue.code))) throw new Error('Resolve guidance inspection limits or errors before editing.');
  const files = report.files.filter(file => file.path !== path).map(file => ({ path: file.path, content: file.content }));
  files.push({ path, content });
  if (files.length > 100 || files.reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0) > 256_000) throw new Error('Guidance is limited to 100 eligible files and 256,000 total UTF-8 bytes.');
  const temporary = await mkdtemp(join(tmpdir(), 'nb-guidance-validation-'));
  try {
    for (const file of files) { const destination = safeChild(temporary, file.path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, file.content, { flag: 'wx', mode: 0o600 }); }
    const checked = await inspectGuidance(temporary);
    if (!checked.files.some(file => file.path === path) || checked.files.length !== files.length) throw new Error('The edited content is excluded by guidance checks. Remove credentials, binary content, or oversized data.');
    if (checked.issues.some(issue => issue.level === 'error' || issue.code === 'GUIDANCE_CONFLICT')) throw new Error('The proposed guidance contains conflicting ALLOW and DENY directives. Resolve the conflict before saving.');
    return checked;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
async function walk(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['node_modules', '.venv', '__pycache__', '.git'].includes(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.') && entry.name !== '.env.example') continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(root, path)); else files.push(path);
    if (files.length > 2000) throw new Error('Too many files to export.');
  }
  return files.sort();
}
function validReport(r: any): boolean {
  return r && typeof r.id === 'string' && typeof r.createdAt === 'string' && typeof r.configHash === 'string' && ['demo','live'].includes(r.mode) && typeof r.split === 'string' && ['total','passed','reviewed','synthetic','passRate'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= 0) && Array.isArray(r.results) && r.results.every((x: any) => typeof x.id === 'string' && typeof x.input === 'string' && typeof x.output === 'string' && typeof x.passed === 'boolean' && typeof x.durationMs === 'number' && Array.isArray(x.checks) && x.checks.every((c: any) => typeof c.name === 'string' && typeof c.detail === 'string' && typeof c.passed === 'boolean')) && Array.isArray(r.warnings) && r.warnings.every((w: any) => typeof w === 'string');
}
