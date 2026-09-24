import { constants, readFileSync } from 'node:fs';
import { lstat, mkdir, realpath, writeFile, chmod } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Artifact, Framework, GuidanceReport, Language, ProjectSpec, ProviderKind } from './types.js';
import { frameworkCode } from './templates/frameworks.js';

export const frameworkCapabilities: { framework: Framework; languages: Language[]; providers: ProviderKind[]; notes: string }[] = [
  { framework: 'native', languages: ['python', 'typescript'], providers: ['openai', 'anthropic', 'xai', 'gateway', 'ollama', 'demo', 'codex-cli', 'claude-code', 'grok-cli'], notes: 'Bounded tool loop. CLI sessions are local-only, without HTTP tools.' },
  { framework: 'langgraph', languages: ['python', 'typescript'], providers: ['openai', 'xai', 'gateway', 'ollama'], notes: 'Actual StateGraph with model/tool nodes; shared provider transport. Add a durable checkpointer before promising cross-process resume.' },
  { framework: 'openai-agents', languages: ['python', 'typescript'], providers: ['openai', 'xai', 'gateway'], notes: 'Actual Agents SDK Runner with OpenAI-compatible Chat Completions endpoints.' },
  { framework: 'crewai', languages: ['python'], providers: ['openai'], notes: 'Actual Crew/Agent/Task with guarded HTTP tools. Python only.' },
];
const template = (name: string) => readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const artifact = (path: string, content: string, executable = false): Artifact => ({ path, content, ...(executable ? { executable } : {}) });
const indent = (value: string, n: number) => value.split('\n').map(line => ' '.repeat(n) + line).join('\n');
const cliKinds = new Set(['codex-cli', 'claude-code', 'grok-cli']);

function requiredEnv(spec: ProjectSpec): string[] {
  const names = new Set<string>();
  const auth = spec.connections[spec.roles.runtime].auth;
  for (const value of [auth.env, auth.clientIdEnv, auth.clientSecretEnv, ...spec.agent.tools.map(t => t.authEnv)]) if (value) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid environment variable reference: ' + value);
    names.add(value);
  }
  return [...names].sort();
}
function validateGeneration(spec: ProjectSpec): void {
  const runtime = spec.connections[spec.roles.runtime];
  if (!runtime) throw new Error('Runtime connection does not exist');
  const capability = frameworkCapabilities.find(c => c.framework === spec.framework)!;
  if (!capability?.languages.includes(spec.language) || !capability.providers.includes(runtime.kind)) throw new Error(`Unsupported runtime combination: ${spec.framework}/${spec.language}/${runtime.kind}`);
  if (cliKinds.has(runtime.kind) && (spec.delivery.target !== 'local' || spec.framework !== 'native' || spec.agent.tools.length)) throw new Error('CLI runtimes require native framework, local target, and no HTTP tools');
  if (runtime.kind === 'demo' && spec.delivery.target !== 'local') throw new Error('Demo runtime cannot be deployed');
  if (['cloud-run', 'azure-container-apps', 'docker'].includes(spec.delivery.target) && spec.security.inbound.mode !== 'jwt') throw new Error('Container network binding requires inbound JWT authentication');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(spec.name)) throw new Error('Project name must be a lowercase slug (1–63 characters)');
  const inbound = spec.security.inbound;
  if (inbound.mode === 'jwt') {
    if (!inbound.issuer || !inbound.audience || !inbound.jwksUrl || !inbound.algorithms.length || inbound.algorithms.some(a => !['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'].includes(a))) throw new Error('JWT requires issuer, audience, JWKS URL and explicit asymmetric algorithms');
  }
}

export function generateArtifacts(spec: ProjectSpec, guidance: GuidanceReport): Artifact[] {
  validateGeneration(spec);
  const py = spec.language === 'python'; const ext = py ? 'py' : 'ts';
  const envNames = requiredEnv(spec);
  // Dedicated runtime shape: no builder/judge connection details or dangling role IDs.
  const runtimeSpec = {
    schemaVersion: spec.schemaVersion, name: spec.name, description: spec.description,
    language: spec.language, framework: spec.framework,
    connections: { runtime: spec.connections[spec.roles.runtime] }, roles: { runtime: 'runtime' },
    agent: spec.agent, security: spec.security, delivery: spec.delivery,
  };
  const output: Artifact[] = [
    artifact('agent-spec.json', json(runtimeSpec)),
    artifact('guidance.md', guidance.combined),
    artifact('guidance-manifest.json', json(guidance.files.map(({ path, sha256 }) => ({ path, sha256 })))),
    artifact(`runtime.${ext}`, runtimeTemplate(spec)),
    artifact(`agent.${ext}`, template(`agent.${ext}.tpl`).replace(py ? '    # FRAMEWORK_IMPLEMENTATION' : '  // FRAMEWORK_IMPLEMENTATION', indent(frameworkCode(spec.framework, spec.language), py ? 4 : 2))),
    artifact(`server.${ext}`, template(`server.${ext}.tpl`)),
    artifact(`mcp_server.${ext}`, template(`mcp_server.${ext}.tpl`)),
    artifact('.env.example', '# Copy names into your process environment or secret manager. Never commit actual secrets.\n' + envNames.map(n => `${n}=\n`).join('') + '\nAGENT_SCOPES=\nAGENT_APPROVALS_JSON=[]\n'),
    artifact('.gitignore', '.env\n.env.*\n!.env.example\n.venv/\nnode_modules/\ndist/\n__pycache__/\n*.pyc\nartifacts/\n.deployment/\n'),
    artifact('.dockerignore', '.env\n.env.*\n.git\n.venv\nnode_modules\n__pycache__\n*.pyc\nartifacts\n.deployment\nagent-studio.yaml\nbuild-lock.json\nevals\nhosts\n'),
    artifact('evals/cases.jsonl', json({ id: 'replace-with-reviewed-case', input: 'Replace with a real task.', expected: 'Replace with a human-approved answer.', source: 'synthetic', split: 'development' }).replace(/\n\s*/g, '') + '\n'),
    artifact('evals/rubric.md', '# Review and calibrate this draft rubric\n\nScore task correctness, grounding, tool choice, and adherence to boundaries. Check forbidden actions with deterministic tests. A judge score is evidence, not proof. Label test examples reviewed only after a person checks them. Keep holdout cases separate.\n'),
    artifact('README.md', readme(spec, envNames)),
    artifact('DEPLOYMENT.md', deploymentGuide(spec)),
    artifact('SECURITY.md', securityGuide()),
    artifact('deployment-plan.json', json({ target: spec.delivery.target, status: 'generated-not-deployed', prerequisites: ['Review instructions and tools', 'Run evaluations against reviewed cases', 'Configure credentials using environment or secret manager', 'Run target preflight', 'Inspect infrastructure changes'], region: spec.delivery.region ?? null, auth: spec.security.inbound.mode, secretEnvironmentNames: envNames })),
  ];
  if (spec.delivery.hosts.includes('chatgpt')) {
    output.push(artifact(`mcp_http.${ext}`, template(`mcp_http.${ext}.tpl`)));
    output.find(f => f.path === '.env.example')!.content += '\n# Remote MCP: configure JWT audience to match this exact HTTPS resource URL.\nPUBLIC_MCP_URL=https://YOUR_MCP_HOST/mcp\nMCP_ALLOWED_ORIGINS=\n';
  }
  if (py) {
    const deps = ['httpx==0.28.1', 'jsonschema>=4.23,<5', 'fastapi>=0.115,<1', 'uvicorn>=0.30,<1', 'PyJWT[crypto]>=2.10,<3', spec.framework === 'crewai' ? 'mcp>=1.28.1,<1.29' : 'mcp>=1.30,<2'];
    if (spec.framework === 'langgraph') deps.push('langgraph==1.2.12');
    if (spec.framework === 'openai-agents') deps.push('openai-agents==0.22.3');
    if (spec.framework === 'crewai') deps.push('crewai==1.15.22');
    if (spec.delivery.target === 'aws-agentcore') deps.push('boto3>=1.40,<2');
    output.push(artifact('pyproject.toml', `[project]\nname = ${JSON.stringify(spec.name)}\nversion = "0.1.0"\nrequires-python = ">=3.11,<3.14"\ndependencies = ${json(deps).trim()}\n\n[tool.uv]\npackage = false\n`));
    output.push(artifact('tests/test_contract.py', `import unittest\nfrom runtime import approval_digest, context\n\nclass ContractTests(unittest.TestCase):\n    def test_approval_is_bound_to_arguments(self):\n        self.assertNotEqual(approval_digest("write", {"id": 1}), approval_digest("write", {"id": 2}))\n    def test_no_implicit_permissions(self):\n        ctx = context([], [])\n        self.assertEqual(ctx["scopes"], set())\n        self.assertEqual(ctx["approvals"], set())\n\nif __name__ == "__main__": unittest.main()\n`));
  } else {
    const dependencies: Record<string, string> = { ajv: '^8.17.1', jose: '^6.1.0', '@modelcontextprotocol/sdk': '1.30.1', zod: '^4.1.0' };
    if (spec.framework === 'langgraph') dependencies['@langchain/langgraph'] = '1.4.17';
    if (spec.framework === 'openai-agents') dependencies['@openai/agents'] = '0.18.0';
    if (spec.delivery.target === 'aws-agentcore') dependencies['@aws-sdk/client-secrets-manager'] = '^3.900.0';
    output.push(artifact('package.json', json({ name: spec.name, version: '0.1.0', private: true, type: 'module', engines: { node: '>=22' }, scripts: { build: 'tsc', check: 'tsc --noEmit', start: 'node dist/server.js', dev: 'tsx server.ts', invoke: 'tsx agent.ts', test: 'tsx --test tests/*.test.ts', mcp: 'tsx mcp_server.ts', ...(spec.delivery.hosts.includes('chatgpt') ? { 'mcp:http': 'tsx mcp_http.ts' } : {}) }, dependencies, devDependencies: { typescript: '^5.9.2', tsx: '^4.20.5', '@types/node': '^22.18.0' } })));
    output.push(artifact('tsconfig.json', json({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, esModuleInterop: true, skipLibCheck: true, outDir: 'dist', rootDir: '.', resolveJsonModule: true }, include: ['*.ts'], exclude: ['tests'] })));
    // Compiled server resolves JSON/Markdown beside dist files, copied after compilation in container/start instructions.
    output.push(artifact('tests/contract.test.ts', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { approvalDigest, context } from '../runtime.js';\ntest('approval binds exact arguments', () => assert.notEqual(approvalDigest('write', { id: 1 }), approvalDigest('write', { id: 2 })));\ntest('no implicit permission', () => { const c = context([], []); assert.equal(c.scopes.size, 0); assert.equal(c.approvals.size, 0); });\n`));
  }
  output.push(...hostArtifacts(spec));
  if (spec.delivery.target !== 'local') output.push(...containerArtifacts(spec));
  if (spec.delivery.target === 'aws-agentcore') output.push(...awsArtifacts(spec, envNames));
  if (spec.delivery.target === 'cloud-run') output.push(...gcpArtifacts(spec, envNames));
  if (spec.delivery.target === 'azure-container-apps') output.push(...azureArtifacts(spec, envNames));
  return output;
}

export async function writeArtifacts(outputDir: string, artifacts: Artifact[], options: { overwrite?: boolean } = {}): Promise<string[]> {
  const root = resolve(outputDir);
  const seen = new Set<string>();
  // Validate every path and conflict before writing any artifact.
  for (const file of artifacts) {
    if (!file.path || isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Unsafe artifact path: ' + file.path);
    const absolute = resolve(root, file.path);
    if (!absolute.startsWith(root + sep) || seen.has(absolute)) throw new Error('Duplicate or escaping artifact path: ' + file.path);
    seen.add(absolute);
    for (let cursor = absolute; ; cursor = dirname(cursor)) {
      try { const stat = await lstat(cursor); if (stat.isSymbolicLink()) throw new Error('Refusing symbolic-link output: ' + cursor); if (cursor === absolute && (!options.overwrite || !stat.isFile())) throw new Error('Refusing to overwrite existing output: ' + cursor); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (cursor === root || dirname(cursor) === cursor) break;
    }
  }
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const written: string[] = [];
  for (const file of artifacts) {
    const absolute = join(root, file.path); await mkdir(dirname(absolute), { recursive: true });
    const canonicalParent = await realpath(dirname(absolute));
    if (relative(canonicalRoot, canonicalParent).startsWith('..')) throw new Error('Output escaped root');
    await writeFile(absolute, file.content, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (options.overwrite ? constants.O_TRUNC : constants.O_EXCL), mode: file.executable ? 0o755 : 0o644 });
    if (file.executable) await chmod(absolute, 0o755);
    written.push(absolute);
  }
  return written;
}

function readme(spec: ProjectSpec, names: string[]): string {
  const py = spec.language === 'python';
  return `# ${spec.name}\n\n${spec.description}\n\nGenerated ${spec.language} project using **${spec.framework}**. This is executable source, not a deployed service or a certification of quality.\n\n## Run locally\n\n${py ? 'Install Python 3.11–3.13 and uv. Run `uv sync`, then `uv lock` and commit the resulting lockfile.\n\n```sh\nuv run python agent.py --input "Your task"\nuv run python server.py\nuv run python -m unittest discover -s tests\n```' : 'Install Node.js 22+. Run `npm install`, then commit the resulting package-lock.json.\n\n```sh\nnpx tsx agent.ts --input "Your task"\nnpx tsx server.ts\nnpm run check\nnpm test\n```\n\nTo run compiled files: `npm run build`, copy `agent-spec.json` and `guidance.md` into `dist/`, then `npm start`.'}\n\nSet credentials in the launching process: ${names.length ? names.map(n => '`' + n + '`').join(', ') : 'none for this configuration'}. \`.env.example\` is a name template; it is not automatically loaded. CLI adapters use the installed tool’s own login. Do not copy subscription tokens into API-key fields.\n\n## Contract\n\nThe CLI accepts \`--input TEXT\` and prints one JSON object with \`output\`, \`trace\`, and \`usage\`. \`POST /invocations\` accepts \`{"input":"..."}\` and returns the same. \`GET /ping\` returns health. JWT requests send Authorization: Bearer; local unauthenticated mode binds loopback.\n\n## Engineering loop\n\nReview guidance.md and agent-spec.json. Replace draft evals/cases.jsonl with reviewed examples and reserve holdouts. Use the studio's evaluation command against this generated project; passing synthetic cases is not a production readiness claim. Test tool failure, missing scopes, missing approval, timeouts, prompt injection, and cost limits.\n\n## Approval and authorization\n\nTools are fixed HTTP endpoints. Their inputs are validated against JSON Schema. A tool requiring approval refuses until its exact call SHA256 appears in trusted \`agent_approvals\` JWT claims, or local operator \`AGENT_APPROVALS_JSON\`. Obtain the digest from the denied call, review its exact arguments, then approve through a trusted operator workflow. Never let an LLM or request body grant its own approvals/scopes. This starter implements enforcement, not a full approval inbox. See SECURITY.md.\n\nThe selected framework actually runs the agent. LangGraph uses model/tool nodes; this starter does not configure persistent checkpoints. OpenAI Agents uses Runner. CrewAI uses Crew/Agent/Task. Native uses a bounded loop. Tool and model steps have explicit budgets. Local CLI providers have no portable HTTP tools.\n\nSee DEPLOYMENT.md, deployment-plan.json, and hosts/ for delivery. Generated scripts have not been executed.\n`;
}
function securityGuide(): string { return `# Security boundaries\n\nJWT mode validates asymmetric signatures through the configured JWKS, issuer, audience, expiry, subject, required scopes and optional tenant claim. Claims come only from the verified token. No request-body authorization override exists. Tenant claim presence is not database row-level isolation: tools must enforce tenant-specific access independently.\n\nHTTP tool URLs and methods are operator configured; the model supplies validated arguments only. Redirects are disabled. Use HTTPS except for loopback development. Model-facing tool output is untrusted data. Scope and approval checks occur before dispatch. Approval digests authorize one exact argument value, but this starter has no durable one-time approval ledger; use a trusted approval issuer, short-lived claims and idempotent tool APIs before production writes.\n\nThe local CLI and MCP entrypoints trust the operating-system user. They inherit that user's environment. Keep hosts local and review every tool. JWT enforcement protects HTTP, not someone who can modify or execute the source locally.\n\nNever commit secrets or bake them into images. Use provider credentials from environment references and a cloud secret manager. Do not extract host application credential stores. Native OAuth supports client_credentials, not interactive user OAuth/PKCE. Token lifetime refresh is performed for each provider request in native mode; framework SDKs resolve a token per agent run.\n\nAgentCore IAM mode assumes invocation is behind the AgentCore IAM endpoint; PLATFORM_AUTH=aws-iam must never be used for a public standalone container. JWT mode should be used for other network deployments.\n\nThe included scope, timeout, step and output limits are guardrails, not a formal isolation proof. Add rate limits, concurrency limits, idempotency keys, retention policies, durable checkpoints and domain-specific authorization before production use.\n`; }
function deploymentGuide(spec: ProjectSpec): string { return `# Deployment\n\nSelected runtime target: **${spec.delivery.target}**. Generated only; no resources have been provisioned.\n\nHosting and host integration are separate: AWS/GCP/Azure run the service; Codex/Claude Desktop/Claude Code/ChatGPT are client surfaces. The local MCP bridge is stdio. ChatGPT uses the generated authenticated mcp_http entrypoint, hosted separately at a public HTTPS /mcp endpoint; an arbitrary /invocations endpoint is not an MCP server. See hosts/chatgpt.md when selected.\n\nReview deployment-plan.json, run the project and evaluations, then inspect scripts before executing them. Cloud scripts require installed provider CLIs, a signed-in operator and explicitly configured secret references. They perform billable deployments only when you run them. They do not bypass account IAM or provider authorization.\n\nAgentCore containers use linux/arm64, ECR, port 8080, /ping and /invocations. Cloud Run images use linux/amd64 and PORT. Azure Container Apps uses configured targetPort and managed identity/secret references. Regional availability, model permissions, quota, SDK/runtime support and IAM must be checked for the actual account.\n\nAgentCore also offers direct CodeZip deployments, but this project's AWS deployment adapter intentionally generates the container route. AgentCore OAuth requires an OIDC discovery URL and forwarded Authorization header; the app still verifies its JWT.\n\nReferences: [AgentCore contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html), [AgentCore IAM](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html), [AgentCore JWT](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html), [Cloud Run contract](https://docs.cloud.google.com/run/docs/container-contract), [Azure ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-how-to).\n`; }

function hostArtifacts(spec: ProjectSpec): Artifact[] {
  const py = spec.language === 'python';
  const command = py ? 'uv' : 'node';
  const args = py ? ['run', '--directory', '/ABSOLUTE/PATH/TO/PROJECT', 'python', '/ABSOLUTE/PATH/TO/PROJECT/mcp_server.py'] : ['/ABSOLUTE/PATH/TO/PROJECT/dist/mcp_server.js'];
  const guide = `# Host integration\n\nReplace /ABSOLUTE/PATH/TO/PROJECT in the example configuration with this project's actual path. ${py ? 'Run uv sync first.' : 'Run npm install && npm run build and copy agent-spec.json and guidance.md into dist first.'} Configure credentials in the host process environment; do not paste secrets into committed MCP configuration. The stdio bridge executes locally as that host user.\n\nRestart/reload the host after merging configuration. These are example fragments, not automatic host installers.\n`;
  const out = [artifact('hosts/README.md', guide)];
  const instructions = `# ${spec.name}\n\nFollow guidance.md and the runtime specification. Respect input/output contracts, tool scopes, approval requirements, and step budgets. Run the project's contract tests and reviewed evaluation suite when modifying behavior. Never classify synthetic cases as reviewed or report generated artifacts as deployed. Do not read or reuse credentials from another application's private files.\n`;
  for (const host of spec.delivery.hosts) {
    if (host === 'codex') out.push(artifact('AGENTS.md', instructions), artifact('hosts/codex-config.toml', `[mcp_servers.${spec.name.replaceAll('-', '_')}]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`));
    if (host === 'claude-code') out.push(artifact('CLAUDE.md', instructions), artifact('hosts/claude-code.mcp.json', json({ mcpServers: { [spec.name]: { command, args } } })));
    if (host === 'claude-desktop') out.push(artifact('hosts/claude-desktop.json', json({ mcpServers: { [spec.name]: { command, args } } })));
    if (host === 'chatgpt') out.push(artifact('hosts/chatgpt.md', `# ChatGPT remote MCP connection\n\nThis project includes an actual authenticated Streamable HTTP MCP server at /mcp: mcp_http.${py ? 'py' : 'ts'}. It advertises invoke_agent, runs the selected framework, and exposes OAuth protected-resource metadata at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp. It is distinct from the local stdio bridge and the REST /invocations server.\n\n1. Configure inbound JWT in the source manifest. Set issuer and JWKS URL to an existing HTTPS OAuth/OIDC authorization service and audience to the exact public MCP resource URL, such as https://agents.example.com/mcp. Rebuild the project.\n2. Set PUBLIC_MCP_URL to that exact URL. Configure provider credentials through environment references or secret management. JWT requiredScopes and trusted agent_approvals claims govern the invoked agent. The MCP wrapper never trusts scopes or approvals in tool arguments.\n3. Run ${py ? '`uv run python mcp_http.py`' : '`npm run mcp:http`'} locally with appropriate configuration, ${spec.delivery.target === 'local' ? 'For container hosting, select a supported API-backed cloud/container target and rebuild to emit Dockerfile.mcp.' : 'Or build Dockerfile.mcp for a separately hosted HTTPS endpoint.'} Hosting scripts default to the REST service; adapt the entrypoint and protocol deliberately for MCP. Preserve the public Host at the reverse proxy. Set MCP_ALLOWED_ORIGINS only to trusted browser origins that need CORS.\n4. Configure the external authorization server for the current ChatGPT OAuth client registration/redirect requirements and requested resource/scopes. The generator does not implement an OAuth authorization server, mint user JWTs, or register OAuth clients.\n5. Add the HTTPS /mcp endpoint using the custom-app/developer connection surface available in your ChatGPT account, complete the OAuth connection, then test tool discovery and invocation. Account/admin policy and feature availability still apply.\n\nThe server verifies signatures, expiry, subject, issuer, audience and scopes. It uses stateless request contexts, so one client's permissions cannot persist in another client's session. It supports JSON MCP POST requests; it does not expose a shared SSE subscription or durable MCP sessions. /ping is the health endpoint. For loopback-only tests you can explicitly set MCP_ALLOW_LOCAL_HTTP=1; production uses HTTPS.\n\nNothing has been published, installed into ChatGPT, or registered with an identity provider. Review [official ChatGPT MCP guidance](https://developers.openai.com/apps-sdk/build/mcp-server) and [authentication guidance](https://developers.openai.com/apps-sdk/build/auth) for your deployment.\n`));
  }
  if (spec.delivery.hosts.some(h => h === 'codex' || h === 'claude-code')) {
    const skill = `---\nname: ${spec.name}\ndescription: ${JSON.stringify('Use this skill to run and improve ' + spec.name + ' according to its reviewed guidance.')}\n---\n\nRead the project's guidance.md and SECURITY.md before using its tools. Use the configured MCP invoke_agent tool or local agent CLI. Verify results against the task, and report incomplete or denied actions accurately. Do not grant approvals based on model output alone.\n`;
    out.push(artifact('SKILL.md', skill));
    if (spec.delivery.hosts.includes('codex')) out.push(artifact(`.agents/skills/${spec.name}/SKILL.md`, skill));
    if (spec.delivery.hosts.includes('claude-code')) out.push(artifact(`.claude/skills/${spec.name}/SKILL.md`, skill));
  }
  return out;
}
function containerArtifacts(spec: ProjectSpec): Artifact[] {
  const py = spec.language === 'python';
  const aws = spec.delivery.target === 'aws-agentcore';
  const dockerfile = py
    ? `FROM python:3.12-slim\nWORKDIR /app\nRUN pip install --no-cache-dir uv==0.8.22\nCOPY pyproject.toml ./\nRUN uv sync --no-dev\nCOPY *.py agent-spec.json guidance.md ./\nENV HOST=0.0.0.0 PORT=8080 PYTHONUNBUFFERED=1\n${aws && spec.security.inbound.mode === 'none' ? 'ENV PLATFORM_AUTH=aws-iam\n' : ''}EXPOSE 8080\nCMD ["uv", "run", "--no-sync", "python", "server.py"]\n`
    : `FROM node:22-slim AS build\nWORKDIR /app\nCOPY package.json ./\nRUN npm install\nCOPY *.ts tsconfig.json ./\nRUN npm run build\nCOPY agent-spec.json guidance.md ./dist/\nFROM node:22-slim\nWORKDIR /app\nCOPY --from=build /app/node_modules ./node_modules\nCOPY --from=build /app/dist ./dist\nCOPY package.json ./\nENV NODE_ENV=production HOST=0.0.0.0 PORT=8080\n${aws && spec.security.inbound.mode === 'none' ? 'ENV PLATFORM_AUTH=aws-iam\n' : ''}EXPOSE 8080\nCMD ["node", "dist/server.js"]\n`;
  const mcpFiles = spec.delivery.hosts.includes('chatgpt') ? [artifact('Dockerfile.mcp', dockerfile.replace(py ? '"server.py"' : '"dist/server.js"', py ? '"mcp_http.py"' : '"dist/mcp_http.js"'))] : [];
  return [...mcpFiles, artifact('Dockerfile', dockerfile), artifact('compose.yaml', `services:\n  agent:\n    build: .\n    ports:\n      - "127.0.0.1:${spec.delivery.port}:8080"\n    env_file:\n      - .env\n    restart: unless-stopped\n`), artifact('deploy/docker.sh', '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")/.."\ntest -f .env || { echo "Create a private .env from .env.example" >&2; exit 1; }\ndocker compose up --build -d\n', true)];
}
function awsArtifacts(spec: ProjectSpec, envNames: string[]): Artifact[] {
  const runtimeName = spec.name.replaceAll('-', '_');
  const jwt = spec.security.inbound.mode === 'jwt';
  const config: Record<string, unknown> = {
    agentRuntimeName: runtimeName,
    agentRuntimeArtifact: { containerConfiguration: { containerUri: 'REPLACE_ECR_IMAGE_URI' } },
    roleArn: 'REPLACE_EXECUTION_ROLE_ARN',
    networkConfiguration: { networkMode: 'PUBLIC' },
    protocolConfiguration: { serverProtocol: 'HTTP' },
    environmentVariables: { HOST: '0.0.0.0', PORT: '8080', ...(!jwt ? { PLATFORM_AUTH: 'aws-iam' } : {}), ...Object.fromEntries(envNames.map(n => [n + '_SECRET_ARN', 'REPLACE_SECRET_ARN'])) },
    lifecycleConfiguration: { idleRuntimeSessionTimeout: 300, maxLifetime: 3600 },
  };
  if (jwt) {
    config.authorizerConfiguration = { customJWTAuthorizer: { discoveryUrl: spec.security.inbound.issuer!.replace(/\/$/, '') + '/.well-known/openid-configuration', allowedAudience: [spec.security.inbound.audience] } };
    config.requestHeaderConfiguration = { requestHeaderAllowlist: ['Authorization'] };
  }
  const trust = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'bedrock-agentcore.amazonaws.com' }, Action: 'sts:AssumeRole', Condition: { StringEquals: { 'aws:SourceAccount': 'REPLACE_ACCOUNT_ID' }, ArnLike: { 'aws:SourceArn': 'arn:aws:bedrock-agentcore:REPLACE_REGION:REPLACE_ACCOUNT_ID:*' } } }] };
  const policy = { Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], Resource: 'REPLACE_ECR_REPOSITORY_ARN' },
    { Effect: 'Allow', Action: ['ecr:GetAuthorizationToken'], Resource: '*' },
    { Effect: 'Allow', Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'], Resource: 'arn:aws:logs:REPLACE_REGION:REPLACE_ACCOUNT_ID:log-group:/aws/bedrock-agentcore/runtimes/*' },
    ...(envNames.length ? [{ Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: envNames.map(() => 'REPLACE_SECRET_ARN') }] : []),
  ] };
  const script = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "\${AWS_REGION:?Set AWS_REGION explicitly}"
: "\${AGENTCORE_ROLE_ARN:?Set an execution role after reviewing deploy/aws-iam*.json}"
command -v aws >/dev/null
command -v jq >/dev/null
command -v docker >/dev/null
account=$(aws sts get-caller-identity --query Account --output text)
repo=${spec.name}
image="$account.dkr.ecr.$AWS_REGION.amazonaws.com/$repo:$(date +%Y%m%d%H%M%S)"
aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" >/dev/null 2>&1 || aws ecr create-repository --repository-name "$repo" --region "$AWS_REGION" >/dev/null
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$account.dkr.ecr.$AWS_REGION.amazonaws.com"
docker buildx build --platform linux/arm64 -t "$image" --push .
mkdir -p .deployment
jq --arg image "$image" --arg role "$AGENTCORE_ROLE_ARN" '.agentRuntimeArtifact.containerConfiguration.containerUri=$image | .roleArn=$role' deploy/aws-runtime.json > .deployment/aws-runtime.json
if jq -e 'any(.. | strings; contains("REPLACE"))' .deployment/aws-runtime.json >/dev/null; then echo "Replace secret/OIDC placeholders in deploy/aws-runtime.json before deployment" >&2; exit 1; fi
aws bedrock-agentcore-control create-agent-runtime --region "$AWS_REGION" --cli-input-json file://.deployment/aws-runtime.json > .deployment/aws-result.json
echo "Created runtime. Inspect .deployment/aws-result.json, wait for READY, then invoke with your chosen IAM or JWT identity."
`;
  return [artifact('deploy/aws-runtime.json', json(config)), artifact('deploy/aws-iam-trust.json', json(trust)), artifact('deploy/aws-iam-policy.json', json(policy)), artifact('deploy/aws-agentcore.sh', script, true), artifact('deploy/aws-notes.md', '# AWS adapter\n\nCreate/review the execution role and trust policy manually or import the JSON into your IaC. Scope all placeholders to this account and resources. Put raw secret strings in Secrets Manager; the runtime reads NAME_SECRET_ARN through its execution role and never writes secrets into the image. Add KMS decrypt permission if your secrets use a customer-managed key.\n\nRun the deploy script only after reviewing costs and configuration. It creates a new runtime; updates/version promotion/rollback remain an operator task. For JWT verify the generated OIDC discovery URL matches your actual identity provider and allowed audience; the Authorization allowlist passes the token to application verification. IAM mode protects the AgentCore service endpoint and must not be reused on standalone public containers.\n\nThe adapter does not provision memory, gateway, a public chat UI or remote MCP. Those are separate services. Check region availability, model connectivity, service quotas, image/architecture limits and IAM before launch.\n')];
}
function gcpArtifacts(spec: ProjectSpec, envNames: string[]): Artifact[] {
  const secretMap = Object.fromEntries(envNames.map(n => [n, 'REPLACE_SECRET_NAME:latest']));
  const script = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "\${GCP_PROJECT:?Set GCP_PROJECT}"; : "\${GCP_REGION:?Set GCP_REGION}"; : "\${GCP_SERVICE_ACCOUNT:?Set GCP_SERVICE_ACCOUNT}"
command -v gcloud >/dev/null; command -v jq >/dev/null
if jq -e 'to_entries | any(.value | contains("REPLACE"))' deploy/gcp-secrets.json >/dev/null; then echo "Configure existing Secret Manager references" >&2; exit 1; fi
image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/agents/${spec.name}:$(date +%Y%m%d%H%M%S)"
gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
docker buildx build --platform linux/amd64 -t "$image" --push .
secrets=$(jq -r 'to_entries | map(.key + "=" + .value) | join(",")' deploy/gcp-secrets.json)
args=(run deploy ${spec.name} --project "$GCP_PROJECT" --region "$GCP_REGION" --image "$image" --service-account "$GCP_SERVICE_ACCOUNT" --port 8080 --no-allow-unauthenticated --set-env-vars HOST=0.0.0.0)
if [ -n "$secrets" ]; then args+=(--set-secrets "$secrets"); fi
gcloud "\${args[@]}"
echo "Cloud IAM remains required; configure the calling backend and application JWT forwarding before use."
`;
  return [artifact('deploy/gcp-secrets.json', json(secretMap)), artifact('deploy/cloud-run.sh', script, true), artifact('deploy/gcp-notes.md', '# Cloud Run\n\nProvision an Artifact Registry repository named agents and a service account with permissions to read the configured secrets and use the selected model/tool services. This script keeps Cloud Run IAM authentication required. A calling backend must satisfy Cloud Run IAM and pass the application JWT in Authorization (use X-Serverless-Authorization for the Google identity token when needed). Configure identity and smoke-test before serving users.\n')];
}
function azureArtifacts(spec: ProjectSpec, envNames: string[]): Artifact[] {
  const config = { location: spec.delivery.region ?? 'REPLACE_REGION', name: spec.name, type: 'Microsoft.App/containerApps', properties: { managedEnvironmentId: 'REPLACE_ENVIRONMENT_RESOURCE_ID', configuration: { ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }, registries: [{ server: 'REPLACE_REGISTRY.azurecr.io', identity: 'system' }], secrets: envNames.map(n => ({ name: n.toLowerCase().replaceAll('_', '-'), keyVaultUrl: 'REPLACE_KEY_VAULT_SECRET_URL', identity: 'system' })) }, template: { containers: [{ name: 'agent', image: 'REPLACE_IMAGE', env: [{ name: 'HOST', value: '0.0.0.0' }, { name: 'PORT', value: '8080' }, ...envNames.map(n => ({ name: n, secretRef: n.toLowerCase().replaceAll('_', '-') }))], resources: { cpu: 1, memory: '2Gi' } }], scale: { minReplicas: 0, maxReplicas: 3 } } }, identity: { type: 'SystemAssigned' } };
  const script = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "\${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP}"; : "\${AZURE_REGISTRY:?Set AZURE_REGISTRY}"
command -v az >/dev/null; command -v jq >/dev/null
az account show >/dev/null
az acr login --name "$AZURE_REGISTRY"
image="$AZURE_REGISTRY.azurecr.io/${spec.name}:$(date +%Y%m%d%H%M%S)"
docker buildx build --platform linux/amd64 -t "$image" --push .
mkdir -p .deployment
jq --arg image "$image" --arg registry "$AZURE_REGISTRY.azurecr.io" '.properties.template.containers[0].image=$image | .properties.configuration.registries[0].server=$registry' deploy/azure-container-app.json > .deployment/azure-container-app.json
if jq -e 'any(.. | strings; contains("REPLACE"))' .deployment/azure-container-app.json >/dev/null; then echo "Complete environment/Key Vault references in deploy/azure-container-app.json first" >&2; exit 1; fi
az containerapp create --name ${spec.name} --resource-group "$AZURE_RESOURCE_GROUP" --yaml .deployment/azure-container-app.json
`;
  return [artifact('deploy/azure-container-app.json', json(config)), artifact('deploy/azure.sh', script, true), artifact('deploy/azure-notes.md', '# Azure adapter\n\nProvision a Container Apps environment, registry and managed identity; grant the identity AcrPull and the required Key Vault secret access before deploying. For first deployment with private image/Key Vault, use a pre-provisioned user-assigned managed identity and replace system identity references in this scaffold. Select an appropriate workload profile, ingress restrictions and JWT identity provider. This adapter is a reviewable scaffold, not automatic account/identity setup.\n')];
}

function runtimeTemplate(spec: ProjectSpec): string {
  const py = spec.language === 'python';
  let code = template(py ? 'runtime.py.tpl' : 'runtime.ts.tpl');
  if (spec.delivery.target === 'aws-agentcore') {
    code = code.replace(py ? '    # AWS_SECRET_RESOLUTION' : '  // AWS_SECRET_RESOLUTION', py ? `    if not value and os.environ.get(str(name) + "_SECRET_ARN"):
        import boto3
        from botocore.config import Config
        response = boto3.client("secretsmanager", config=Config(connect_timeout=5, read_timeout=10, retries={"max_attempts": 1})).get_secret_value(SecretId=os.environ[str(name) + "_SECRET_ARN"])
        value = response.get("SecretString", "")
        if value: os.environ[name] = value` : `  if (!value && process.env[name + '_SECRET_ARN']) {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({ maxAttempts: 1 });
    try { const response = await client.send(new GetSecretValueCommand({ SecretId: process.env[name + '_SECRET_ARN'] }), { abortSignal: AbortSignal.timeout(15000) }); value = response.SecretString; if (value) process.env[name] = value; }
    finally { client.destroy(); }
  }`);
  }
  return code;
}
