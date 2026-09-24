# Instrilo CLI reference

Generated from the CLI itself. Regenerate with `npm run docs:cli` after changing commands or manual topics.

Install the built app and CLI from the [GitHub release](https://github.com/nimeshbuilds/instrilo/releases) using the [installation guide](INSTALLATION.md). Source contributors can use `npm ci && npm run build && npm link`; without linking, replace `instrilo` with `npm run cli --` in the examples. `PROJECT`, `RUN_ID`, `HASH`, and uppercase example values are placeholders.

This reference contains 140 command entries (including groups and the root) and 27 offline manual topics.

```sh
instrilo help --all
instrilo help approvals approve
instrilo explain --list
instrilo explain --search JWT
instrilo help --json
```

## Command index

| Command | Purpose |
| --- | --- |
| `instrilo` | Instrilo — turn product guidance into agents, evaluations and deployment artifacts. |
| `instrilo init` | Create a project with explicit offline defaults; configure connections before live use. |
| `instrilo guidance` | Create and inspect a product guidance directory. |
| `instrilo guidance create` | Ask the ten product questions and write a reviewable guidance document. |
| `instrilo guidance inspect` | Inventory guidance, detect missing decisions, and show excluded files. |
| `instrilo guidance questions` | Print all interview questions and machine-readable answer keys. |
| `instrilo guidance answers-template` | Print a JSON answer object for unattended guidance creation. |
| `instrilo guidance list` | Inspect the current project guidance, file hashes, exclusions and missing decisions. |
| `instrilo guidance read` | Read an eligible project guidance file and its current hash. |
| `instrilo guidance write` | Create or safely replace one eligible project guidance document. |
| `instrilo create` | Create a project from an existing guidance directory. |
| `instrilo validate` | Validate configuration and provider/framework/target compatibility. |
| `instrilo plan` | Ask the builder to synthesize instructions and identify unresolved questions. |
| `instrilo build` | Generate framework code, host packages, tests and target deployment artifacts. |
| `instrilo prepare` | Install generated runtime dependencies using npm or uv. |
| `instrilo run` | Run the actual generated agent locally. Provider usage may be billed. |
| `instrilo eval` | Run deterministic checks and the selected judge against the generated agent. |
| `instrilo compare` | Compare two evaluation reports and list regressions. |
| `instrilo doctor` | Check configuration, environment references and installed CLI binaries without model calls. |
| `instrilo providers` | List supported connection capabilities and restrictions. |
| `instrilo deploy` | Show generated delivery instructions; --execute runs the target script you configured. |
| `instrilo app` | Open the local web application backed by the same core as the CLI. |
| `instrilo projects` | Discover project workspaces and inspect their source/configuration. |
| `instrilo projects list` | List projects in a workspace with language, framework, target and modification time. |
| `instrilo projects show` | Show project configuration, inspected guidance and dataset summary. |
| `instrilo config` | Inspect and atomically update every manifest field with validation and backups. |
| `instrilo config show` | Print the complete validated manifest as JSON or YAML, optionally with its file hash. |
| `instrilo config template` | Print a complete valid offline manifest to customize or apply. |
| `instrilo config get` | Read one dotted field, e.g. roles.runtime or security.inbound. |
| `instrilo config set` | Set a dotted field; validation rejects unsupported combinations and unknown keys. |
| `instrilo config apply` | Atomically replace the complete manifest from JSON/YAML; useful for interdependent changes. |
| `instrilo config fields` | List every manifest field and its default type/value. Use explain configuration for constraints. |
| `instrilo connections` | Manage named model connections and choose builder/runtime/judge independently. |
| `instrilo connections list` | List named model connections and the three role assignments. |
| `instrilo connections add` | Add a named connection using a JSON/YAML connection object. |
| `instrilo connections remove` | Remove a connection only after its roles have been reassigned. |
| `instrilo connections use` | Assign builder, runtime, or judge to an existing named connection. |
| `instrilo connections check` | Check environment references/client availability without making a model request. |
| `instrilo connections example` | Print a complete connection example; all secrets are environment references. |
| `instrilo tools` | Manage portable HTTP tools, input schemas, scopes and approval requirements. |
| `instrilo tools list` | List configured HTTP tools, scopes, schemas and approval requirements. |
| `instrilo tools add` | Add a strict ToolSpec; see tools example. |
| `instrilo tools remove` | Remove an existing tool by name, validate and back up the manifest. |
| `instrilo tools example` | Print a guarded write-tool example to edit and add. |
| `instrilo cases` | Create, inspect, import, export and revise evaluation datasets with provenance. |
| `instrilo cases list` | Print validated evaluation cases, optionally filtered by split. |
| `instrilo cases add` | Append one complete case; see cases example. |
| `instrilo cases import` | Import JSON array, JSONL, or YAML cases; duplicates are rejected. |
| `instrilo cases remove` | Remove one case by ID; the remaining dataset must remain valid. |
| `instrilo cases update` | Replace one case with a complete object; ID must remain the same. |
| `instrilo cases export` | Export validated cases as JSONL to stdout or a new file. |
| `instrilo cases example` | Print a synthetic case; review and edit before marking reviewed or holdout. |
| `instrilo artifacts` | Inspect generated source and delivery files without launching the agent. |
| `instrilo artifacts list` | List exportable generated files while excluding secrets and private state. |
| `instrilo artifacts read` | Print one eligible generated source or delivery file as text. |
| `instrilo export` | Export generated source, portable manifest, guidance and cases as a bounded ZIP. |
| `instrilo reports` | List and inspect saved evaluation reports. |
| `instrilo reports list` | List saved evaluation JSON files in the selected project. |
| `instrilo reports show` | Validate the file boundary and print one saved project report. |
| `instrilo adapters` | Inspect built-in capabilities; develop, pin and test trusted community extensions. |
| `instrilo adapters catalog` | Show providers, framework/language support, targets, hosts and extension boundaries. |
| `instrilo adapters init` | Create a dependency-free runnable adapter and manifest. |
| `instrilo adapters inspect` | Validate a bundle and display its permissions and content pin without executing it. |
| `instrilo adapters install` | Copy and pin a reviewed bundle; generators run on subsequent builds. |
| `instrilo adapters list` | List installed trusted adapter manifests, versions and content pins. |
| `instrilo adapters remove` | Disable the adapter; retain its pinned files and rebuild to remove unchanged generated extensions. |
| `instrilo adapters test` | Run local interface conformance with no forwarded provider credentials. |
| `instrilo adapters serve` | Run a provider adapter as an authenticated loopback OpenAI-compatible gateway. |
| `instrilo requirements` | Track guidance requirements, human-reviewed evidence links, stale sources and explicit waivers. |
| `instrilo requirements add` | Add one requirement. Fields: id, text, sourcePath; optional title, reviewer, reason. |
| `instrilo requirements import` | Import a requirement array or {schemaVersion:"1",requirements:[...]}. |
| `instrilo requirements list` | List recorded requirements, source hashes, review metadata and case links. |
| `instrilo requirements status` | Show proposed, stale-source, uncovered, stale-link, ready and waived requirements. |
| `instrilo requirements update` | Update a requirement and invalidate earlier review/link fingerprints. |
| `instrilo requirements link` | Link a human-reviewed case to an exact requirement version. |
| `instrilo requirements unlink` | Remove obsolete coverage links and preserve an audited reason and prior snapshot. |
| `instrilo requirements waive` | Record a reasoned waiver; release policy must separately allow waivers. |
| `instrilo requirements example` | Print an example requirement document to edit and review before import. |
| `instrilo evidence` | Register immutable evaluation reports and inspect requirement coverage. |
| `instrilo evidence register` | Register a report snapshot by immutable ID. CLI/app eval also register automatically. |
| `instrilo evidence status` | Inspect current guidance/case fingerprints and requirement coverage status. |
| `instrilo release` | Evaluate the project-owned release gate; exit 2 when blocked. Does not deploy. |
| `instrilo policy` | Inspect and set versioned release policy; defaults reject demo, synthetic and uncovered evidence. |
| `instrilo policy template` | Print the versioned strict-default release policy as JSON. |
| `instrilo policy show` | Show the effective saved policy or strict defaults when none is saved. |
| `instrilo policy apply` | Validate and atomically save an explicit project-owned release policy. |
| `instrilo review` | Review exact outputs blindly, retain immutable labels, and calibrate judges against humans. |
| `instrilo review queue` | Show exact evaluated outputs and binding hashes; automated/prior human verdicts are hidden by default. |
| `instrilo review label` | Append a bound human label: reportId, caseId, verdict, reviewer, reason, optional binding/supersedes. |
| `instrilo review import` | Import a versioned label export. Binding checksums and original report snapshots must match. |
| `instrilo review export` | Export immutable human-label history, including superseded corrections. |
| `instrilo review assessments` | Inspect active human consensus, abstentions and unresolved disagreements for each case. |
| `instrilo review calibrate` | Report sample size, judge-human agreement, false passes/fails and disagreements. |
| `instrilo review example` | Print an example human label to edit; include the blind queue binding for asynchronous review. |
| `instrilo generation` | Plan safe rebuilds, inspect retained baselines, migrate old builds and recover interrupted updates. |
| `instrilo generation plan` | Preview additions, updates, preserved edits and conflicts without writing project files. |
| `instrilo generation inspect` | Inspect the retained baseline, source fingerprints, lock and recovery status. |
| `instrilo generation recover` | Roll back an interrupted transaction only when affected files still match its journal. |
| `instrilo generation migrate` | Preview legacy generation-state migration; --apply writes a backed-up migration. |
| `instrilo deps` | Inspect, create and enforce actual npm/uv dependency locks. Registry access may be required. |
| `instrilo deps status` | Inspect actual dependency lock presence, hashes and manifest consistency. |
| `instrilo deps lock` | Resolve and write package-lock.json or uv.lock explicitly. |
| `instrilo deps install` | Install from an existing lock without updating it; stale locks fail. |
| `instrilo runs` | Record local native/LangGraph runs, resume approved work and replay frozen model/tool responses. |
| `instrilo runs start` | Persist sensitive input/model/tool content for durable replay and approval pauses. |
| `instrilo runs list` | List recorded run IDs, states, identities and replay availability without dumping content. |
| `instrilo runs show` | Inspect a recorded run including exact events, pending decisions and stored content. |
| `instrilo runs resume` | Replay completed steps and continue approved work; ambiguous writes are never retried automatically. |
| `instrilo runs replay` | Execute the current pinned runtime against recorded responses with zero live model/tool calls. |
| `instrilo runs recover-lock` | Remove a durable-run lock only after verifying its recorded process is no longer alive. |
| `instrilo runs export` | Export a scrubbed inspect-only run bundle; content is omitted unless explicitly included. |
| `instrilo runs inspect-bundle` | Validate and inspect an imported portable failure bundle; never executes bundled code. |
| `instrilo runs replay-bundle` | Replay portable recorded data against an exactly matching trusted local build; never installs imported code. |
| `instrilo runs graph` | Render the observed run trajectory as Mermaid or structured JSON. |
| `instrilo approvals` | Inspect and decide exact pending tool actions as the local OS operator. |
| `instrilo approvals show` | Show pending tool arguments, identity and exact approval/operation digests. |
| `instrilo approvals approve` | Approve the inspected digest once, with expiry. Resume is a separate explicit action. |
| `instrilo approvals deny` | Deny the exact pending approval digest and persist the decision. |
| `instrilo approvals reconcile` | Record a confirmed external result after an ambiguous operation; never repeats the external action. |
| `instrilo setup` | Guide official CLI discovery, reviewed installation and provider-owned sign-in; no project is required. |
| `instrilo auth` | Install, sign in, inspect or explicitly verify official subscription CLI connections. |
| `instrilo auth status` | Print installed binaries and safe credential status for one or all providers; no model call or login. |
| `instrilo auth install` | Install a fixed official npm package under your user account after reviewing its plan. |
| `instrilo auth login` | Run the official interactive sign-in even if credentials exist; the provider handles your account. |
| `instrilo auth verify` | Make one bounded live model request through the official CLI. Uses account allowance or API billing. |
| `instrilo connect` | Set up a provider and assign a named connection to builder, runtime, judge, or all roles. |
| `instrilo deployment` | Inspect platform requirements, test generated containers with mocks, retain evidence and clean owned resources. |
| `instrilo deployment platforms` | List verified platform contracts, architecture, prerequisites and official references. |
| `instrilo deployment guide` | Read the generated platform-specific prerequisite and deployment guide. Build first. |
| `instrilo deployment prerequisites` | Inspect the selected platform contract and local container engine without changing the machine. |
| `instrilo deployment test` | Preview or execute isolated local container contract tests with mocked model/identity/services; no cloud deployment. |
| `instrilo deployment reports` | Read retained deployment test evidence, including mocks, actual checks and unverified cloud dependencies. |
| `instrilo deployment cleanup` | Preview or remove only exact resources owned by a recorded deployment test; preserve its report. |
| `instrilo deployment engine` | Check Docker/Podman, review installation/startup, or clean up dependencies Instrilo owns. |
| `instrilo deployment engine status` | Check one or both official container clients and server readiness without starting anything. |
| `instrilo deployment engine install` | Review platform-specific prerequisites and install a supported official runtime with explicit consent. |
| `instrilo deployment engine start` | Review and start supported runtime dependencies; owned Podman machines are separate from existing machines. |
| `instrilo deployment engine cleanup` | Review removal of dependencies Instrilo owns; pre-existing or shared dependencies are preserved. |
| `instrilo help` | Read nested command help, the complete command reference, or machine-readable command metadata. |
| `instrilo explain` | Read the built-in operational manual without opening a browser. |

## Operational manual

### Guided subscription CLI installation and sign-in

Available offline: `instrilo explain subscriptions`.

```text
Use the official Codex, Claude Code or Grok Build CLI through your own account.
Instrilo discovers tools, offers installation, starts official sign-in and checks
credential status. It never reads provider credential files or asks for passwords.
These commands also work as in in zsh, or command in in Bash/POSIX sh.

  instrilo setup codex
  instrilo setup grok --device
  instrilo auth status
  instrilo auth status claude
  instrilo auth install claude --plan
  instrilo auth install claude --yes
  instrilo auth login codex --install --yes --device
  instrilo auth login claude
  instrilo auth verify grok
  instrilo connect claude ./my-agent --role judge
  instrilo connect codex ./my-agent --role builder --connection planning
  instrilo connect grok ./my-agent --role all --yes

setup without a provider asks in a terminal. --yes approves the displayed fixed
official npm installation and starting login; account consent stays in the
provider's browser/device flow. No login or installation is done by auth status.
auth login always starts login, including when credentials already exist.
--install offers installation only if missing. --device works for Codex/Grok;
Claude uses its normal browser flow and may require terminal input.

Install requirements: Node.js >=22 and npm, macOS/Linux/WSL. Install plans name
@openai/codex, @anthropic-ai/claude-code or @xai-official/grok, and the official
npm registry. npm package installation runs the provider's install scripts.
No sudo is required. Packages go under ~/.local/share/instrilo/providers.
Set INSTRILO_PROVIDER_HOME to an absolute directory to choose another prefix.
Instrilo and generated Python/TypeScript runtimes check absolute PATH entries,
the managed prefix/bin, ~/.local/bin and ~/.bun/bin, in that order. An existing
PATH installation takes precedence; inspect auth status to see the selected path.
You do not need to edit PATH to use the managed installation through Instrilo.
Updating: auth install PROVIDER --plan, then auth install PROVIDER --yes.
An existing PATH binary still takes precedence after a managed package update.

Codex/Claude status can report missing credentials, subscription login, API-key
login or unknown/error. Grok currently has no supported noninteractive auth-status
command, so installed/login-completed is explicitly unverified. Unknown formats
stay unknown. Status never proves eligibility, quota, model access or inference.
auth verify makes one deliberate bounded live request and can consume subscription
allowance or API billing. No other setup command calls a model. Environment API
keys can override subscription behavior; checks show variable names, never values.

connect defaults to builder; --role judge, runtime or all selects other roles.
It validates compatibility before setup and preserves other project settings.
--connection names a connection; --replace explicitly permits changing its kind.
CLI runtime roles need the native framework, local target and no HTTP tools or
remote ChatGPT bridge. Builder and judge CLI roles work with every framework.
After changes, rebuild before running. Concurrent config changes stop saving.

In the app, open Connections & adapters to check status, review an install plan,
sign in or choose device login. Status updates preserve Configuration drafts.
Only trusted provider login links and contextual device codes are shown. The
provider opens its own browser; if it requires terminal interaction, run the
displayed instrilo auth login command. Cancel stops the local child process.
Completed handoff details are cleared and are never saved in project files.

Troubleshooting: install Node.js >=22 if npm is missing; use WSL on Windows.
If a provider is installed but lacks current auth commands, review its path and
update the matching installation. Device auth may need provider/workspace settings.
Status errors and login timeouts provide a terminal fallback. Failed installation
releases its lock so it can be retried; after a machine crash inspect the prefix's
.install.lock and ensure no installer is running before removing an abandoned lock.
Desktop chat apps retain their separate host setup; CLI login does not sign you
into ChatGPT or Claude Desktop. Read instrilo explain desktop for that workflow.
CLI runtime sessions do not support durable recorded runs. Ollama uses an existing
local daemon and model through its API; choosing Ollama does not download a model.
```

### Instrilo: the complete agent workflow

Available offline: `instrilo explain overview`.

```text
Instrilo turns product guidance into owned Python or TypeScript agent projects.
The local app and CLI share agent-studio.yaml, guidance, generated source and evals.
The installed commands instrilo, in and nb-agent invoke the same CLI.
Use in directly in zsh; in Bash/POSIX sh use command in because in is a
reserved word. For example: command in help --all.

Start here:
  instrilo explain quickstart
  instrilo help --all                   Every command, argument and option
  instrilo help --json                  Machine-readable command reference
  instrilo explain --list               Every manual topic
  instrilo explain --search approval    Search the complete manual
  instrilo explain --all                Print the whole manual
  instrilo help connections add         Help for nested commands

Workflow: init/create → guidance → config/connections/tools → plan → build →
prepare or deps → run/eval → requirements/review/release → deploy/export.

Operational workflows: generation plan/inspect/recover/migrate, runs start/resume/
replay/graph/export, approvals show/approve/deny/reconcile, adapters init/inspect/
install/test/serve. A release gate is an evidence decision, not a deployment.

Use PROJECT as a path to a project directory. Commands default to the current
working directory unless their help says otherwise. Explicit subcommand help is
always available as instrilo COMMAND SUBCOMMAND --help. Most actions print JSON;
text/code/manual/graph commands print their documented format. Secrets stay in
environment variables. No hosted account is required for the core workbench.
```

### An executable offline quickstart

Available offline: `instrilo explain quickstart`.

```text
Prerequisites: Node.js >=22 and npm on macOS, Linux or WSL. For Python use
Python 3.11–3.13 plus uv. Native Windows cancellation/install need further work.
From the source checkout: npm ci --ignore-scripts && npm run build && npm link
npm link installs instrilo plus the in and nb-agent aliases. Repeat it after
updating an existing installation to add the new alias. In zsh: in --help.
In Bash/POSIX sh: command in --help (in is a reserved word).
Without npm link, replace instrilo with npm run cli -- in every example.

  instrilo init support-agent --directory .studio/projects --language typescript
  instrilo guidance create .studio/projects/support-agent/guidance
  instrilo validate .studio/projects/support-agent
  instrilo build .studio/projects/support-agent
  instrilo prepare .studio/projects/support-agent
  instrilo run .studio/projects/support-agent --input 'Draft a missing-delivery reply.'
  instrilo eval .studio/projects/support-agent --split development
  instrilo projects show .studio/projects/support-agent
  instrilo export .studio/projects/support-agent --output support-agent.zip
  instrilo app --workspace .studio/projects

The guidance interview asks ten product questions. For unattended use:
  instrilo guidance answers-template > answers.json
  # Fill answers.json with actual decisions. Then:
  instrilo guidance create ./product-guidance --answers answers.json
  instrilo create research-agent --guidance ./product-guidance --language python

New projects use explicit offline demo connections for builder, runtime and judge.
Demo output is a smoke test, not measured model quality; default release gates
reject it. prepare installs dependencies and may access public registries. No
paid model request is made until you configure a live connection.

Python: set NB_AGENT_PYTHON=/absolute/path/to/python3 if interpreter selection is
ambiguous. The generated project's .venv takes precedence. Use a separate venv
for every generated project.
```

### Agents, graphs, harnesses and evidence

Available offline: `instrilo explain concepts`.

```text
An agent combines instructions, model decisions, tools and bounded control flow.
A framework implements that flow (native, LangGraph, OpenAI Agents or CrewAI).
A harness supplies the environment: tool invocation, state, limits and feedback.
A graph represents actual nodes/transitions; it is useful when it explains execution.
A model connection is a transport/auth/model choice. Builder, runtime and judge
are independent roles, not three copies of the same mandatory vendor account.

Instrilo uses deterministic generators for runtime/security plumbing. The builder
proposes task instructions; it does not invent credentials, permissions or rules.
Use reflection, planning and multiple agents only when task evidence justifies
those patterns. No tool can certify compliance with all of Andrew Ng's teachings.

Requirements identify intended behavior. Cases exercise it. Deterministic checks
verify explicit assertions. Judges offer scored judgments. Human labels calibrate
them. Release policies combine these and reject missing/stale evidence.
Code ownership includes the ability to change generated code and inspect upgrade
conflicts; it is not a promise that arbitrary modifications will merge automatically.
```

### Guidance import, interviews and safe editing

Available offline: `instrilo explain guidance`.

```text
Eligible guidance is bounded UTF-8 text inside a selected directory. Inspection
excludes credentials matching known patterns, hidden/dependency/binary files,
symlinks and oversized files. Detection is not complete sensitive-data discovery.

  instrilo guidance questions
  instrilo guidance answers-template
  instrilo guidance inspect ./product-guidance
  instrilo create research-agent --guidance ./product-guidance
  instrilo guidance list ./research-agent
  instrilo guidance read purpose.md ./research-agent
  instrilo guidance write operations.md ./research-agent --text '# Operations
Escalate billing disputes.'
  instrilo guidance write purpose.md ./research-agent --file updated.md --replace --expected-sha HASH
  instrilo plan ./research-agent --interview --apply

The ten keys are purpose, users, inputs, outputs, success, tools, boundaries,
escalation, examples and operations. Blank/UNDECIDED answers remain unresolved.
create copies eligible files, preserving the original guidance directory.
write validates the complete proposed guidance before saving. Replacement needs
the existing file hash to prevent overwriting concurrent edits. Prior versions
are backed up under .instrilo/backups. Rebuild after changing guidance.
plan invokes the configured builder; --interview asks its follow-up questions;
--apply saves proposed instructions. Live builders may consume provider allowance.
Holdout expected answers do not belong in builder guidance.
```

### Every configuration field and how to edit it

Available offline: `instrilo explain configuration`.

```text
  instrilo config template --language python --yaml
  instrilo config fields
  instrilo config show PROJECT --hash
  instrilo config get agent.limits PROJECT
  instrilo config set agent.limits.maxSteps 12 PROJECT --json
  instrilo config set agent.limits '{"maxSteps":12,"timeoutMs":60000,"maxOutputTokens":2048}' PROJECT --json
  instrilo config apply PROJECT --file complete-config.yaml --expected-sha HASH

set treats values as strings unless --json is present. apply replaces the whole
manifest atomically and is useful when several related settings must change
at once. All edits validate before saving and retain a backup. Unknown keys fail.

Manifest fields (schemaVersion remains "1" for compatibility):
  name: lowercase project slug; description: task description.
  language: python|typescript. framework: native|langgraph|openai-agents|crewai.
  guidanceDir: path within the project. connections: named connection objects.
  roles.builder/runtime/judge: existing connection IDs.
  agent.systemPrompt: task instructions; agent.tools: ToolSpec array.
  agent.limits: maxSteps 1–100, timeoutMs 100–600000, maxOutputTokens 1–131072.
  evaluation.dataset: project-relative JSONL; rubric: judge instructions;
  evaluation.threshold: 0–1, minimum passing judge score.
  security.inbound: mode none|jwt, algorithms (explicit asymmetric allowlist),
    issuer, audience, jwksUrl required for JWT.
  security.requiredScopes: verified caller scopes required by the service.
  security.tenantClaim: optional identity claim; tools must still filter resources.
  delivery.target: local|docker|aws-agentcore|cloud-run|azure-container-apps.
  delivery.hosts: array of codex|claude-code|claude-desktop|chatgpt.
  delivery.region: optional; delivery.port: 1024–65535.

Every connection supports kind, model, baseUrl, timeoutMs and auth (see connections).
Use tools example for a complete ToolSpec and cases example for a starter EvalCase;
explain evaluations lists optional reference and assertion fields.
Changing source configuration makes old builds stale. Rebuild before running.
Unknown framework/provider/target combinations are rejected rather than guessed.
```

### Model connections and independent roles

Available offline: `instrilo explain connections`.

```text
  instrilo providers
  instrilo connections example openai --model YOUR_MODEL > openai.json
  instrilo connections add live PROJECT --file openai.json
  instrilo connections use builder live PROJECT
  instrilo connections use runtime live PROJECT
  instrilo connections use judge live PROJECT
  instrilo connections list PROJECT
  instrilo connections check PROJECT
  instrilo doctor PROJECT

Connection fields: kind (openai, anthropic, xai, gateway, ollama, codex-cli,
claude-code, grok-cli, demo); optional model/baseUrl/timeoutMs; required auth.
Auth shapes:
  {"type":"none"}
  {"type":"api-key","env":"OPENAI_API_KEY"}
  {"type":"bearer-env","env":"GATEWAY_JWT"}
  {"type":"oauth-client-credentials","tokenUrl":"https://id.example/token",
   "clientIdEnv":"CLIENT_ID","clientSecretEnv":"CLIENT_SECRET",
   "scope":"model.invoke","audience":"gateway"}
OAuth audience/scope depend on the identity provider. Do not put secret values
in the manifest, command arguments, guidance, or issue reports.

connections add --replace updates an existing ID. remove refuses connections
still referenced by a role. config apply can change interdependent fields at once.
Environment variables must exist in the process that launches the CLI/app/runtime.
.env.example documents names; it does not load an .env file automatically.
Diagnostics verify configuration/env references/client presence, not live access,
model availability, subscription entitlement or billing. Actual model usage is
performed by plan, run, eval, or recorded runs when live connections are selected.
```

### Custom gateways, JWT and authorization

Available offline: `instrilo explain gateways`.

```text
Outbound gateway authentication and inbound agent authentication are separate.

  instrilo connections add enterprise PROJECT --data '{"kind":"gateway","model":"YOUR_MODEL","baseUrl":"https://gateway.example/v1","auth":{"type":"bearer-env","env":"GATEWAY_JWT"}}'
  instrilo connections use runtime enterprise PROJECT
  instrilo config set security.inbound '{"mode":"jwt","issuer":"https://id.example/","audience":"my-agent","jwksUrl":"https://id.example/.well-known/jwks.json","algorithms":["RS256"]}' PROJECT --json
  instrilo config set security.requiredScopes '["agent:invoke"]' PROJECT --json
  instrilo config set security.tenantClaim tenant_id PROJECT

Outbound API-key/bearer-env uses an existing credential. OAuth client credentials
can obtain and cache a token with expiry and credential/grant-aware cache keys.
A JWT string alone does not prove authorization: the receiving gateway verifies
issuer/audience/signature/scopes according to its contract.
Generated inbound JWT verification uses asymmetric algorithms and trusted JWKS,
issuer and audience. Request-body claims cannot grant scopes or approvals. A tenant
claim is identity context, not automatic row-level filtering in arbitrary tools.

adapters serve can expose a trusted provider extension locally behind a bearer
token. Point a gateway connection at its /v1 URL. That loopback process must remain
running and is not automatically reachable from a deployed cloud container.
```

### Framework and language compatibility

Available offline: `instrilo explain frameworks`.

```text
  instrilo adapters catalog
  instrilo connections add live PROJECT --data '{"kind":"openai","model":"YOUR_MODEL","auth":{"type":"api-key","env":"OPENAI_API_KEY"}}'
  instrilo connections use runtime live PROJECT
  instrilo config set framework langgraph PROJECT
  instrilo validate PROJECT

The example selects an API runtime before changing frameworks; a new project's
demo runtime supports native only. These configuration commands make no model call.
Native: Python + TypeScript; API/gateway/Ollama, demo, bounded CLI sessions.
LangGraph: Python + TypeScript; OpenAI/xAI/gateway/Ollama.
OpenAI Agents SDK: Python + TypeScript; OpenAI/xAI/gateway.
CrewAI: Python; OpenAI. TypeScript/CrewAI is explicitly unsupported.
Anthropic's native Messages transport is supported by the native framework.

Durable recording, approval resume and frozen replay support native/LangGraph
in both languages. Other framework runtimes still support ordinary run/eval.
CLI-session runtimes do not support durable recording. This compatibility matrix
is operation-specific; matching an API URL shape does not prove full semantics.
Built-in framework tests run actual SDKs against local model/tool fixtures. Live
provider accounts and cloud deployment are separate integration checks.
```

### Tools, exact-call approvals and boundaries

Available offline: `instrilo explain tools`.

```text
  instrilo tools example > tool.json
  instrilo config set security.inbound '{"mode":"jwt","issuer":"https://id.example/","audience":"my-agent","jwksUrl":"https://id.example/.well-known/jwks.json","algorithms":["RS256"]}' PROJECT --json
  instrilo tools add PROJECT --file tool.json
  instrilo tools list PROJECT
  instrilo tools remove create_draft PROJECT

Every tool requires name, description, kind:"http", URL, method GET|POST,
requiresApproval boolean, requiredScopes array and inputSchema JSON Schema.
Optional authEnv names a tool credential variable. Credentials in URLs are rejected.
The example tool requires draft:write; scoped tools require inbound JWT configuration
before they can be added. Replace the identity URLs and audience with your trusted
identity provider before serving requests. For a deliberately unscoped local tool,
use requiredScopes:[]; exact-call approval remains a separate requirement.
Use bounded task-specific schemas; additionalProperties:false helps avoid
unexpected arguments. Approval is distinct from the scope authorizing an action.

Ordinary generated runtimes can validate exact-call approval digests but have no
persistent reviewer inbox. Use runs start --record-content for a durable pause
before approval-required writes. See approvals for approve/deny/resume/reconcile.
Never give an agent a privileged tool merely by adding a sentence to guidance.
For real tenant data, each tool must implement resource-specific authorization.
POST should normally require approval; the product does not infer a business
policy for you. GET endpoints can also have side effects if poorly designed.
```

### Datasets, judges and comparisons

Available offline: `instrilo explain evaluations`.

```text
  instrilo cases example > case.json
  instrilo cases add PROJECT --file case.json
  instrilo cases import PROJECT --file cases.jsonl --replace
  instrilo cases list PROJECT --split holdout
  instrilo cases update billing-escalation PROJECT --file revised-case.json
  instrilo cases export PROJECT --output cases.jsonl
  instrilo eval PROJECT --split holdout
  instrilo reports list PROJECT
  instrilo reports show reports/FILE.json PROJECT
  instrilo compare previous.json current.json

Case fields: id, input, optional expected (reference), contains:string[],
excludes:string[], requireJson:boolean, source:reviewed|synthetic,
split:development|holdout. IDs must be unique. Human review is required before
changing synthetic to reviewed; Instrilo does not certify that review occurred.
Judge connection, rubric and threshold are independently configurable.

Eval combines execution success, explicit deterministic checks and judge threshold.
Malformed judges/errors fail assessment. Demo mode produces no judge score.
Holdout runs fail when the split is empty. Reports preserve config, selected case,
dataset, guidance and judge fingerprints. Mid-evaluation source changes invalidate
real evaluation. Comparisons distinguish changed cases from actual regressions.
Saved reports are registered for requirements/review/release workflows. Report
files and checksums establish local consistency, not a signed external attestation.
```

### Link product requirements to release evidence

Available offline: `instrilo explain requirements`.

```text
  instrilo requirements example > requirement.json
  instrilo requirements add PROJECT --file requirement.json
  instrilo requirements list PROJECT
  instrilo requirements link billing-human PROJECT --case billing-escalation --kind deterministic --reviewer Nimesh --reason 'Tests explicit escalation wording.'
  instrilo requirements status PROJECT

Input: id, text, sourcePath (relative to guidance), optional title. Supply reviewer
and reason together to mark the requirement reviewed; otherwise it is proposed.
The source file hash binds the requirement to exact guidance. A reviewed evidence
link binds requirement revision and case hash. Editing either makes it stale.
Kinds are deterministic, judge and human; a judge link cannot satisfy a policy
requiring deterministic evidence. Empty/uncovered requirements block release.

  instrilo requirements update billing-human PROJECT --expected-revision 1 --data '{"text":"Escalate every billing dispute.","reviewer":"Nimesh","reason":"Reviewed updated rule."}'
  instrilo requirements waive billing-human PROJECT --reviewer Nimesh --reason 'Not applicable to this release.' --expires-at 2027-01-01T00:00:00Z

An update needs new evidence review. Waivers are recorded separately and rejected
unless the release policy explicitly allows them. Requirements do not rewrite
agent permissions or prove semantic coverage merely by existing.
```

### A reviewable release gate for CI

Available offline: `instrilo explain release`.

```text
  instrilo policy template > policy.json
  instrilo policy apply PROJECT --file policy.json
  instrilo policy show PROJECT
  instrilo release PROJECT --report REPORT_ID --output release-decision.json

Default policy fields (schemaVersion:"1"):
allowDemo:false, allowSynthetic:false, allowWaived:false, requireHoldout:true,
requireAllCasesPass:true, requireDeterministic:true, requireHumanReview:false,
minHumanReviews:1. Unknown policy keys fail validation.

The gate checks current source/case/judge fingerprints, requirement review and
coverage, linked evaluated cases, deterministic assertions, recorded judge result
and required human reviews. Human rejection or unresolved disagreement blocks
linked evidence. Stale or missing hashes are not silently accepted.

Exit 0 means the explicit policy allowed the release; exit 2 means it blocked it.
This command emits evidence; it does not push code, deploy resources, or certify
quality. Demo/synthetic overrides remain visible in the policy and classification.
Policy changes are an operator decision, not a hidden way to make a score green.
Reports imported with evidence register retain immutable IDs and content hashes.
```

### Blind human review and judge calibration

Available offline: `instrilo explain review`.

```text
  instrilo review queue PROJECT --report REPORT_ID --output blind-review.json
  instrilo review example
  instrilo review label PROJECT --data '{"reportId":"REPORT_ID","caseId":"billing-escalation","verdict":"pass","reviewer":"Nimesh","reason":"Correct escalation."}'
  instrilo review assessments PROJECT --report REPORT_ID
  instrilo review calibrate PROJECT --report REPORT_ID
  instrilo review export PROJECT --output labels.json
  instrilo review import PROJECT --file labels.json

The default queue omits judge scores/check verdicts and earlier human verdicts.
--unblind reveals them explicitly. Bindings identify the exact report, case,
output and judge configuration; carry binding from the queue into label input
when labeling asynchronously. verdict is pass|fail|abstain.

Labels are append-only. To correct your label, include supersedes:OLD_LABEL_ID;
you cannot silently overwrite another review. Conflicting active human labels
remain disagreement. Review imports verify fingerprints and checksums.
Calibration reports sample counts, agreement, false passes/fails and unscored
cases. A small sample is not a reliability guarantee. Changed datasets/rubrics
remain versioned; stale reports cannot become fresh release evidence.
```

### Upgrade generated code without losing custom work

Available offline: `instrilo explain regeneration`.

```text
  instrilo generation plan PROJECT
  instrilo build PROJECT --dry-run
  instrilo build PROJECT --overwrite --expected-plan HASH
  instrilo generation plan PROJECT --merge
  instrilo build PROJECT --overwrite --merge --expected-plan HASH
  instrilo generation inspect PROJECT
  instrilo generation migrate PROJECT
  instrilo generation migrate PROJECT --apply
  instrilo generation recover PROJECT

A retained baseline distinguishes generator changes from your own edits.
Unchanged generator output preserves your modifications. Both sides changing a
file produces a conflict; --merge attempts conservative non-overlapping text
merges. Overlap is reported, never silently clobbered. Unowned files remain yours.
Modified obsolete files survive removal from a template; unchanged obsolete files
can be removed. Edit source guidance/config/dataset instead of their generated
mirrors. Protected mirror changes conflict rather than rewriting source intent.

Dry-run writes no project files and returns additions/updates/merges/deletions/
preserves/conflicts plus a plan hash. --expected-plan guards against changes
between review and apply. --overwrite now means safe regeneration, not force.
A journal, exclusive lock and backups make interrupted updates recoverable.
Recovery refuses to overwrite files edited after the interrupted transaction.
Older builds retain manifest schema v1 and can migrate their baseline state.
Models with mutable remote aliases cannot be frozen by a local build lock.
Use deps lock/install for actual dependency resolution rather than confusing
source fingerprints with package-manager locks.
```

### Dependency locks and frozen installation

Available offline: `instrilo explain dependencies`.

```text
  instrilo deps status PROJECT
  instrilo deps lock PROJECT
  instrilo deps install PROJECT

TypeScript: lock runs npm install --package-lock-only --ignore-scripts; install
runs npm ci --ignore-scripts. Python: lock runs uv lock; install runs uv sync
--locked, refusing dependency changes that would require updating the lock.
These commands may download public registry packages and run package-manager
build tooling. Review dependency changes and keep separate framework environments.
NB_AGENT_PYTHON selects the Python interpreter when supplied.

prepare is the convenience dependency preparation path and may resolve changes.
Use deps install when your workflow requires an existing consistent lock.
Generation preserves user-owned package-lock.json/uv.lock files. A stale lock
is reported; regeneration does not silently solve a new dependency graph.
Lock presence alone is not a platform, container, model or supply-chain guarantee.
```

### Recorded runs and durable execution

Available offline: `instrilo explain runs`.

```text
  instrilo runs start PROJECT --input 'Draft a reply' --record-content
  instrilo runs list PROJECT
  instrilo runs show RUN_ID PROJECT
  instrilo runs resume RUN_ID PROJECT
  instrilo runs recover-lock RUN_ID PROJECT

Available for native and LangGraph in Python/TypeScript with supported API/demo
connections; subscription CLI runtimes and other frameworks are rejected.
Recording is opt-in because it stores task input, model messages and tool results
under .instrilo/runs. Known secrets are scrubbed; inspect content before sharing.
A redacted record may not be faithfully replayable. Ordinary run stays unrecorded.

Completed I/O steps persist before subsequent work. Resume reruns the pinned
agent and consumes recorded completed responses before making new calls.
A required approval pauses before dispatch. An external operation started without
a confirmed result becomes needs_reconciliation; it is never auto-retried.
Runs bind the build and original caller/tenant/scope context. Changed code or
configuration rejects resume. Scoped tools still enforce their runtime policy.
If start supplies --caller, --tenant, or --scopes, pass matching values when resuming
or replaying. Omitted values resolve to the current local operator/environment.

Exit 3 means paused or needs_reconciliation, not successful task completion.
Concurrent resume/approval attempts use an exclusive run lock. Lock recovery
checks that the recorded local process is no longer alive. This is local durable
execution, not a hosted multi-user workflow service or distributed database.
```

### Review, approve, deny and reconcile exact actions

Available offline: `instrilo explain approvals`.

```text
  instrilo approvals show RUN_ID PROJECT
  instrilo approvals approve RUN_ID PROJECT --digest EXACT_DIGEST --expires-in 300 --reviewer Nimesh
  instrilo runs resume RUN_ID PROJECT
  instrilo approvals deny RUN_ID PROJECT --digest EXACT_DIGEST --reviewer Nimesh

Inspect the pending tool name, arguments, caller and tenant before using its
digest. Approval binds run/build/step/arguments/context, has an expiry, and is
claimed once under a lock before dispatch. Reusing it, changing arguments, denying
it, or letting it expire cannot silently permit the action. Approval does not
resume work automatically. The reviewer label is audit metadata; local OS file
ownership authenticates the operator. This is not remote RBAC or a tenant portal.
--expires-in accepts more than 0 and at most 3600 seconds; it must resolve to a whole
number of milliseconds. Denied or expired approval decisions cannot be renewed.

If a write may have happened but the response was lost, verify its outcome in the
external system first. Then record the confirmed response without repeating it:
  instrilo approvals reconcile RUN_ID PROJECT --digest EXACT_DIGEST --file confirmed-response.json --note 'Verified draft ID in the target system.'
  instrilo runs resume RUN_ID PROJECT

No system can promise universal exactly-once external effects after an ambiguous
network failure. Reconciliation is explicit; model/user text cannot approve itself.
```

### Frozen replay and portable failure bundles

Available offline: `instrilo explain replay`.

```text
  instrilo runs replay RUN_ID PROJECT
  instrilo runs export RUN_ID PROJECT --output issue-bundle.json
  instrilo runs export RUN_ID PROJECT --include-content --output private-bundle.json
  instrilo runs inspect-bundle issue-bundle.json
  instrilo runs replay-bundle private-bundle.json PROJECT --execute-local

Replay actually invokes the current pinned generated agent against recorded model
and tool responses. Strict request ordering/hash matching rejects missing or
changed fixtures; there is no fallback to live traffic. Result includes matched,
output comparison and zero live model/tool calls. Incomplete or redacted traces
may be inspectable but not replayable. Custom code is still trusted local code;
this interception contract is not an OS sandbox for arbitrary user modifications.

Exports omit input/output/request/response content by default. --include-content
adds scrubbed content; inspect it before sharing. Imports validate bounded data
and render a graph without executing anything. An explicit replay-bundle
--execute-local invokes an already-built matching trusted local project against
complete unredacted fixtures. It never installs or runs imported code. Metadata
exports remain inspect-only. Counterfactual live-model replay is not a hidden
option. Changing a model/build requires a new recorded run.
```

### Inspect real execution graphs

Available offline: `instrilo explain graphs`.

```text
  instrilo runs graph RUN_ID PROJECT --format mermaid
  instrilo runs graph RUN_ID PROJECT --format json

The graph is derived from persisted run events: actual model/tool steps, states,
approval pauses, errors and completion. Mermaid can be pasted into compatible
Markdown viewers; JSON preserves node/edge data for other tools.
This view explains a recorded trajectory. It is not a drag-and-drop framework
editor and does not claim arbitrary round-trip graph conversion. Native and
LangGraph durable flows share the event/approval contract in both languages.
```

### Trusted adapter development and conformance

Available offline: `instrilo explain adapters`.

```text
  instrilo adapters catalog
  instrilo adapters init ./my-adapter --id my-adapter --kind target
  instrilo adapters inspect ./my-adapter
  instrilo adapters install ./my-adapter PROJECT --trust-code
  instrilo adapters test my-adapter PROJECT
  instrilo adapters list PROJECT
  instrilo build PROJECT --overwrite
  instrilo adapters remove my-adapter PROJECT

Kinds: provider, framework, target, host. API v1 adapter.json declares ID, semver,
entry.mjs, languages, operations (generate/complete) and permissions.environment,
network/filesystem intent. Bundles are bounded, dependency-bundled JS; no hidden
files, symlinks, credentials or node_modules. entry.mjs exports async default
function(request). Request has apiVersion:"1", operation and operation inputs.

Generate receives spec and inspected guidance; returns {artifacts:[{path,content}]}.
Paths must be extensions/ADAPTER_ID/*, non-executable and unique. Extension files
are managed by safe regeneration. Framework/target/host generators augment the
built-in project; they cannot secretly replace protected runtime/security code.
Provider complete returns {model,message:{role:"assistant",content},usage?};
tool_calls may use OpenAI function envelopes. Unknown/invalid input must reject.

Provider use:
  instrilo adapters init ./provider-adapter --id local-provider --kind provider
  instrilo adapters install ./provider-adapter PROJECT --trust-code
  instrilo adapters test local-provider PROJECT
  instrilo adapters serve local-provider PROJECT --token-env ADAPTER_GATEWAY_TOKEN
Configure its printed /v1 endpoint as a gateway connection with bearer-env auth.
The example provider returns labeled fixture output; implement it before live use.

Installed code is content-pinned. Changes require explicit inspect/reinstall
--replace. Adapter hashes enter generation metadata. Conformance tests validate
local envelopes, language generation and invalid-input rejection. They withhold
forwarded credentials. Passing these is not live-provider/SDK/security certification.
--trust-code means trusted local executable code: environment forwarding is
allowlisted, but plugins can access their OS user's filesystem/network. This is
not a plugin sandbox. Review source before installing any third-party extension.
```

### Platform prerequisites, local tests, cleanup and cloud delivery

Available offline: `instrilo explain deployment`.

```text
Inspect requirements and test your generated deployment before publishing:

  instrilo deployment platforms
  instrilo deployment guide PROJECT
  instrilo deployment prerequisites PROJECT --engine docker
  instrilo deployment engine status
  instrilo deployment engine install podman
  instrilo deployment engine install podman --execute
  instrilo deployment engine start podman
  instrilo deployment engine start podman --execute
  instrilo deployment test PROJECT --engine podman
  instrilo deployment test PROJECT --engine podman --execute
  instrilo deployment reports PROJECT
  instrilo deployment cleanup RUN_ID PROJECT
  instrilo deployment cleanup RUN_ID PROJECT --execute
  instrilo deployment engine cleanup podman
  instrilo deployment engine cleanup podman --execute

Every install/start/test/cleanup command previews its plan by default. --execute
authorizes that operation. Test execution may download public base images and
runtime packages and use local CPU/disk. It does not provision a cloud service or
call a paid model. Build first, then inspect the test plan and selected engine.
--keep retains test resources for inspection; otherwise cleanup runs after the
test, including failures. JSON and Markdown evidence remain in the project's
.instrilo/deployment-tests directory. Read the report's actual checks, mocks,
unverified requirements and cleanup results; a local pass is not cloud validation.

Tests exercise the generated Dockerfile, selected language/framework and HTTP
server with fixture model and identity services. No real provider credentials
are supplied. Reports state which services were mocked and which cloud behavior
still needs verification, including IAM, secret-manager access, regions and quota.
An unavailable engine or unsupported architecture/emulation is a failed prerequisite,
not a simulated pass. AWS tests require ARM64; Cloud Run/Azure require AMD64.
Native local projects without a container target should use run/eval instead.

Engine status distinguishes a CLI binary from a reachable container server.
Install plans are OS-specific. Supported automatic steps require --execute;
privileged Linux/WSL setup and other unsupported steps give official instructions.
macOS Podman uses an explicitly started named machine owned by Instrilo. Docker
Desktop may need its own first-launch/license acceptance. Instrilo does not
silently start or remove another application's VM or change your default context.

Test cleanup removes only recorded IDs with matching run ownership labels.
Dependency cleanup is separate and opt-in: it requires installation ownership,
checks for shared resources and refuses to uninstall a pre-existing/shared runtime.
For an Instrilo-owned Podman VM only, --remove-machine-data previews its complete
rootless/rootful storage inventory; add --execute to delete that exact VM disk,
including cached base images and any other data listed. Back up wanted data first.
No global prune command is used. Inspect retained failures and retry cleanup when
the engine is available. Some uninstall steps remain manual when ownership or
platform privileges cannot be safely established. Reports are preserved.

In the app, open Code & delivery: prerequisites, guide, test-plan review, reports,
engine installation/startup and cleanup are available there. Execution requires
reviewing the displayed operation. Existing local work is kept intact.

Cloud deployment remains a separate explicit step:

  instrilo config set delivery.target aws-agentcore PROJECT
  instrilo build PROJECT --overwrite
  instrilo artifacts list PROJECT
  instrilo artifacts read DEPLOYMENT.md PROJECT
  instrilo artifacts read deploy/aws-agentcore.sh PROJECT
  instrilo deploy PROJECT
  instrilo deploy PROJECT --execute

Without --execute, deploy displays the selected target/output path and creates no
cloud resource. --execute runs the generated reviewed script using your installed
cloud CLI/account and can create billable resources. Configure IDs, roles, regions,
secret references and required tooling first. Generated artifacts are not proof
that a real deployment passed. Review target preflight and perform a live smoke
check in your account after provisioning.

Before changing a default project's local target, configure and select an API
runtime using explain connections; demo and subscription CLI runtimes are local
only. For Docker, Cloud Run, or Azure, configure inbound JWT using explain gateways
before building. AgentCore's IAM option is a separate hosting boundary.
Docker/Cloud Run/Azure require inbound JWT; AgentCore also supports its IAM boundary.
AgentCore artifacts use arm64 and secret-store references. Cloud scripts do not
provision every identity, memory, gateway, database or autoscaling policy.
Use export --output FILE.zip for owned source delivery. Rebuild the portable
manifest after moving it. Private local run/evidence history is excluded from
normal source exports; use explicit review/run export commands to share it.
```

### Coding tools and desktop/chat hosts

Available offline: `instrilo explain desktop`.

```text
  instrilo config set delivery.hosts '["codex","claude-code","claude-desktop","chatgpt"]' PROJECT --json
  instrilo build PROJECT --overwrite
  instrilo artifacts list PROJECT
  instrilo artifacts read README.md PROJECT

Before building with chatgpt selected, choose an API/gateway runtime and configure
inbound JWT with your real trusted identity provider; see explain connections and
explain gateways. Use only ["codex","claude-code","claude-desktop"] for a local
host demonstration that keeps the default offline runtime.
Codex and Claude Code receive instruction/configuration artifacts. Claude Desktop
receives a local stdio MCP bridge. ChatGPT selection generates a remote HTTP MCP
entry point, requiring an externally reachable HTTPS endpoint and a trusted
identity/OAuth service plus actual client setup. Remote MCP requires API/gateway
runtime, not a subscription CLI. The REST Docker entry point and remote MCP entry
point are separate artifacts; inspect Dockerfile.mcp when appropriate.

Selecting a host does not install a desktop app, log into a subscription, create
an OAuth client, provision HTTPS or connect a real ChatGPT account. The generated
host instructions document exact artifacts/operators' remaining steps. Chat apps,
coding tools, framework runtimes and model billing are independent choices.
```

### Local trust boundaries and safe operation

Available offline: `instrilo explain security`.

```text
The app binds to 127.0.0.1 with a random session token, Host/Origin checks and a
credential-free shell. Keep the printed authenticated URL private. A session token
is not an enterprise login. CLI access follows the local OS user's permissions.

Secrets are environment references. Known patterns are scrubbed/excluded, but no
scanner can guarantee that arbitrary prompts/tool results contain no private data.
Guidance/model/tool output is untrusted task content, never an authorization source.
Scope checks, schema validation, JWT verification, exact-action approval and
resource-specific tool authorization are separate controls.

Generation uses bounded paths and rejects symlinks. Update plans preserve user
files, reject conflicts, journal mutations and protect concurrent changes.
Evidence hashes detect accidental changes; an operator who can rewrite the local
files is inside the trust boundary. Human reviewer strings are not digital signatures.
Adapter code and custom generated code execute as the local OS user. This is not
a hostile-code sandbox. Durable APIs are local-first; remote approval services
need separate authentication and transactional persistence design.

Use project-owned limits, minimal scopes, read-only tools where possible and
reviewed holdout examples. Report vulnerabilities using SECURITY.md in the repo.
```

### Project files and ownership

Available offline: `instrilo explain files`.

```text
agent-studio.yaml       Version-1 source manifest (name retained for compatibility)
guidance/               Product requirements and interview/clarification documents
evals/cases.jsonl       Source dataset, provenance and split
reports/                Saved evaluation reports
generated/              Exportable framework/runtime/delivery source
  build-lock.json       Source/guidance/template/adapter build fingerprints
  .instrilo/            Retained generator baseline, current pointer, recovery journal
  extensions/ID/        Pinned adapter-generated additions
  package-lock.json     Actual npm dependency lock (user-owned)
  uv.lock               Actual Python dependency lock (user-owned)
.instrilo/              Private local authoring state
  evidence/             Requirements, report snapshots, labels, policies and releases
  runs/                 Recorded inputs, I/O, approval decisions and run locks
  adapters/             Content-pinned trusted extension bundles
  adapters.json         Installed adapter registry
  backups/              Earlier CLI-edited configuration/guidance/cases

No npm publication is required for source installs. instrilo is the primary CLI;
nb-agent remains a compatibility alias. NB_AGENT_PYTHON and .studio/projects remain
supported. Normal ZIP exports omit secret/dependency/private state directories.
Never delete recovery locks blindly; inspect their owner and use recovery commands
where provided. Back up projects before major migrations.
```

### Automation, output and exit codes

Available offline: `instrilo explain exit-codes`.

```text
0  Command completed, gate allowed, or plan/inspection printed successfully.
1  Validation, execution, provider, conformance, replay mismatch, or CLI usage error.
2  Release gate evaluated successfully but blocked the proposed release.
3  A durable run paused for approval or needs explicit reconciliation.

A generation dry-run can return conflicts as data with exit 0: inspect conflicts
before applying. Applying conflicts fails with exit 1 and no project file writes.
An ordinary evaluation with failed cases returns exit 1 and still saves its report.
Most commands emit JSON; help/explain emit text, artifacts read emits source,
cases export emits JSONL, runs graph defaults Mermaid and --format json is available.
Commands writing --output create new files and refuse overwrite unless explicitly
documented. Normal operational progress uses stderr. Provider/framework package
install commands can emit their own logs. Do not mistake a saved demo report for
live quality evidence. Use --help on the exact leaf command for machine flags.
```

### Diagnose failures without guessing

Available offline: `instrilo explain troubleshooting`.

```text
Unknown/unsupported configuration: instrilo validate PROJECT, config fields,
config show, adapters catalog. Use config apply for related changes that would
otherwise leave an invalid intermediate configuration.
Missing model access: instrilo connections check PROJECT and doctor PROJECT.
Use instrilo setup PROVIDER for missing CLI dependencies or login.
Read instrilo explain subscriptions for install plans and live verification.
Check named environment variables, selected model IDs and official client login.
A presence check does not perform a billable probe.
Stale build: generation plan, inspect differences, build --overwrite. Local edits
to generated source mirrors should be moved into the source guidance/config first.
Conflicting upgrade: inspect changes, preserve your work, manually resolve or use
--merge only for non-overlapping text edits. Re-plan before --expected-plan apply.
Interrupted update: generation inspect then generation recover; post-crash edits
must be reconciled manually rather than overwritten.
Dependency mismatch: deps status; review updated manifests, deps lock, deps install.
Python selection: NB_AGENT_PYTHON and the project's .venv; use separate environments.
Recorded run paused: approvals show, inspect exact action, approve/deny, runs resume.
Ambiguous write: independently verify external result, approvals reconcile; do not
rerun blindly. Failed replay: check build/fixture hashes and missing/redacted events.
Blocked release: read issues in the decision JSON; requirements status and review
assessments explain uncovered, stale, unreviewed, disagreed or failed evidence.
App: use the complete newly printed local URL after a restart. A stale token fails.
Native Windows: use WSL for this release; do not assume POSIX cancellation parity.
For bug reports include sanitized commands, versions and a metadata-only run bundle.
```

## Every command, argument, and option

### instrilo

Instrilo — turn product guidance into agents, evaluations and deployment artifacts.

```text
instrilo
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `-V, --version` | no | — | output the version number |

Every command also accepts `-h, --help`.

Guide: `instrilo explain overview`.

### instrilo init

Create a project with explicit offline defaults; configure connections before live use.

```text
instrilo init <name>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | yes | — | project slug, or existing tool name for tools remove |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `-d, --directory <directory>` | no | . | parent directory |
| `-l, --language <language>` | no | typescript | python or typescript |

Every command also accepts `-h, --help`.

```sh
instrilo init support-agent --language python --directory .studio/projects
```

Guide: `instrilo explain quickstart`.

### instrilo guidance

Create and inspect a product guidance directory.

```text
instrilo guidance
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain guidance`.

### instrilo guidance create

Ask the ten product questions and write a reviewable guidance document.

```text
instrilo guidance create <directory>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `directory` | yes | — | source or destination directory; see command description |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--answers <file>` | no | — | JSON answers for noninteractive creation |

Every command also accepts `-h, --help`.

```sh
instrilo guidance create ./DIRECTORY
```

Guide: `instrilo explain guidance`.

### instrilo guidance inspect

Inventory guidance, detect missing decisions, and show excluded files.

```text
instrilo guidance inspect <directory>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `directory` | yes | — | source or destination directory; see command description |

Every command also accepts `-h, --help`.

```sh
instrilo guidance inspect ./DIRECTORY
```

Guide: `instrilo explain guidance`.

### instrilo guidance questions

Print all interview questions and machine-readable answer keys.

```text
instrilo guidance questions
```

Every command also accepts `-h, --help`.

```sh
instrilo guidance questions
```

Guide: `instrilo explain guidance`.

### instrilo guidance answers-template

Print a JSON answer object for unattended guidance creation.

```text
instrilo guidance answers-template
```

Every command also accepts `-h, --help`.

```sh
instrilo guidance answers-template
```

Guide: `instrilo explain guidance`.

### instrilo guidance list

Inspect the current project guidance, file hashes, exclusions and missing decisions.

```text
instrilo guidance list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo guidance list
```

Guide: `instrilo explain guidance`.

### instrilo guidance read

Read an eligible project guidance file and its current hash.

```text
instrilo guidance read <path> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `path` | yes | — | relative file path within the selected project |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo guidance read purpose.md
```

Guide: `instrilo explain guidance`.

### instrilo guidance write

Create or safely replace one eligible project guidance document.

```text
instrilo guidance write <path> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `path` | yes | — | relative file path within the selected project |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | source UTF-8 text file |
| `--text <text>` | no | — | literal text |
| `--replace` | no | — | replace an existing file |
| `--expected-sha <hash>` | no | — | required current hash when replacing |

Every command also accepts `-h, --help`.

```sh
instrilo guidance write operations.md PROJECT --text "Escalate billing disputes."
instrilo guidance write purpose.md PROJECT --file revised.md --replace --expected-sha HASH
```

Guide: `instrilo explain guidance`.

### instrilo create

Create a project from an existing guidance directory.

```text
instrilo create <name>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | yes | — | project slug, or existing tool name for tools remove |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--guidance <directory>` | yes | — | existing guidance directory |
| `-d, --directory <directory>` | no | . | parent project directory |
| `-l, --language <language>` | no | — | python or typescript |
| `--framework <framework>` | no | — | native, langgraph, openai-agents, crewai |
| `--target <target>` | no | — | delivery target |
| `--config <file>` | no | — | complete connection/spec YAML |

Every command also accepts `-h, --help`.

```sh
instrilo create research-agent --guidance ./product-guidance --framework native
```

Guide: `instrilo explain quickstart`.

### instrilo validate

Validate configuration and provider/framework/target compatibility.

```text
instrilo validate [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

Every command also accepts `-h, --help`.

```sh
instrilo validate
```

### instrilo plan

Ask the builder to synthesize instructions and identify unresolved questions.

```text
instrilo plan [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--apply` | no | — | save the proposed description and instructions |
| `--interview` | no | — | answer the builder’s specific follow-up questions and refine again |

Every command also accepts `-h, --help`.

```sh
instrilo plan PROJECT --interview --apply
```

Guide: `instrilo explain guidance`.

### instrilo build

Generate framework code, host packages, tests and target deployment artifacts.

```text
instrilo build [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `-o, --output <directory>` | no | — | generated project destination |
| `--overwrite` | no | — | safely regenerate existing files; conflicts stop before writing |
| `--dry-run` | no | — | show file decisions and plan hash without writing |
| `--merge` | no | — | attempt conservative non-overlapping three-way text merges |
| `--expected-plan <hash>` | no | — | apply only the exact reviewed generation plan |

Every command also accepts `-h, --help`.

```sh
instrilo build PROJECT
instrilo build PROJECT --dry-run
instrilo build PROJECT --overwrite --merge --expected-plan HASH
```

Guide: `instrilo explain regeneration`.

### instrilo prepare

Install generated runtime dependencies using npm or uv.

```text
instrilo prepare [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

Every command also accepts `-h, --help`.

```sh
instrilo prepare
```

Guide: `instrilo explain dependencies`.

### instrilo run

Run the actual generated agent locally. Provider usage may be billed.

```text
instrilo run [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `-i, --input <text>` | yes | — | agent input |

Every command also accepts `-h, --help`.

```sh
instrilo run PROJECT --input "Draft a response"
```

Guide: `instrilo explain runs`.

### instrilo eval

Run deterministic checks and the selected judge against the generated agent.

```text
instrilo eval [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--split <split>` | no | all | development, holdout, or all |
| `--output <path>` | no | — | report JSON destination |

Every command also accepts `-h, --help`.

```sh
instrilo eval PROJECT --split holdout --output PROJECT/reports/holdout.json
```

Guide: `instrilo explain evaluations`.

### instrilo compare

Compare two evaluation reports and list regressions.

```text
instrilo compare <previous> <current>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `previous` | yes | — | previous evaluation report JSON file |
| `current` | yes | — | current evaluation report JSON file |

Every command also accepts `-h, --help`.

```sh
instrilo compare PREVIOUS CURRENT
```

Guide: `instrilo explain evaluations`.

### instrilo doctor

Check configuration, environment references and installed CLI binaries without model calls.

```text
instrilo doctor [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

Every command also accepts `-h, --help`.

```sh
instrilo doctor
```

Guide: `instrilo explain troubleshooting`.

### instrilo providers

List supported connection capabilities and restrictions.

```text
instrilo providers
```

Every command also accepts `-h, --help`.

```sh
instrilo providers
```

Guide: `instrilo explain connections`.

### instrilo deploy

Show generated delivery instructions; --execute runs the target script you configured.

```text
instrilo deploy [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory or manifest |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--execute` | no | — | execute generated deployment script (requires configured cloud CLI and variables) |

Every command also accepts `-h, --help`.

```sh
instrilo deploy PROJECT
instrilo deploy PROJECT --execute
```

Guide: `instrilo explain deployment`.

### instrilo app

Open the local web application backed by the same core as the CLI.

```text
instrilo app
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--workspace <directory>` | no | .studio/projects | project workspace |
| `--port <number>` | no | 4317 | local HTTP port |

Every command also accepts `-h, --help`.

```sh
instrilo app --workspace .studio/projects --port 4317
```

Guide: `instrilo explain overview`.

### instrilo projects

Discover project workspaces and inspect their source/configuration.

```text
instrilo projects
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain files`.

### instrilo projects list

List projects in a workspace with language, framework, target and modification time.

```text
instrilo projects list
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--workspace <directory>` | no | .studio/projects | directory containing projects |

Every command also accepts `-h, --help`.

```sh
instrilo projects list
```

Guide: `instrilo explain files`.

### instrilo projects show

Show project configuration, inspected guidance and dataset summary.

```text
instrilo projects show [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo projects show
```

Guide: `instrilo explain files`.

### instrilo config

Inspect and atomically update every manifest field with validation and backups.

```text
instrilo config
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain configuration`.

### instrilo config show

Print the complete validated manifest as JSON or YAML, optionally with its file hash.

```text
instrilo config show [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--yaml` | no | — | print YAML instead of JSON |
| `--hash` | no | — | include the manifest SHA-256 for optimistic edits |

Every command also accepts `-h, --help`.

```sh
instrilo config show
```

Guide: `instrilo explain configuration`.

### instrilo config template

Print a complete valid offline manifest to customize or apply.

```text
instrilo config template
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--name <name>` | no | my-agent | project slug |
| `--language <language>` | no | typescript | python or typescript |
| `--yaml` | no | — | print YAML |

Every command also accepts `-h, --help`.

```sh
instrilo config template
```

Guide: `instrilo explain configuration`.

### instrilo config get

Read one dotted field, e.g. roles.runtime or security.inbound.

```text
instrilo config get <field> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `field` | yes | — | dotted manifest field such as agent.limits.maxSteps |
| `project` | no | . | project directory |

Every command also accepts `-h, --help`.

```sh
instrilo config get agent.limits
```

Guide: `instrilo explain configuration`.

### instrilo config set

Set a dotted field; validation rejects unsupported combinations and unknown keys.

```text
instrilo config set <field> <value> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `field` | yes | — | dotted manifest field such as agent.limits.maxSteps |
| `value` | yes | — | literal string, or JSON when --json is passed |
| `project` | no | . | project directory |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--json` | no | — | parse value as JSON (objects, arrays, numbers, booleans) |
| `--expected-sha <hash>` | no | — | refuse changes if the manifest was edited since inspection |

Every command also accepts `-h, --help`.

```sh
instrilo config set agent.limits.maxSteps 12 PROJECT --json
```

Guide: `instrilo explain configuration`.

### instrilo config apply

Atomically replace the complete manifest from JSON/YAML; useful for interdependent changes.

```text
instrilo config apply [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a JSON or YAML document from a bounded regular file |
| `--data <json>` | no | — | supply a JSON value directly (never put credentials in arguments) |
| `--expected-sha <hash>` | no | — | current manifest hash |

Every command also accepts `-h, --help`.

```sh
instrilo config apply PROJECT --file complete-config.yaml
```

Guide: `instrilo explain configuration`.

### instrilo config fields

List every manifest field and its default type/value. Use explain configuration for constraints.

```text
instrilo config fields
```

Every command also accepts `-h, --help`.

```sh
instrilo config fields
```

Guide: `instrilo explain configuration`.

### instrilo connections

Manage named model connections and choose builder/runtime/judge independently.

```text
instrilo connections
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain connections`.

### instrilo connections list

List named model connections and the three role assignments.

```text
instrilo connections list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo connections list
```

Guide: `instrilo explain connections`.

### instrilo connections add

Add a named connection using a JSON/YAML connection object.

```text
instrilo connections add <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a JSON or YAML document from a bounded regular file |
| `--data <json>` | no | — | supply a JSON value directly (never put credentials in arguments) |
| `--replace` | no | — | replace an existing connection explicitly |

Every command also accepts `-h, --help`.

```sh
instrilo connections add gateway PROJECT --data '{"kind":"gateway","model":"MODEL_ID","baseUrl":"https://gateway.example/v1","auth":{"type":"bearer-env","env":"GATEWAY_TOKEN"}}'
```

Guide: `instrilo explain connections`.

### instrilo connections remove

Remove a connection only after its roles have been reassigned.

```text
instrilo connections remove <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo connections remove ID
```

Guide: `instrilo explain connections`.

### instrilo connections use

Assign builder, runtime, or judge to an existing named connection.

```text
instrilo connections use <role> <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `role` | yes | — | builder, runtime, or judge |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo connections use judge gateway PROJECT
```

Guide: `instrilo explain connections`.

### instrilo connections check

Check environment references/client availability without making a model request.

```text
instrilo connections check [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo connections check
```

Guide: `instrilo explain connections`.

### instrilo connections example

Print a complete connection example; all secrets are environment references.

```text
instrilo connections example <provider>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `provider` | yes | — | provider kind from instrilo providers |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--model <id>` | no | REPLACE_MODEL_ID | model ID supported by your account |

Every command also accepts `-h, --help`.

```sh
instrilo connections example openai --model YOUR_MODEL
```

Guide: `instrilo explain connections`.

### instrilo tools

Manage portable HTTP tools, input schemas, scopes and approval requirements.

```text
instrilo tools
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain tools`.

### instrilo tools list

List configured HTTP tools, scopes, schemas and approval requirements.

```text
instrilo tools list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo tools list
```

Guide: `instrilo explain tools`.

### instrilo tools add

Add a strict ToolSpec; see tools example.

```text
instrilo tools add [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a JSON or YAML document from a bounded regular file |
| `--data <json>` | no | — | supply a JSON value directly (never put credentials in arguments) |
| `--replace` | no | — | replace a tool of the same name |

Every command also accepts `-h, --help`.

```sh
instrilo tools example > tool.json
instrilo explain tools
instrilo tools add PROJECT --file tool.json
```

Guide: `instrilo explain tools`.

### instrilo tools remove

Remove an existing tool by name, validate and back up the manifest.

```text
instrilo tools remove <name> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | yes | — | project slug, or existing tool name for tools remove |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo tools remove create_draft PROJECT
```

Guide: `instrilo explain tools`.

### instrilo tools example

Print a guarded write-tool example to edit and add.

```text
instrilo tools example
```

Every command also accepts `-h, --help`.

```sh
instrilo tools example
```

Guide: `instrilo explain tools`.

### instrilo cases

Create, inspect, import, export and revise evaluation datasets with provenance.

```text
instrilo cases
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain evaluations`.

### instrilo cases list

Print validated evaluation cases, optionally filtered by split.

```text
instrilo cases list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--split <split>` | no | all | development, holdout, or all |

Every command also accepts `-h, --help`.

```sh
instrilo cases list
```

Guide: `instrilo explain evaluations`.

### instrilo cases add

Append one complete case; see cases example.

```text
instrilo cases add [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a JSON or YAML document from a bounded regular file |
| `--data <json>` | no | — | supply a JSON value directly (never put credentials in arguments) |

Every command also accepts `-h, --help`.

```sh
instrilo cases add --file ./INPUT.json
```

Guide: `instrilo explain evaluations`.

### instrilo cases import

Import JSON array, JSONL, or YAML cases; duplicates are rejected.

```text
instrilo cases import [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a JSON or YAML document from a bounded regular file |
| `--data <json>` | no | — | supply a JSON value directly (never put credentials in arguments) |
| `--replace` | no | — | replace the dataset instead of appending |

Every command also accepts `-h, --help`.

```sh
instrilo cases import --file ./INPUT.json
```

Guide: `instrilo explain evaluations`.

### instrilo cases remove

Remove one case by ID; the remaining dataset must remain valid.

```text
instrilo cases remove <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo cases remove ID
```

Guide: `instrilo explain evaluations`.

### instrilo cases update

Replace one case with a complete object; ID must remain the same.

```text
instrilo cases update <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a JSON or YAML document from a bounded regular file |
| `--data <json>` | no | — | supply a JSON value directly (never put credentials in arguments) |

Every command also accepts `-h, --help`.

```sh
instrilo cases update ID --file ./INPUT.json
```

Guide: `instrilo explain evaluations`.

### instrilo cases export

Export validated cases as JSONL to stdout or a new file.

```text
instrilo cases export [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--output <path>` | no | — | write JSONL to a new file; otherwise print JSONL |

Every command also accepts `-h, --help`.

```sh
instrilo cases export
```

Guide: `instrilo explain evaluations`.

### instrilo cases example

Print a synthetic case; review and edit before marking reviewed or holdout.

```text
instrilo cases example
```

Every command also accepts `-h, --help`.

```sh
instrilo cases example
```

Guide: `instrilo explain evaluations`.

### instrilo artifacts

Inspect generated source and delivery files without launching the agent.

```text
instrilo artifacts
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain files`.

### instrilo artifacts list

List exportable generated files while excluding secrets and private state.

```text
instrilo artifacts list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo artifacts list
```

Guide: `instrilo explain files`.

### instrilo artifacts read

Print one eligible generated source or delivery file as text.

```text
instrilo artifacts read <path> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `path` | yes | — | relative file path within the selected project |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo artifacts read README.md
```

Guide: `instrilo explain files`.

### instrilo export

Export generated source, portable manifest, guidance and cases as a bounded ZIP.

```text
instrilo export [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--output <path>` | yes | — | new ZIP filename (existing files are never overwritten) |

Every command also accepts `-h, --help`.

```sh
instrilo export --output OUTPUT
```

Guide: `instrilo explain files`.

### instrilo reports

List and inspect saved evaluation reports.

```text
instrilo reports
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain evaluations`.

### instrilo reports list

List saved evaluation JSON files in the selected project.

```text
instrilo reports list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo reports list
```

Guide: `instrilo explain evaluations`.

### instrilo reports show

Validate the file boundary and print one saved project report.

```text
instrilo reports show <path> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `path` | yes | — | relative file path within the selected project |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo reports show reports/REPORT.json
```

Guide: `instrilo explain evaluations`.

### instrilo adapters

Inspect built-in capabilities; develop, pin and test trusted community extensions.

```text
instrilo adapters
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain adapters`.

### instrilo adapters catalog

Show providers, framework/language support, targets, hosts and extension boundaries.

```text
instrilo adapters catalog
```

Every command also accepts `-h, --help`.

```sh
instrilo adapters catalog
```

Guide: `instrilo explain adapters`.

### instrilo adapters init

Create a dependency-free runnable adapter and manifest.

```text
instrilo adapters init <directory>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `directory` | yes | — | source or destination directory; see command description |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--id <slug>` | yes | — | unique adapter ID |
| `--kind <kind>` | no | target | provider, framework, target, or host |

Every command also accepts `-h, --help`.

```sh
instrilo adapters init ./deploy-notes --id deploy-notes --kind target
```

Guide: `instrilo explain adapters`.

### instrilo adapters inspect

Validate a bundle and display its permissions and content pin without executing it.

```text
instrilo adapters inspect <directory>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `directory` | yes | — | source or destination directory; see command description |

Every command also accepts `-h, --help`.

```sh
instrilo adapters inspect ./DIRECTORY
```

Guide: `instrilo explain adapters`.

### instrilo adapters install

Copy and pin a reviewed bundle; generators run on subsequent builds.

```text
instrilo adapters install <directory> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `directory` | yes | — | source or destination directory; see command description |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--trust-code` | no | — | acknowledge that this adapter executes trusted local code, not a sandbox |
| `--replace` | no | — | explicitly replace an existing adapter pin |

Every command also accepts `-h, --help`.

```sh
instrilo adapters inspect ./extension
instrilo adapters install ./extension PROJECT --trust-code
```

Guide: `instrilo explain adapters`.

### instrilo adapters list

List installed trusted adapter manifests, versions and content pins.

```text
instrilo adapters list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo adapters list
```

Guide: `instrilo explain adapters`.

### instrilo adapters remove

Disable the adapter; retain its pinned files and rebuild to remove unchanged generated extensions.

```text
instrilo adapters remove <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo adapters remove ID
```

Guide: `instrilo explain adapters`.

### instrilo adapters test

Run local interface conformance with no forwarded provider credentials.

```text
instrilo adapters test <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo adapters test ID
```

Guide: `instrilo explain adapters`.

### instrilo adapters serve

Run a provider adapter as an authenticated loopback OpenAI-compatible gateway.

```text
instrilo adapters serve <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--port <number>` | no | 4320 | local port |
| `--token-env <name>` | yes | — | environment variable containing a private bearer token (at least 24 characters) |

Every command also accepts `-h, --help`.

```sh
instrilo adapters serve local-provider PROJECT --token-env ADAPTER_GATEWAY_TOKEN
```

Guide: `instrilo explain adapters`.

### instrilo requirements

Track guidance requirements, human-reviewed evidence links, stale sources and explicit waivers.

```text
instrilo requirements
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain requirements`.

### instrilo requirements add

Add one requirement. Fields: id, text, sourcePath; optional title, reviewer, reason.

```text
instrilo requirements add [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |

Every command also accepts `-h, --help`.

```sh
instrilo requirements example > requirement.json
instrilo requirements add PROJECT --file requirement.json
```

Guide: `instrilo explain requirements`.

### instrilo requirements import

Import a requirement array or {schemaVersion:"1",requirements:[...]}.

```text
instrilo requirements import [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |

Every command also accepts `-h, --help`.

```sh
instrilo requirements import --file ./INPUT.json
```

Guide: `instrilo explain requirements`.

### instrilo requirements list

List recorded requirements, source hashes, review metadata and case links.

```text
instrilo requirements list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo requirements list
```

Guide: `instrilo explain requirements`.

### instrilo requirements status

Show proposed, stale-source, uncovered, stale-link, ready and waived requirements.

```text
instrilo requirements status [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo requirements status
```

Guide: `instrilo explain requirements`.

### instrilo requirements update

Update a requirement and invalidate earlier review/link fingerprints.

```text
instrilo requirements update <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |
| `--expected-revision <number>` | no | — | refuse if this requirement revision changed |

Every command also accepts `-h, --help`.

```sh
instrilo requirements update ID --file ./INPUT.json
```

Guide: `instrilo explain requirements`.

### instrilo requirements link

Link a human-reviewed case to an exact requirement version.

```text
instrilo requirements link <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--case <id>` | yes | — | existing case ID |
| `--kind <kind>` | yes | — | deterministic, judge or human |
| `--reviewer <name>` | yes | — | person who reviewed this relationship |
| `--reason <text>` | yes | — | why this case covers the requirement |

Every command also accepts `-h, --help`.

```sh
instrilo requirements link billing-human PROJECT --case billing-escalation --kind deterministic --reviewer Nimesh --reason "Checks escalation wording."
```

Guide: `instrilo explain requirements`.

### instrilo requirements unlink

Remove obsolete coverage links and preserve an audited reason and prior snapshot.

```text
instrilo requirements unlink <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--case <id>` | yes | — | case whose links should be removed |
| `--kind <kind>` | no | — | remove only deterministic, judge or human links; default removes all kinds for this case |
| `--reviewer <name>` | yes | — | person removing this relationship |
| `--reason <text>` | yes | — | why this link is obsolete |

Every command also accepts `-h, --help`.

```sh
instrilo requirements unlink billing-human PROJECT --case billing-escalation --kind deterministic --reviewer Nimesh --reason "Case replaced after review."
```

Guide: `instrilo explain requirements`.

### instrilo requirements waive

Record a reasoned waiver; release policy must separately allow waivers.

```text
instrilo requirements waive <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--reviewer <name>` | yes | — | responsible reviewer |
| `--reason <text>` | yes | — | explicit reason |
| `--expires-at <date>` | no | — | ISO8601 expiry |

Every command also accepts `-h, --help`.

```sh
instrilo requirements waive ID --reviewer REVIEWER --reason REASON
```

Guide: `instrilo explain requirements`.

### instrilo requirements example

Print an example requirement document to edit and review before import.

```text
instrilo requirements example
```

Every command also accepts `-h, --help`.

```sh
instrilo requirements example
```

Guide: `instrilo explain requirements`.

### instrilo evidence

Register immutable evaluation reports and inspect requirement coverage.

```text
instrilo evidence
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain requirements`.

### instrilo evidence register

Register a report snapshot by immutable ID. CLI/app eval also register automatically.

```text
instrilo evidence register [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |

Every command also accepts `-h, --help`.

```sh
instrilo evidence register --file ./INPUT.json
```

Guide: `instrilo explain requirements`.

### instrilo evidence status

Inspect current guidance/case fingerprints and requirement coverage status.

```text
instrilo evidence status [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo evidence status
```

Guide: `instrilo explain requirements`.

### instrilo release

Evaluate the project-owned release gate; exit 2 when blocked. Does not deploy.

```text
instrilo release [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--report <id-or-path>` | yes | — | registered report ID or JSON path within the project |
| `--policy <file>` | no | — | explicit policy JSON/YAML; otherwise use project policy |
| `--output <file>` | no | — | write the release decision to a new file |

Every command also accepts `-h, --help`.

```sh
instrilo release PROJECT --report REPORT_ID --output release-decision.json
```

Guide: `instrilo explain release`.

### instrilo policy

Inspect and set versioned release policy; defaults reject demo, synthetic and uncovered evidence.

```text
instrilo policy
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain release`.

### instrilo policy template

Print the versioned strict-default release policy as JSON.

```text
instrilo policy template
```

Every command also accepts `-h, --help`.

```sh
instrilo policy template
```

Guide: `instrilo explain release`.

### instrilo policy show

Show the effective saved policy or strict defaults when none is saved.

```text
instrilo policy show [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo policy show
```

Guide: `instrilo explain release`.

### instrilo policy apply

Validate and atomically save an explicit project-owned release policy.

```text
instrilo policy apply [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |

Every command also accepts `-h, --help`.

```sh
instrilo policy apply --file ./INPUT.json
```

Guide: `instrilo explain release`.

### instrilo review

Review exact outputs blindly, retain immutable labels, and calibrate judges against humans.

```text
instrilo review
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain review`.

### instrilo review queue

Show exact evaluated outputs and binding hashes; automated/prior human verdicts are hidden by default.

```text
instrilo review queue [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--report <id-or-path>` | yes | — | evaluation report |
| `--unblind` | no | — | include judge/check results and prior human verdicts |
| `--output <file>` | no | — | write the queue to a new JSON file |

Every command also accepts `-h, --help`.

```sh
instrilo review queue PROJECT --report REPORT_ID
```

Guide: `instrilo explain review`.

### instrilo review label

Append a bound human label: reportId, caseId, verdict, reviewer, reason, optional binding/supersedes.

```text
instrilo review label [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |

Every command also accepts `-h, --help`.

```sh
instrilo review label --file ./INPUT.json
```

Guide: `instrilo explain review`.

### instrilo review import

Import a versioned label export. Binding checksums and original report snapshots must match.

```text
instrilo review import [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |

Every command also accepts `-h, --help`.

```sh
instrilo review import --file ./INPUT.json
```

Guide: `instrilo explain review`.

### instrilo review export

Export immutable human-label history, including superseded corrections.

```text
instrilo review export [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--output <file>` | no | — | write labels to a new JSON file |

Every command also accepts `-h, --help`.

```sh
instrilo review export
```

Guide: `instrilo explain review`.

### instrilo review assessments

Inspect active human consensus, abstentions and unresolved disagreements for each case.

```text
instrilo review assessments [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--report <id-or-path>` | yes | — | report |

Every command also accepts `-h, --help`.

```sh
instrilo review assessments --report REPORT
```

Guide: `instrilo explain review`.

### instrilo review calibrate

Report sample size, judge-human agreement, false passes/fails and disagreements.

```text
instrilo review calibrate [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--report <id-or-path>` | yes | — | report |

Every command also accepts `-h, --help`.

```sh
instrilo review calibrate --report REPORT
```

Guide: `instrilo explain review`.

### instrilo review example

Print an example human label to edit; include the blind queue binding for asynchronous review.

```text
instrilo review example
```

Every command also accepts `-h, --help`.

```sh
instrilo review example
```

Guide: `instrilo explain review`.

### instrilo generation

Plan safe rebuilds, inspect retained baselines, migrate old builds and recover interrupted updates.

```text
instrilo generation
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain regeneration`.

### instrilo generation plan

Preview additions, updates, preserved edits and conflicts without writing project files.

```text
instrilo generation plan [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--merge` | no | — | attempt conservative non-overlapping three-way text merges |
| `--output-directory <path>` | no | — | custom generated directory |

Every command also accepts `-h, --help`.

```sh
instrilo generation plan PROJECT --merge
```

Guide: `instrilo explain regeneration`.

### instrilo generation inspect

Inspect the retained baseline, source fingerprints, lock and recovery status.

```text
instrilo generation inspect [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo generation inspect
```

Guide: `instrilo explain regeneration`.

### instrilo generation recover

Roll back an interrupted transaction only when affected files still match its journal.

```text
instrilo generation recover [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo generation recover
```

Guide: `instrilo explain regeneration`.

### instrilo generation migrate

Preview legacy generation-state migration; --apply writes a backed-up migration.

```text
instrilo generation migrate [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--apply` | no | — | apply the backward-compatible baseline migration; default is preview |

Every command also accepts `-h, --help`.

```sh
instrilo generation migrate
```

Guide: `instrilo explain regeneration`.

### instrilo deps

Inspect, create and enforce actual npm/uv dependency locks. Registry access may be required.

```text
instrilo deps
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain dependencies`.

### instrilo deps status

Inspect actual dependency lock presence, hashes and manifest consistency.

```text
instrilo deps status [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo deps status
```

Guide: `instrilo explain dependencies`.

### instrilo deps lock

Resolve and write package-lock.json or uv.lock explicitly.

```text
instrilo deps lock [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo deps lock
```

Guide: `instrilo explain dependencies`.

### instrilo deps install

Install from an existing lock without updating it; stale locks fail.

```text
instrilo deps install [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo deps install
```

Guide: `instrilo explain dependencies`.

### instrilo runs

Record local native/LangGraph runs, resume approved work and replay frozen model/tool responses.

```text
instrilo runs
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain runs`.

### instrilo runs start

Persist sensitive input/model/tool content for durable replay and approval pauses.

```text
instrilo runs start [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--input <text>` | yes | — | agent task |
| `--record-content` | no | — | explicitly consent to local content recording (required) |
| `--caller <id>` | no | — | local caller identity label |
| `--tenant <id>` | no | — | tenant label (tools still need resource authorization) |
| `--scopes <list>` | no | — | comma-separated operator-granted tool scopes |

Every command also accepts `-h, --help`.

```sh
instrilo runs start PROJECT --input "Draft an answer" --record-content --scopes draft:write
```

Guide: `instrilo explain runs`.

### instrilo runs list

List recorded run IDs, states, identities and replay availability without dumping content.

```text
instrilo runs list [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo runs list
```

Guide: `instrilo explain runs`.

### instrilo runs show

Inspect a recorded run including exact events, pending decisions and stored content.

```text
instrilo runs show <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo runs show ID
```

Guide: `instrilo explain runs`.

### instrilo runs resume

Replay completed steps and continue approved work; ambiguous writes are never retried automatically.

```text
instrilo runs resume <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--caller <id>` | no | — | must match the original caller |
| `--tenant <id>` | no | — | must match original tenant |
| `--scopes <list>` | no | — | must match original grants |

Every command also accepts `-h, --help`.

```sh
instrilo runs resume ID
```

Guide: `instrilo explain runs`.

### instrilo runs replay

Execute the current pinned runtime against recorded responses with zero live model/tool calls.

```text
instrilo runs replay <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--caller <id>` | no | — | must match the original caller |
| `--tenant <id>` | no | — | must match original tenant |
| `--scopes <list>` | no | — | must match original grants |

Every command also accepts `-h, --help`.

```sh
instrilo runs replay RUN_ID PROJECT
```

Guide: `instrilo explain runs`.

### instrilo runs recover-lock

Remove a durable-run lock only after verifying its recorded process is no longer alive.

```text
instrilo runs recover-lock <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo runs recover-lock ID
```

Guide: `instrilo explain runs`.

### instrilo runs export

Export a scrubbed inspect-only run bundle; content is omitted unless explicitly included.

```text
instrilo runs export <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--include-content` | no | — | include scrubbed input/model/tool content; inspect before sharing |
| `--output <file>` | no | — | new bundle JSON file; defaults to stdout |

Every command also accepts `-h, --help`.

```sh
instrilo runs export ID
```

Guide: `instrilo explain runs`.

### instrilo runs inspect-bundle

Validate and inspect an imported portable failure bundle; never executes bundled code.

```text
instrilo runs inspect-bundle <file>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `file` | yes | — | bounded local input file |

Every command also accepts `-h, --help`.

```sh
instrilo runs inspect-bundle ./INPUT.json
```

Guide: `instrilo explain runs`.

### instrilo runs replay-bundle

Replay portable recorded data against an exactly matching trusted local build; never installs imported code.

```text
instrilo runs replay-bundle <file> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `file` | yes | — | bounded local input file |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--execute-local` | no | — | explicitly run the matching local project against frozen responses |

Every command also accepts `-h, --help`.

```sh
instrilo runs inspect-bundle private-bundle.json
instrilo runs replay-bundle private-bundle.json PROJECT --execute-local
```

Guide: `instrilo explain runs`.

### instrilo runs graph

Render the observed run trajectory as Mermaid or structured JSON.

```text
instrilo runs graph <id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `id` | yes | — | existing identifier for this command group; inspect its list/show command |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--format <format>` | no | mermaid | json or mermaid |

Every command also accepts `-h, --help`.

```sh
instrilo runs graph ID
```

Guide: `instrilo explain runs`.

### instrilo approvals

Inspect and decide exact pending tool actions as the local OS operator.

```text
instrilo approvals
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain approvals`.

### instrilo approvals show

Show pending tool arguments, identity and exact approval/operation digests.

```text
instrilo approvals show <run-id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `run-id` | yes | — | recorded run UUID from instrilo runs list, or instrilo deployment reports for deployment cleanup |
| `project` | no | . | project directory (default: current directory) |

Every command also accepts `-h, --help`.

```sh
instrilo approvals show RUN_ID
```

Guide: `instrilo explain approvals`.

### instrilo approvals approve

Approve the inspected digest once, with expiry. Resume is a separate explicit action.

```text
instrilo approvals approve <run-id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `run-id` | yes | — | recorded run UUID from instrilo runs list, or instrilo deployment reports for deployment cleanup |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--digest <sha256>` | yes | — | exact approvalDigest displayed by approvals show |
| `--expires-in <seconds>` | no | 300 | approval lifetime in seconds |
| `--reviewer <name>` | no | — | audit label; OS ownership remains the trust boundary |

Every command also accepts `-h, --help`.

```sh
instrilo approvals approve RUN_ID PROJECT --digest EXACT_DIGEST --expires-in 300
```

Guide: `instrilo explain approvals`.

### instrilo approvals deny

Deny the exact pending approval digest and persist the decision.

```text
instrilo approvals deny <run-id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `run-id` | yes | — | recorded run UUID from instrilo runs list, or instrilo deployment reports for deployment cleanup |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--digest <sha256>` | yes | — | exact pending approval digest |
| `--reviewer <name>` | no | — | audit label |

Every command also accepts `-h, --help`.

```sh
instrilo approvals deny RUN_ID --digest DIGEST
```

Guide: `instrilo explain approvals`.

### instrilo approvals reconcile

Record a confirmed external result after an ambiguous operation; never repeats the external action.

```text
instrilo approvals reconcile <run-id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `run-id` | yes | — | recorded run UUID from instrilo runs list, or instrilo deployment reports for deployment cleanup |
| `project` | no | . | project directory (default: current directory) |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--file <path>` | no | — | read a bounded JSON/YAML document |
| `--data <json>` | no | — | supply a JSON object directly |
| `--digest <sha256>` | yes | — | exact pending request/approval digest |
| `--note <text>` | yes | — | how the outcome was verified outside Instrilo |
| `--reviewer <name>` | no | — | responsible local operator |

Every command also accepts `-h, --help`.

```sh
instrilo approvals reconcile RUN_ID --digest DIGEST --note NOTE --file ./INPUT.json
```

Guide: `instrilo explain approvals`.

### instrilo setup

Guide official CLI discovery, reviewed installation and provider-owned sign-in; no project is required.

```text
instrilo setup [provider]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `provider` | no | — | provider kind from instrilo providers |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--yes` | no | — | approve the displayed official install plan and start provider login without Instrilo prompts |
| `--device` | no | — | use official device login (Codex and Grok only) |

Every command also accepts `-h, --help`.

```sh
instrilo setup codex
instrilo setup grok --device
```

Guide: `instrilo explain subscriptions`.

### instrilo auth

Install, sign in, inspect or explicitly verify official subscription CLI connections.

```text
instrilo auth
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain subscriptions`.

### instrilo auth status

Print installed binaries and safe credential status for one or all providers; no model call or login.

```text
instrilo auth status [provider]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `provider` | no | — | provider kind from instrilo providers |

Every command also accepts `-h, --help`.

```sh
instrilo auth status
instrilo auth status claude
```

Guide: `instrilo explain subscriptions`.

### instrilo auth install

Install a fixed official npm package under your user account after reviewing its plan.

```text
instrilo auth install <provider>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `provider` | yes | — | provider kind from instrilo providers |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--plan` | no | — | print exact package, registry, destination and command without installing |
| `--yes` | no | — | consent to installing the displayed official package without an interactive prompt |

Every command also accepts `-h, --help`.

```sh
instrilo auth install codex --plan
instrilo auth install codex --yes
```

Guide: `instrilo explain subscriptions`.

### instrilo auth login

Run the official interactive sign-in even if credentials exist; the provider handles your account.

```text
instrilo auth login <provider>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `provider` | yes | — | provider kind from instrilo providers |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--device` | no | — | use official device login (Codex and Grok only) |
| `--install` | no | — | offer to install the official CLI if it is missing |
| `--yes` | no | — | approve the displayed installation when --install is used |

Every command also accepts `-h, --help`.

```sh
instrilo auth login codex --device --install --yes
instrilo auth login claude
```

Guide: `instrilo explain subscriptions`.

### instrilo auth verify

Make one bounded live model request through the official CLI. Uses account allowance or API billing.

```text
instrilo auth verify <provider>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `provider` | yes | — | provider kind from instrilo providers |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--model <id>` | no | — | explicit provider model; otherwise use the official CLI default |

Every command also accepts `-h, --help`.

```sh
instrilo auth verify grok
```

Guide: `instrilo explain subscriptions`.

### instrilo connect

Set up a provider and assign a named connection to builder, runtime, judge, or all roles.

```text
instrilo connect <provider> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `provider` | yes | — | provider kind from instrilo providers |
| `project` | no | — | project directory or manifest; defaults to the current directory |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--role <role>` | no | builder | builder, runtime, judge, or all (default: builder) |
| `--connection <name>` | no | — | connection name (default: provider ID) |
| `--model <id>` | no | — | explicit model; otherwise retain an existing connection model or use the CLI default |
| `--replace` | no | — | allow replacing an existing connection of a different kind |
| `--yes` | no | — | approve the displayed official install plan and start login without Instrilo prompts |
| `--device` | no | — | use official device login (Codex and Grok only) |

Every command also accepts `-h, --help`.

```sh
instrilo connect claude PROJECT --role judge
instrilo connect codex PROJECT --role builder --yes
```

Guide: `instrilo explain subscriptions`.

### instrilo deployment

Inspect platform requirements, test generated containers with mocks, retain evidence and clean owned resources.

```text
instrilo deployment
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain deployment`.

### instrilo deployment platforms

List verified platform contracts, architecture, prerequisites and official references.

```text
instrilo deployment platforms
```

Every command also accepts `-h, --help`.

```sh
instrilo deployment platforms
```

Guide: `instrilo explain deployment`.

### instrilo deployment guide

Read the generated platform-specific prerequisite and deployment guide. Build first.

```text
instrilo deployment guide [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | — | project directory or manifest; defaults to the current directory |

Every command also accepts `-h, --help`.

```sh
instrilo deployment guide PROJECT
```

Guide: `instrilo explain deployment`.

### instrilo deployment prerequisites

Inspect the selected platform contract and local container engine without changing the machine.

```text
instrilo deployment prerequisites [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | — | project directory or manifest; defaults to the current directory |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--engine <engine>` | no | docker | docker or podman |

Every command also accepts `-h, --help`.

```sh
instrilo deployment prerequisites PROJECT --engine podman
```

Guide: `instrilo explain deployment`.

### instrilo deployment test

Preview or execute isolated local container contract tests with mocked model/identity/services; no cloud deployment.

```text
instrilo deployment test [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | — | project directory or manifest; defaults to the current directory |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--engine <engine>` | no | docker | docker or podman |
| `--execute` | no | — | build and run the reviewed local test; may download public images/dependencies |
| `--keep` | no | — | retain run-owned resources for inspection; otherwise clean them after testing |

Every command also accepts `-h, --help`.

```sh
instrilo deployment test PROJECT --engine docker
instrilo deployment test PROJECT --engine docker --execute
instrilo deployment test PROJECT --engine podman --execute --keep
```

Guide: `instrilo explain deployment`.

### instrilo deployment reports

Read retained deployment test evidence, including mocks, actual checks and unverified cloud dependencies.

```text
instrilo deployment reports [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `project` | no | — | project directory or manifest; defaults to the current directory |

Every command also accepts `-h, --help`.

```sh
instrilo deployment reports PROJECT
```

Guide: `instrilo explain deployment`.

### instrilo deployment cleanup

Preview or remove only exact resources owned by a recorded deployment test; preserve its report.

```text
instrilo deployment cleanup <run-id> [project]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `run-id` | yes | — | recorded run UUID from instrilo runs list, or instrilo deployment reports for deployment cleanup |
| `project` | no | — | project directory or manifest; defaults to the current directory |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--execute` | no | — | apply the reviewed cleanup after verifying recorded IDs and ownership labels |

Every command also accepts `-h, --help`.

```sh
instrilo deployment cleanup RUN_ID PROJECT
instrilo deployment cleanup RUN_ID PROJECT --execute
```

Guide: `instrilo explain deployment`.

### instrilo deployment engine

Check Docker/Podman, review installation/startup, or clean up dependencies Instrilo owns.

```text
instrilo deployment engine
```

Every command also accepts `-h, --help`.

Guide: `instrilo explain deployment`.

### instrilo deployment engine status

Check one or both official container clients and server readiness without starting anything.

```text
instrilo deployment engine status [engine]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `engine` | no | — | docker or podman |

Every command also accepts `-h, --help`.

```sh
instrilo deployment engine status
instrilo deployment engine status podman
```

Guide: `instrilo explain deployment`.

### instrilo deployment engine install

Review platform-specific prerequisites and install a supported official runtime with explicit consent.

```text
instrilo deployment engine install <engine>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `engine` | yes | — | docker or podman |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--execute` | no | — | consent to the reviewed supported operation; otherwise print its plan |

Every command also accepts `-h, --help`.

```sh
instrilo deployment engine install podman
instrilo deployment engine install podman --execute
```

Guide: `instrilo explain deployment`.

### instrilo deployment engine start

Review and start supported runtime dependencies; owned Podman machines are separate from existing machines.

```text
instrilo deployment engine start <engine>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `engine` | yes | — | docker or podman |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--execute` | no | — | consent to the reviewed supported operation; otherwise print its plan |

Every command also accepts `-h, --help`.

```sh
instrilo deployment engine start podman
instrilo deployment engine start podman --execute
```

Guide: `instrilo explain deployment`.

### instrilo deployment engine cleanup

Review removal of dependencies Instrilo owns; pre-existing or shared dependencies are preserved.

```text
instrilo deployment engine cleanup <engine>
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `engine` | yes | — | docker or podman |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--execute` | no | — | consent to the reviewed supported operation; otherwise print its plan |
| `--remove-machine-data` | no | — | include the entire disk of the exact Instrilo-owned Podman VM after reviewing its storage inventory |

Every command also accepts `-h, --help`.

```sh
instrilo deployment engine cleanup podman
instrilo deployment engine cleanup podman --execute
```

Guide: `instrilo explain deployment`.

### instrilo help

Read nested command help, the complete command reference, or machine-readable command metadata.

```text
instrilo help [path...]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `path` | no | — | nested command names, e.g. config set |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--all` | no | — | print detailed help for every command |
| `--json` | no | — | print the complete command schema as JSON |

Every command also accepts `-h, --help`.

```sh
instrilo help
```

### instrilo explain

Read the built-in operational manual without opening a browser.

```text
instrilo explain [topic]
```

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `topic` | no | — | manual topic from instrilo explain --list |

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--list` | no | — | list every topic |
| `--all` | no | — | print every manual topic |
| `--search <text>` | no | — | search all topic text and show matching paragraphs |
| `--json` | no | — | return topics/manual/search as JSON |

Every command also accepts `-h, --help`.

```sh
instrilo explain
```
