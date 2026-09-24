import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadScenarios, scenarioFingerprint } from './scenario-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'https://github.com/nimeshbuilds/instrilo';
const site = 'https://nimeshbuilds.github.io/instrilo';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const arrow = '<span aria-hidden="true">↗</span>';
const chevron = '<span aria-hidden="true">→</span>';
const formatDate = value => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value));
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function safeUrl(value) {
  if (typeof value !== 'string' || /[\s\\<>"']/.test(value) || value.startsWith('//') || /^(?!https?:)[a-z]+:/i.test(value)) throw new Error(`Unsupported walkthrough link: ${value}`);
  return escape(value);
}

function codeBlock(code, label = 'Terminal', manual = false) {
  return `<div class="code-block${manual ? ' code-manual' : ''}"><div class="code-bar"><span>${escape(label)}</span><button class="copy-button" type="button" hidden aria-label="Copy ${escape(label)} commands">Copy</button></div><pre tabindex="0"><code>${escape(code)}</code></pre></div>`;
}

function header(prefix) {
  return `<a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><div class="header-inner"><a class="brand" href="${prefix}index.html" aria-label="Instrilo home"><img src="${prefix}assets/icon.svg" width="38" height="38" alt=""><span>Instrilo<small>by nimeshbuilds</small></span></a><nav class="main-nav" aria-label="Main navigation"><a href="${prefix}index.html#quickstarts">Quickstarts</a><a href="${repository}/blob/main/docs/CLI.md">CLI reference</a><a class="github-link" href="${repository}">GitHub ${arrow}</a></nav></div></header>`;
}

function footer(prefix) {
  return `<footer class="site-footer"><div class="footer-inner"><div><a class="brand footer-brand" href="${prefix}index.html"><img src="${prefix}assets/mark.svg" width="42" height="42" alt=""><span>Instrilo</span></a><p>Build with intent. Ship with evidence.</p></div><div class="footer-links"><a href="${repository}">Source code ${arrow}</a><a href="${repository}/blob/main/CONTRIBUTING.md">Contribute ${arrow}</a><a href="${repository}/issues">Get help ${arrow}</a><a href="${repository}/blob/main/LICENSE">Apache-2.0 ${arrow}</a></div><p class="footer-note">An open-source project by <a href="https://github.com/nimeshbuilds">nimeshbuilds</a>.<br>Built for code you can own, inspect, and change.</p></div></footer>`;
}

function page({ title, description, prefix = './', path = '', body, kind = '' }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#244E3A"><link rel="canonical" href="${site}/${path}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${site}/assets/banner.png"><meta property="og:url" content="${site}/${path}"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="${prefix}assets/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="${prefix}assets/styles.css"><script src="${prefix}assets/app.js" defer></script></head>
<body class="${kind}">${header(prefix)}${body}${footer(prefix)}<div class="sr-only" id="copy-announcement" role="status" aria-live="polite"></div></body></html>\n`;
}

function statusBadge(result) {
  if (result?.status === 'passed') return '<span class="status status-passed"><span aria-hidden="true">✓</span> Local steps checked</span>';
  return `<span class="status status-unverified"><span aria-hidden="true">○</span> ${result?.stale ? 'Checks need a refresh' : 'Not yet verified'}</span>`;
}

function card(scenario, result) {
  return `<article class="scenario-card" data-scenario data-category="${escape(scenario.category)}" data-search="${escape([scenario.title, scenario.summary, scenario.category].join(' ').toLowerCase())}"><div class="card-top"><span class="scenario-number">${String(scenario.order).padStart(2, '0')}</span><span class="category">${escape(scenario.category)}</span></div><h3><a href="quickstarts/${scenario.id}/index.html">${escape(scenario.title)}</a></h3><p>${escape(scenario.summary)}</p><div class="card-bottom"><span>${escape(scenario.duration)}</span>${statusBadge(result)}<span class="card-arrow" aria-hidden="true">↗</span></div></article>`;
}

function home(scenarios, results, verification) {
  const categories = [...new Set(scenarios.map(item => item.category))];
  const passed = scenarios.filter(item => results.get(item.id)?.status === 'passed').length;
  const install = 'git clone https://github.com/nimeshbuilds/instrilo.git\ncd instrilo\nnpm ci --ignore-scripts\nnpm run build\nnode dist/cli.js help --all';
  return page({ title: 'Instrilo — Build with intent. Ship with evidence.', description: 'Turn product guidance into an agent you own. Explore ten practical, step-by-step quickstarts for Python, TypeScript, evaluation, model connections, and delivery.', body: `<main id="main">
  <section class="hero wrap" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow"><span class="eyebrow-dot"></span> Open-source agent workbench</p><h1 id="hero-title">Your intent.<br>A working <em>agent.</em></h1><p class="hero-description">Turn your product guidance into code you own. Choose your framework, connect your models, and test the result.</p><div class="hero-actions"><a class="button button-primary" href="quickstarts/${scenarios[0].id}/index.html">Build your first agent ${chevron}</a><a class="button button-text" href="#setup">Set up Instrilo ${chevron}</a></div><p class="hero-note">First guide: no model account needed.</p><p class="hero-note hero-note-secondary">Python + TypeScript <span>·</span> CLI + local app <span>·</span> Apache-2.0</p></div><div class="hero-art" aria-hidden="true"><div class="hero-art-image"></div><div class="art-caption"><span>GUIDANCE → EVIDENCE</span><span>Made to be inspected.</span></div></div></section>
  <div class="workflow wrap" aria-label="The Instrilo workflow"><div><span>01</span><strong>Describe the intent</strong><small>Import guidance or build it together.</small></div><div><span>02</span><strong>Build your agent</strong><small>Own the generated project.</small></div><div><span>03</span><strong>Inspect the evidence</strong><small>Evaluate, review, and replay.</small></div><div><span>04</span><strong>Prepare to deliver</strong><small>Generate artifacts for your platform.</small></div></div>
  <section class="setup-section wrap" id="setup" aria-labelledby="setup-title"><div class="setup-intro"><p class="eyebrow">Start here</p><h2 id="setup-title">A small setup.<br>A clear first step.</h2><p>Install from source, then pick a walkthrough below. Every guide starts in this repository folder.</p><div class="prereq-inline"><strong>Before you start</strong><p>Git, Node.js 22 or newer, and npm.<br>macOS, Linux, or Windows with WSL.<br>Python guides also need Python 3.11–3.13 and uv.</p><div class="resource-links"><a href="https://nodejs.org/en/download">Get Node.js ${arrow}</a><a href="https://docs.astral.sh/uv/getting-started/installation/">Get uv ${arrow}</a><a href="https://learn.microsoft.com/en-us/windows/wsl/install">Set up WSL ${arrow}</a></div></div></div><div class="setup-code">${codeBlock(install, 'Install from source · Bash / zsh')}<p class="code-caption">The final command prints the full command reference. No model account is needed. Dependency installation downloads packages.</p><details class="setup-detail"><summary>Prefer the app or a shorter command?</summary><p>Open the local app from the same repository folder. Use the private session URL printed in your terminal; stop it with Ctrl+C.</p>${codeBlock('node dist/cli.js app --workspace .studio/projects --port 0', 'Launch the app')}<p>Optionally run <code>npm link</code> to enable <code>instrilo</code> and <code>in</code>. In Bash, use <code>command in</code> because <code>in</code> is a reserved word. The guides use <code>node dist/cli.js</code> so a global install is unnecessary.</p></details></div></section>
  <section class="quickstarts-section wrap" id="quickstarts" aria-labelledby="quickstarts-title"><div class="section-heading"><div><p class="eyebrow">The field guide</p><h2 id="quickstarts-title">What will you build first?</h2></div><p>Ten practical paths, from your first local agent to deployment preparation. Follow the commands, then check the result.</p></div><div class="guide-tools" hidden><label class="search-label" for="guide-search"><span class="sr-only">Search quickstarts</span><span aria-hidden="true">⌕</span><input id="guide-search" type="search" placeholder="Find a workflow…" autocomplete="off"></label><div class="category-filters" aria-label="Filter quickstarts by category"><button type="button" data-filter="" aria-pressed="true">All guides</button>${categories.map(category => `<button type="button" data-filter="${escape(category)}" aria-pressed="false">${escape(category)}</button>`).join('')}</div><p class="guide-count" id="guide-count" role="status" aria-live="polite">${scenarios.length} guides</p></div><div class="scenario-grid">${scenarios.map(item => card(item, results.get(item.id))).join('')}</div><div class="empty-state" hidden><h3>No matching guides</h3><p>Try a broader search or select another category.</p><button class="button button-primary" type="button" data-reset-search>Show all guides</button></div></section>
  <section class="evidence-section wrap" id="verification" aria-labelledby="verification-title"><div class="evidence-mark" aria-hidden="true">✓</div><div><p class="eyebrow">Evidence, with its limits</p><h2 id="verification-title">Know what was actually checked.</h2><p>The displayed commands and automated walkthrough checks share one source. ${passed ? `${passed} of ${scenarios.length} guides have passing local checks for their current source.` : 'No current walkthrough verification record is available in this build.'} Account login, paid model calls, and cloud deployment are separate steps, clearly marked in each guide.</p><p class="verification-date">${validDate(verification?.generatedAt) ? `Walkthrough check record: ${formatDate(verification.generatedAt)}. ` : ''}A local pass verifies that path, not the quality or safety of every agent you can build.</p><div class="resource-links"><a href="${repository}/blob/main/docs/VERIFICATION.md">Read the verification record ${arrow}</a><a href="verification.json">Download walkthrough checks ${arrow}</a><a href="${repository}/actions">Inspect CI runs ${arrow}</a></div></div></section>
  <section class="next-section wrap"><div><p class="eyebrow">Room to make it yours</p><h2>Start with a guide.<br>Keep going with the CLI.</h2></div><div><p>Every command has help. The built-in manual explains complete workflows, even when you are offline.</p>${codeBlock('node dist/cli.js explain --list\nnode dist/cli.js help --all', 'Explore the built-in manual')}<div class="resource-links"><a href="${repository}/blob/main/docs/CLI.md">Browse the full CLI reference ${arrow}</a><a href="${repository}/blob/main/docs/ROADMAP.md">See the roadmap ${arrow}</a></div></div></section>
  </main>` });
}

function optionalTextSection(value, title, id) {
  if (!value) return '';
  const paragraphs = (Array.isArray(value) ? value : [value]).map(item => `<p>${escape(typeof item === 'object' ? `${item.title ?? ''} ${item.body ?? item.text ?? ''}` : item)}</p>`).join('');
  return `<section class="guide-section" id="${id}"><h2>${title}</h2>${paragraphs}</section>`;
}

function walkthrough(scenario, result, verification, scenarios) {
  const hasManual = scenario.steps.some(step => step.manualCode);
  const executableCount = scenario.steps.filter(step => step.code).length;
  const stepBody = scenario.steps.map((step, index) => `<section class="guide-step" id="step-${index + 1}"><div class="step-heading"><span class="step-number">${String(index + 1).padStart(2, '0')}</span><h2>${escape(step.title)}</h2></div><p class="step-body">${escape(step.body)}</p>${step.manualCode ? '<p class="manual-label">Manual step · not executed by walkthrough checks</p>' : ''}${step.code || step.manualCode ? codeBlock(step.code ?? step.manualCode, step.manualCode ? 'Optional manual commands' : `Step ${index + 1} · Terminal`, Boolean(step.manualCode)) : ''}<div class="expected"><span>What to expect</span><p>${escape(step.expected)}</p></div></section>`).join('');
  const nextLinks = (scenario.next?.length ? scenario.next : [{ label: 'Explore all quickstarts', url: '../../index.html#quickstarts' }]).map(link => ({ ...link, url: scenarios.some(item => `#${item.id}` === link.url) ? `../${link.url.slice(1)}/index.html` : link.url }));
  return page({ title: `${scenario.title} — Instrilo quickstart`, description: scenario.summary, prefix: '../../', path: `quickstarts/${scenario.id}/`, kind: 'walkthrough-page', body: `<main id="main"><div class="guide-heading wrap"><a class="back-link" href="../../index.html#quickstarts"><span aria-hidden="true">←</span> All quickstarts</a><div class="guide-title-row"><div><p class="eyebrow">Quickstart ${String(scenario.order).padStart(2, '0')} <span class="eyebrow-divider">/</span> ${escape(scenario.category)}</p><h1>${escape(scenario.title)}</h1><p class="guide-summary">${escape(scenario.summary)}</p><div class="guide-metadata"><span>${escape(scenario.duration)}</span>${statusBadge(result)}${hasManual ? '<span>Includes optional manual steps</span>' : ''}</div></div><aside class="outcome"><span class="outcome-label">You’ll finish with</span><p>${escape(scenario.outcome)}</p></aside></div></div>
  <div class="guide-layout wrap"><aside class="guide-sidebar"><nav aria-label="On this page"><p class="eyebrow">On this page</p><a href="#before-you-start">Before you start</a>${scenario.steps.map((step, i) => `<a href="#step-${i + 1}"><span>${String(i + 1).padStart(2, '0')}</span>${escape(step.title)}</a>`).join('')}<a href="#tested-scope">What this guide verifies</a><a href="#troubleshooting">If something goes wrong</a><a href="#next-steps">Keep going</a></nav><a class="source-link" href="${repository}/blob/main/website/scenarios/${String(scenario.order).padStart(2, '0')}-${scenario.id}.json">View this guide’s source ${arrow}</a></aside><article class="guide-content"><section class="guide-section before-you-start" id="before-you-start"><h2>Before you start</h2><p>Complete the <a href="../../index.html#setup">source installation</a>, then run each command below from the cloned <code>instrilo</code> repository folder. Use Bash, and keep the same terminal session throughout. In a zsh terminal, run <code>bash</code> first.</p><ul class="prerequisite-list">${scenario.prerequisites.map(item => `<li>${escape(item)}</li>`).join('')}</ul><p class="local-note">These examples use their own folders under <code>.studio/tutorials/</code>. If a folder already exists, keep it as a backup before starting again; project creation will not silently replace it.</p></section>${stepBody}<section class="guide-section tested-scope" id="tested-scope"><p class="eyebrow">The check record</p><h2>What this guide verifies</h2><div class="scope-status">${statusBadge(result)}<span>${result?.status === 'passed' && validDate(verification?.generatedAt) ? formatDate(verification.generatedAt) : 'No matching current pass recorded'}</span></div><p>${escape(scenario.verification.scope)}</p><p>${result?.status === 'passed' ? `${result.steps ?? executableCount} executable command ${Number(result.steps ?? executableCount) === 1 ? 'block was' : 'blocks were'} checked against the matching source. ` : 'Executable commands are included in the walkthrough runner; check CI for its latest result. '}${hasManual ? 'Optional manual commands were excluded from those checks.' : 'The scope below describes what a pass does and does not establish.'}</p><ul>${scenario.verification.limitations.map(item => `<li>${escape(item)}</li>`).join('')}</ul><div class="resource-links"><a href="../../verification.json">Download walkthrough checks ${arrow}</a><a href="${repository}/actions">Inspect the CI evidence ${arrow}</a></div></section>${optionalTextSection(scenario.cleanup, 'Clean up after the guide', 'cleanup')}<section class="guide-section troubleshooting" id="troubleshooting"><h2>If something goes wrong</h2>${scenario.troubleshooting ? optionalTextSection(scenario.troubleshooting, 'Guide-specific notes', 'guide-troubleshooting') : ''}<details><summary>The CLI or a dependency is missing</summary><p>Return to <a href="../../index.html#setup">setup</a> and check <code>node --version</code> (22 or newer). Run commands from the repository root. A Python guide also requires Python 3.11–3.13 and <code>uv</code>. Read the error before repeating a package installation.</p></details><details><summary>A project already exists, or its build is out of date</summary><p>Use a fresh guide workspace or move your previous tutorial folder to a backup. After intentionally editing an existing project, review <code>node dist/cli.js generation plan PROJECT</code> before rebuilding. Replace <code>PROJECT</code> with that guide’s project path.</p></details><details><summary>A live account, model, or deployment step fails</summary><p>Those steps depend on your account, credentials, permissions, network, and platform. Read the guide’s limitations and the generated platform documentation. <a href="${repository}/blob/main/docs/AUTHENTICATION.md">Provider setup</a> and <a href="${repository}/blob/main/docs/DEPLOYMENT.md">deployment guidance</a> explain supported paths. Never paste credentials or a private local app URL into an issue.</p></details><p>Still stuck? <a href="${repository}/issues">Open an issue</a> with your OS, Node version, guide title, step number, and a redacted error.</p></section><section class="guide-section guide-next" id="next-steps"><p class="eyebrow">Keep going</p><h2>Make the next step yours.</h2><div class="next-links">${nextLinks.map(link => `<a href="${safeUrl(link.url)}">${escape(link.label)} ${chevron}</a>`).join('')}<a href="../../index.html#quickstarts">Browse all ${scenarios.length} quickstarts ${chevron}</a></div></section></article></div></main>` });
}

export async function buildSite(outputDirectory = resolve(root, '_site'), options = {}) {
  const scenarios = await loadScenarios();
  if (!Array.isArray(scenarios) || scenarios.length !== 10) throw new Error('The website requires exactly ten validated scenarios.');
  let verification = options.verification;
  if (!Object.hasOwn(options, 'verification')) {
    try { verification = JSON.parse(await readFile(join(root, 'website', 'verification.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const results = new Map();
  for (const scenario of scenarios) {
    const record = verification?.scenarios?.find(item => item.id === scenario.id);
    if (record?.status === 'passed' && record.scenarioHash === await scenarioFingerprint(scenario)) results.set(scenario.id, record);
    else if (record) results.set(scenario.id, { stale: true });
  }
  // Only replace the build directory selected by the caller, never source files.
  const output = resolve(outputDirectory);
  if (output === root || root.startsWith(`${output}/`) || output === join(root, 'website') || output === join(root, 'assets')) throw new Error('Unsafe website output directory.');
  await mkdir(output, { recursive: true });
  await mkdir(join(output, 'assets'), { recursive: true });
  await mkdir(join(output, 'quickstarts'), { recursive: true });
  for (const asset of ['icon.svg', 'mark.svg', 'wordmark.svg', 'banner.png']) await copyFile(join(root, 'assets', 'brand', asset), join(output, 'assets', asset));
  for (const asset of ['styles.css', 'app.js']) await copyFile(join(root, 'website', asset), join(output, 'assets', asset));
  await writeFile(join(output, 'index.html'), home(scenarios, results, verification));
  for (const scenario of scenarios) {
    const directory = join(output, 'quickstarts', scenario.id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), walkthrough(scenario, results.get(scenario.id), verification, scenarios));
  }
  await writeFile(join(output, '404.html'), page({ title: 'Page not found — Instrilo', description: 'Find your next Instrilo quickstart.', prefix: `${site}/`, body: `<main id="main" class="not-found wrap"><p class="eyebrow">404 · Page not found</p><h1>Let’s find your<br>next step.</h1><p>This page may have moved. The field guide is a good place to start.</p><a class="button button-primary" href="${site}/#quickstarts">Explore the quickstarts ${chevron}</a></main>` }));
  const publicVerification = {
    schemaVersion: 1, generatedAt: validDate(verification?.generatedAt) ? verification.generatedAt : null,
    platform: typeof verification?.platform === 'string' ? verification.platform : null,
    node: typeof verification?.node === 'string' ? verification.node : null,
    scenarios: scenarios.map(scenario => {
      const result = results.get(scenario.id), passed = result?.status === 'passed';
      return { id: scenario.id, title: scenario.title, status: passed ? 'passed' : 'unverified',
        steps: passed ? result.steps : 0, manualSteps: scenario.steps.filter(step => step.manualCode).length,
        scope: scenario.verification.scope, limitations: scenario.verification.limitations,
        durationMs: passed ? result.durationMs : null, scenarioHash: passed ? result.scenarioHash : null };
    }),
  };
  await writeFile(join(output, 'verification.json'), `${JSON.stringify(publicVerification, null, 2)}\n`);
  await writeFile(join(output, '.nojekyll'), '');
  await writeFile(join(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);
  await writeFile(join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['', ...scenarios.map(item => `quickstarts/${item.id}/`)].map(path => `<url><loc>${site}/${path}</loc></url>`).join('')}</urlset>\n`);
  return { output, pages: scenarios.length + 2, scenarios: scenarios.length, verified: [...results.values()].filter(item => item.status === 'passed').length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await buildSite();
  console.log(`Built ${result.pages} static pages in ${result.output}; ${result.verified}/${result.scenarios} walkthroughs have matching passing checks.`);
}
