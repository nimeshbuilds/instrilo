import { Command } from 'commander';

export const manuals:Record<string,{title:string;body:string}>={
 subscriptions:{title:'Guided subscription CLI installation and sign-in',body:`Use the official Codex, Claude Code or Grok Build CLI through your own account.
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
local daemon and model through its API; choosing Ollama does not download a model.`},
 overview:{title:'Instrilo: the complete agent workflow',body:`Instrilo turns product guidance into owned Python or TypeScript agent projects.
The local app and CLI share agent-studio.yaml, guidance, generated source and evals.
The installed commands instrilo, in and nb-agent invoke the same CLI.
Use in directly in zsh; in Bash/POSIX sh use command in because in is a
reserved word. For example: command in help --all.

Start here:
  instrilo web enable                  Open the local app in your browser
  instrilo explain quickstart
  instrilo tutorials list               Ten complete installed-CLI walkthroughs
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
environment variables. No hosted account is required for the core workbench.`},
 quickstart:{title:'An executable offline quickstart',body:`Prerequisites: Node.js >=22 and npm on macOS, Linux or WSL. For Python use
Python 3.11–3.13 plus uv. Native Windows cancellation/install need further work.
Install the built CLI and app from a GitHub release using the installation guide:
  https://github.com/nimeshbuilds/instrilo/blob/main/docs/INSTALLATION.md
If instrilo --version works, you can run this demo immediately; no clone is needed.
Source contributors: npm ci --ignore-scripts, npm run build, then npm link.
Both installation paths provide the same instrilo, in and nb-agent commands.
In zsh: in --help. In Bash/POSIX sh: command in --help (in is a reserved word).

  instrilo init support-agent --directory .studio/projects --language typescript
  instrilo guidance create .studio/projects/support-agent/guidance
  instrilo validate .studio/projects/support-agent
  instrilo build .studio/projects/support-agent
  instrilo prepare .studio/projects/support-agent
  instrilo run .studio/projects/support-agent --input 'Draft a missing-delivery reply.'
  instrilo eval .studio/projects/support-agent --split development
  instrilo projects show .studio/projects/support-agent
  instrilo export .studio/projects/support-agent --output support-agent.zip
  instrilo web enable --workspace .studio/projects

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
for every generated project.`},
 tutorials:{title:'Complete walkthroughs with the installed CLI',body:`Install Instrilo v0.2.3 or newer from a GitHub release. No Git checkout is needed.

  instrilo tutorials list
  instrilo tutorials setup ./instrilo-tutorials
  cd ./instrilo-tutorials
  instrilo tutorials show deployment-artifacts
  instrilo help tutorials setup

setup copies the bundled examples and offline Markdown guides into a NEW folder.
It refuses existing files, folders and symlinks so your work is preserved. To
continue an existing workspace, cd into it; to repeat a guide, use a fresh folder.
Setup does not run example code, start services, install dependencies or call APIs.
Use Bash for guide steps, including on macOS (run bash in a zsh terminal). Windows
uses WSL. Keep a guide's commands in one session; temporary variables and fixture
processes belong to that session. Python walkthroughs also require Python and uv.

All agent operations use instrilo. A guide may invoke a bundled Node.js helper to
start an explicitly named local model/tool fixture or check saved outputs. These
helpers are readable examples, not alternate ways to start the Instrilo CLI.
Guides are saved under guides/; examples under examples/quickstarts/; projects
and evidence go under .studio/tutorials/ as the commands run.

The deployment-artifacts guide covers guidance, architecture, an executable
LangGraph, independent builder/runtime/judge connections, requirement coverage,
recorded runs, evaluations and cloud artifacts for AWS AgentCore, Cloud Run and
Azure Container Apps. Local fixture evidence demonstrates plumbing only. Live
model evaluation, human review, cloud identity/permissions, container execution
and account-specific deployment remain explicit steps before production.

Read every expected outcome and verification limitation. Stop each guide-owned
fixture with its documented cleanup step. Keep project reports before removing a
workspace. Package uninstall or update does not remove your tutorial work.

Online guides: https://nimeshbuilds.github.io/instrilo/#quickstarts`},
 web:{title:'Open and control the local web app',body:`  instrilo web enable
  instrilo web
  instrilo web enable --workspace ./my-projects --port 4317
  instrilo web enable --no-open
  instrilo help web enable

web enable starts the local app and opens its authenticated session in your default
browser. web is a shorter equivalent. Both choose an available port and use
~/Instrilo/projects by default, so projects have the same home from any directory.
--workspace chooses another project folder; --port selects a fixed port (0 means
an available one). Keep the terminal running. Ctrl+C stops the app and preserves
projects. Run the same command again to reopen that workspace.

The app listens only on 127.0.0.1. Keep the session URL private; it contains a fresh
access token for this run. This is a foreground local app, not a background service
or a public website. It does not change operating-system startup settings.

On SSH, WSL, or a machine without a browser, use --no-open and open the printed
URL in a browser that can reach that machine's loopback address. A browser-launch
failure leaves the server running and prints a fallback URL. An occupied fixed
port fails; remove --port or use --port 0 to let the app choose an available one.

Source contributors build and run npm link once, then use instrilo web enable
like release users. command in web enable works in Bash and zsh;
in web enable also works in zsh.

The earlier app command remains available with its existing workspace and port
defaults. It prints a URL without opening a browser; add --open to open it:
  instrilo app --workspace ./my-projects --port 0 --open

No model account is needed to open the app. Create a project and import guidance,
then configure model connections when ready. Opening the app does not sign into
providers or install agent dependencies. Read explain subscriptions and quickstart
for those next steps.`},
 concepts:{title:'Agents, graphs, harnesses and evidence',body:`An agent combines instructions, model decisions, tools and bounded control flow.
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
conflicts; it is not a promise that arbitrary modifications will merge automatically.`},
 guidance:{title:'Guidance import, interviews and safe editing',body:`Eligible guidance is bounded UTF-8 text inside a selected directory. Inspection
excludes credentials matching known patterns, hidden/dependency/binary files,
symlinks and oversized files. Detection is not complete sensitive-data discovery.

  instrilo guidance questions
  instrilo guidance answers-template
  instrilo guidance inspect ./product-guidance
  instrilo create research-agent --guidance ./product-guidance
  instrilo guidance list ./research-agent
  instrilo guidance read purpose.md ./research-agent
  instrilo guidance write operations.md ./research-agent --text '# Operations\nEscalate billing disputes.'
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
Holdout expected answers do not belong in builder guidance.`},
 configuration:{title:'Every configuration field and how to edit it',body:`  instrilo config template --language python --yaml
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
Unknown framework/provider/target combinations are rejected rather than guessed.`},
 connections:{title:'Model connections and independent roles',body:`  instrilo providers
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
performed by plan, run, eval, or recorded runs when live connections are selected.`},
 gateways:{title:'Custom gateways, JWT and authorization',body:`Outbound gateway authentication and inbound agent authentication are separate.

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
running and is not automatically reachable from a deployed cloud container.`},
 frameworks:{title:'Framework and language compatibility',body:`  instrilo adapters catalog
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
provider accounts and cloud deployment are separate integration checks.`},
 tools:{title:'Tools, exact-call approvals and boundaries',body:`  instrilo tools example > tool.json
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
policy for you. GET endpoints can also have side effects if poorly designed.`},
 evaluations:{title:'Datasets, judges and comparisons',body:`  instrilo cases example > case.json
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
files and checksums establish local consistency, not a signed external attestation.`},
 requirements:{title:'Link product requirements to release evidence',body:`  instrilo requirements example > requirement.json
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
agent permissions or prove semantic coverage merely by existing.`},
 release:{title:'A reviewable release gate for CI',body:`  instrilo policy template > policy.json
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
Reports imported with evidence register retain immutable IDs and content hashes.`},
 review:{title:'Blind human review and judge calibration',body:`  instrilo review queue PROJECT --report REPORT_ID --output blind-review.json
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
remain versioned; stale reports cannot become fresh release evidence.`},
 regeneration:{title:'Upgrade generated code without losing custom work',body:`  instrilo generation plan PROJECT
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
source fingerprints with package-manager locks.`},
 dependencies:{title:'Dependency locks and frozen installation',body:`  instrilo deps status PROJECT
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
Lock presence alone is not a platform, container, model or supply-chain guarantee.`},
 runs:{title:'Recorded runs and durable execution',body:`  instrilo runs start PROJECT --input 'Draft a reply' --record-content
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
execution, not a hosted multi-user workflow service or distributed database.`},
 approvals:{title:'Review, approve, deny and reconcile exact actions',body:`  instrilo approvals show RUN_ID PROJECT
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
network failure. Reconciliation is explicit; model/user text cannot approve itself.`},
 replay:{title:'Frozen replay and portable failure bundles',body:`  instrilo runs replay RUN_ID PROJECT
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
option. Changing a model/build requires a new recorded run.`},
 graphs:{title:'Inspect real execution graphs',body:`  instrilo runs graph RUN_ID PROJECT --format mermaid
  instrilo runs graph RUN_ID PROJECT --format json

The graph is derived from persisted run events: actual model/tool steps, states,
approval pauses, errors and completion. Mermaid can be pasted into compatible
Markdown viewers; JSON preserves node/edge data for other tools.
This view explains a recorded trajectory. It is not a drag-and-drop framework
editor and does not claim arbitrary round-trip graph conversion. Native and
LangGraph durable flows share the event/approval contract in both languages.`},
 adapters:{title:'Trusted adapter development and conformance',body:`  instrilo adapters catalog
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
not a plugin sandbox. Review source before installing any third-party extension.`},
 deployment:{title:'Platform prerequisites, local tests, cleanup and cloud delivery',body:`Inspect requirements and test your generated deployment before publishing:

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
normal source exports; use explicit review/run export commands to share it.`},
 desktop:{title:'Coding tools and desktop/chat hosts',body:`  instrilo config set delivery.hosts '["codex","claude-code","claude-desktop","chatgpt"]' PROJECT --json
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
coding tools, framework runtimes and model billing are independent choices.`},
 security:{title:'Local trust boundaries and safe operation',body:`The app binds to 127.0.0.1 with a random session token, Host/Origin checks and a
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
reviewed holdout examples. Report vulnerabilities using SECURITY.md in the repo.`},
 files:{title:'Project files and ownership',body:`agent-studio.yaml       Version-1 source manifest (name retained for compatibility)
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
where provided. Back up projects before major migrations.`},
 'exit-codes':{title:'Automation, output and exit codes',body:`0  Command completed, gate allowed, or plan/inspection printed successfully.
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
live quality evidence. Use --help on the exact leaf command for machine flags.`},
 troubleshooting:{title:'Diagnose failures without guessing',body:`Unknown/unsupported configuration: instrilo validate PROJECT, config fields,
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
For bug reports include sanitized commands, versions and a metadata-only run bundle.`},
};

const examples:Record<string,string[]>={
 'deployment platforms':['instrilo deployment platforms'],
 'deployment guide':['instrilo deployment guide PROJECT'],
 'deployment prerequisites':['instrilo deployment prerequisites PROJECT --engine podman'],
 'deployment test':['instrilo deployment test PROJECT --engine docker','instrilo deployment test PROJECT --engine docker --execute','instrilo deployment test PROJECT --engine podman --execute --keep'],
 'deployment reports':['instrilo deployment reports PROJECT'],
 'deployment cleanup':['instrilo deployment cleanup RUN_ID PROJECT','instrilo deployment cleanup RUN_ID PROJECT --execute'],
 'deployment engine status':['instrilo deployment engine status','instrilo deployment engine status podman'],
 'deployment engine install':['instrilo deployment engine install podman','instrilo deployment engine install podman --execute'],
 'deployment engine start':['instrilo deployment engine start podman','instrilo deployment engine start podman --execute'],
 'deployment engine cleanup':['instrilo deployment engine cleanup podman','instrilo deployment engine cleanup podman --execute'],
 setup:['instrilo setup codex','instrilo setup grok --device'],
 connect:['instrilo connect claude PROJECT --role judge','instrilo connect codex PROJECT --role builder --yes'],
 'auth status':['instrilo auth status','instrilo auth status claude'],
 'auth install':['instrilo auth install codex --plan','instrilo auth install codex --yes'],
 'auth login':['instrilo auth login codex --device --install --yes','instrilo auth login claude'],
 'auth verify':['instrilo auth verify grok'],
 init:['instrilo init support-agent --language python --directory .studio/projects'],
 create:['instrilo create research-agent --guidance ./product-guidance --framework native'],
 build:['instrilo build PROJECT','instrilo build PROJECT --dry-run','instrilo build PROJECT --overwrite --merge --expected-plan HASH'],
 run:['instrilo run PROJECT --input "Draft a response"'],
 eval:['instrilo eval PROJECT --split holdout --output PROJECT/reports/holdout.json'],
 plan:['instrilo plan PROJECT --interview --apply'],
 deploy:['instrilo deploy PROJECT','instrilo deploy PROJECT --execute'],
 'tutorials list':['instrilo tutorials list'],
 'tutorials show':['instrilo tutorials show deployment-artifacts'],
 'tutorials setup':['instrilo tutorials setup ./instrilo-tutorials'],
 web:['instrilo web','instrilo web --no-open'],
 'web enable':['instrilo web enable','instrilo web enable --workspace ./my-projects --port 4317','instrilo web enable --no-open'],
 app:['instrilo app --workspace .studio/projects --port 4317','instrilo app --workspace ./my-projects --port 0 --open'],
 'config set':['instrilo config set agent.limits.maxSteps 12 PROJECT --json'],
 'config apply':['instrilo config apply PROJECT --file complete-config.yaml'],
 'connections add':['instrilo connections add gateway PROJECT --data \'{"kind":"gateway","model":"MODEL_ID","baseUrl":"https://gateway.example/v1","auth":{"type":"bearer-env","env":"GATEWAY_TOKEN"}}\''],
 'connections use':['instrilo connections use judge gateway PROJECT'],
 'requirements add':['instrilo requirements example > requirement.json','instrilo requirements add PROJECT --file requirement.json'],
 release:['instrilo release PROJECT --report REPORT_ID --output release-decision.json'],
 'review queue':['instrilo review queue PROJECT --report REPORT_ID'],
 'runs start':['instrilo runs start PROJECT --input "Draft an answer" --record-content --scopes draft:write'],
 'approvals approve':['instrilo approvals approve RUN_ID PROJECT --digest EXACT_DIGEST --expires-in 300'],
 'runs replay':['instrilo runs replay RUN_ID PROJECT'],
 'adapters install':['instrilo adapters inspect ./extension','instrilo adapters install ./extension PROJECT --trust-code'],
 'generation plan':['instrilo generation plan PROJECT --merge'],
 'guidance write':['instrilo guidance write operations.md PROJECT --text "Escalate billing disputes."','instrilo guidance write purpose.md PROJECT --file revised.md --replace --expected-sha HASH'],
 'connections example':['instrilo connections example openai --model YOUR_MODEL'],
 'requirements link':['instrilo requirements link billing-human PROJECT --case billing-escalation --kind deterministic --reviewer Nimesh --reason "Checks escalation wording."'],
 'requirements unlink':['instrilo requirements unlink billing-human PROJECT --case billing-escalation --kind deterministic --reviewer Nimesh --reason "Case replaced after review."'],
 'adapters init':['instrilo adapters init ./deploy-notes --id deploy-notes --kind target'],
 'adapters serve':['instrilo adapters serve local-provider PROJECT --token-env ADAPTER_GATEWAY_TOKEN'],
 'runs replay-bundle':['instrilo runs inspect-bundle private-bundle.json','instrilo runs replay-bundle private-bundle.json PROJECT --execute-local'],
 'tools add':['instrilo tools example > tool.json','instrilo explain tools','instrilo tools add PROJECT --file tool.json'],
 'tools remove':['instrilo tools remove create_draft PROJECT'],
};
const leafDescriptions:Record<string,string> = {
  "projects list": "List projects in a workspace with language, framework, target and modification time.",
  "config show": "Print the complete validated manifest as JSON or YAML, optionally with its file hash.",
  "config template": "Print a complete valid offline manifest to customize or apply.",
  "connections list": "List named model connections and the three role assignments.",
  "tools list": "List configured HTTP tools, scopes, schemas and approval requirements.",
  "tools remove": "Remove an existing tool by name, validate and back up the manifest.",
  "cases list": "Print validated evaluation cases, optionally filtered by split.",
  "cases remove": "Remove one case by ID; the remaining dataset must remain valid.",
  "cases export": "Export validated cases as JSONL to stdout or a new file.",
  "artifacts list": "List exportable generated files while excluding secrets and private state.",
  "artifacts read": "Print one eligible generated source or delivery file as text.",
  "reports list": "List saved evaluation JSON files in the selected project.",
  "reports show": "Validate the file boundary and print one saved project report.",
  "adapters list": "List installed trusted adapter manifests, versions and content pins.",
  "generation plan": "Preview additions, updates, preserved edits and conflicts without writing project files.",
  "generation inspect": "Inspect the retained baseline, source fingerprints, lock and recovery status.",
  "generation migrate": "Preview legacy generation-state migration; --apply writes a backed-up migration.",
  "deps status": "Inspect actual dependency lock presence, hashes and manifest consistency.",
  "runs list": "List recorded run IDs, states, identities and replay availability without dumping content.",
  "runs show": "Inspect a recorded run including exact events, pending decisions and stored content.",
  "runs export": "Export a scrubbed inspect-only run bundle; content is omitted unless explicitly included.",
  "runs graph": "Render the observed run trajectory as Mermaid or structured JSON.",
  "approvals show": "Show pending tool arguments, identity and exact approval/operation digests.",
  "approvals deny": "Deny the exact pending approval digest and persist the decision."
};
const argumentDescriptions:Record<string,string>={project:'project directory or manifest; defaults to the current directory',engine:'docker or podman',name:'project slug, or existing tool name for tools remove',directory:'source or destination directory; see command description',path:'relative file path within the selected project',previous:'previous evaluation report JSON file',current:'current evaluation report JSON file',field:'dotted manifest field such as agent.limits.maxSteps',value:'literal string, or JSON when --json is passed',id:'existing identifier for this command group; inspect its list/show command',role:'builder, runtime, or judge',provider:'provider kind from instrilo providers','run-id':'recorded run UUID from instrilo runs list, or instrilo deployment reports for deployment cleanup',file:'bounded local input file',topic:'manual topic from instrilo explain --list'};
function commandPath(cmd:Command){const names:string[]=[];let cursor:Command|null=cmd;while(cursor.parent){names.unshift(cursor.name());cursor=cursor.parent;}return names.join(' ');}
function allCommands(root:Command):Command[]{return [root,...root.commands.flatMap(allCommands)];}
function topicFor(cmd:Command){const root=commandPath(cmd).split(' ')[0]||'overview';return ({auth:'subscriptions',setup:'subscriptions',connect:'subscriptions',config:'configuration',cases:'evaluations',reports:'evaluations',eval:'evaluations',compare:'evaluations',policy:'release',evidence:'requirements',generation:'regeneration',build:'regeneration',deps:'dependencies',prepare:'dependencies',run:'runs',deploy:'deployment',artifacts:'files',export:'files',projects:'files',doctor:'troubleshooting',providers:'connections',init:'quickstart',create:'quickstart',plan:'guidance',app:'web',web:'web'}as Record<string,string>)[root]||root;}
export function commandReference(program:Command){return allCommands(program).map(cmd=>({command:'instrilo'+(commandPath(cmd)?' '+commandPath(cmd):''),description:cmd.description(),arguments:cmd.registeredArguments.map(a=>({name:a.name(),description:a.description,required:a.required,variadic:a.variadic,default:a.defaultValue})),options:cmd.options.map(o=>({flags:o.flags,description:o.description,required:o.mandatory,default:o.defaultValue})),examples:examples[commandPath(cmd)]||[],topic:topicFor(cmd)}));}
export function installCliHelp(program:Command){
 program.addHelpCommand(false).showHelpAfterError('Run instrilo help --all or instrilo explain troubleshooting.').showSuggestionAfterError(true);
 program.command('help [path...]').description('Read nested command help, the complete command reference, or machine-readable command metadata.').option('--all','print detailed help for every command').option('--json','print the complete command schema as JSON').action((path:string[],o:any)=>{if(o.json)return console.log(JSON.stringify(commandReference(program),null,2));if(o.all){for(const cmd of allCommands(program))console.log(cmd.helpInformation()+extraHelp(cmd));return;}let cmd=program;for(const part of path||[]){const next=cmd.commands.find(c=>c.name()===part||c.aliases().includes(part));if(!next)throw new Error('Unknown command path: '+path.join(' '));cmd=next;}console.log(cmd.helpInformation()+extraHelp(cmd));});
 program.command('explain [topic]').description('Read the built-in operational manual without opening a browser.').option('--list','list every topic').option('--all','print every manual topic').option('--search <text>','search all topic text and show matching paragraphs').option('--json','return topics/manual/search as JSON').action((topic:string|undefined,o:any)=>{
  const entries=Object.entries(manuals);if(o.search){const needle=o.search.toLowerCase();const matches=entries.flatMap(([id,m])=>m.body.split('\n\n').filter(p=>(m.title+'\n'+p).toLowerCase().includes(needle)).map(p=>({topic:id,title:m.title,text:p})));if(o.json)console.log(JSON.stringify(matches,null,2));else console.log(matches.map(m=>`[${m.topic}] ${m.title}\n${m.text}`).join('\n\n')||'No matches. Run instrilo explain --list.');return;}
  if(o.list){if(o.json)console.log(JSON.stringify(entries.map(([id,m])=>({topic:id,title:m.title})),null,2));else console.log(entries.map(([id,m])=>id.padEnd(16)+m.title).join('\n'));return;}
  if(topic==='commands'){console.log(o.json?JSON.stringify(commandReference(program),null,2):allCommands(program).map(c=>c.helpInformation()+extraHelp(c)).join('\n'));return;}
  if(o.all){console.log(o.json?JSON.stringify(manuals,null,2):entries.map(([id,m])=>`INSTRILO / ${id}\n${m.title}\n\n${m.body}`).join('\n\n'+'='.repeat(72)+'\n\n'));return;}
  const id=topic||'overview',manual=manuals[id];if(!manual)throw new Error('Unknown topic '+id+'. Run instrilo explain --list.');console.log(o.json?JSON.stringify({topic:id,...manual},null,2):manual.title+'\n\n'+manual.body);
 });
 for(const cmd of allCommands(program)){const path=commandPath(cmd);if(!cmd.description()&&leafDescriptions[path])cmd.description(leafDescriptions[path]);for(const arg of cmd.registeredArguments)if(!arg.description)arg.description=path==='help'?'nested command names, e.g. config set':argumentDescriptions[arg.name()]||'command argument';if(!examples[path]&&!cmd.commands.length){const args=cmd.registeredArguments.filter(a=>a.required).map(a=>a.name()==='field'?'agent.limits':a.name()==='value'?"'{\"maxSteps\":8,\"timeoutMs\":60000,\"maxOutputTokens\":2048}'":a.name()==='directory'?'./DIRECTORY':a.name()==='file'?'./INPUT.json':a.name()==='name'?'my-agent':a.name()==='path'?(path.startsWith('guidance')?'purpose.md':path.startsWith('artifacts')?'README.md':'reports/REPORT.json'):a.name().toUpperCase().replaceAll('-','_'));const flags=cmd.options.filter(o=>o.mandatory).map(o=>o.long+(o.required?' '+(o.long?.slice(2).toUpperCase().replaceAll('-','_')||'VALUE'):''));if(cmd.options.some(o=>o.long==='--file')&&cmd.options.some(o=>o.long==='--data'))flags.push('--file ./INPUT.json');if(path==='config set')flags.push('--json');if(path==='guidance write')flags.push('--text \"Your product guidance\"');if(path==='runs start')flags.push('--record-content');if(path==='adapters install')flags.push('--trust-code');examples[path]=['instrilo '+[path,...args,...flags].join(' ')];}cmd.configureHelp({sortSubcommands:true,sortOptions:true});cmd.addHelpText('after',()=>extraHelp(cmd));if(cmd.commands.length&&cmd!==program&&path!=='web')cmd.action(()=>cmd.outputHelp());}
 program.action(()=>program.outputHelp());
}
function extraHelp(cmd:Command){const path=commandPath(cmd),topic=topicFor(cmd);const lines=examples[path]||[];const required=cmd.options.filter(o=>o.mandatory).map(o=>o.long);return '\n'+(required.length?'Required options: '+required.join(', ')+'\n\n':'')+(lines.length?'Examples:\n'+lines.map(l=>'  '+l).join('\n')+'\n\n':'')+(manuals[topic]?'Guide: instrilo explain '+topic+'\n':'')+'All capabilities: instrilo help --all | instrilo explain --list\n';}
