# Verification record

Framework and protocol evidence recorded September 23, 2026; source-release checks repeated September 24, 2026. This document distinguishes generated artifacts, mocked transport tests, actual installed framework execution, and real external-service verification. It is not a security certification or a quality benchmark.

## Repeatable repository checks

Run from the repository root with Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
```

The automated suite invokes no paid model API and no authenticated provider-CLI inference. Some integration tests download public runtime dependencies into temporary project directories; they are free of live model calls, not necessarily free of network access.

The 0.1 baseline passed 58 tests. The 0.2 verification now includes requirements/release policy, review/calibration, safe regeneration, trusted adapters, durable native/LangGraph runs, portable replay, and extensive CLI/app flows. The final integrated run passed **139/139 tests, with no skips**, using an explicit Python interpreter and uv. TypeScript checking, the application build, and the generated CLI-documentation consistency check also passed.

The September 24 source-release check repeated the full suite after branding and package metadata changes. The renamed CLI help and local app rendered correctly with the new SVG icon and no browser console errors. The banner and vector/PNG icon were visually reviewed. Production dependency audit reported zero known vulnerabilities at that time. Cloud/provider verification below has not changed.

The source release targets macOS, Linux, and WSL. Native Windows dependency preparation and descendant-process cancellation need further implementation and verification; adapting a shell command alone does not establish native Windows support.

| Test file | Exercised behavior |
| --- | --- |
| `tests/core.test.ts` | Strict specifications, framework/provider restrictions, environment references, JWT configuration, unsafe tool URLs, guidance bounds/secret-pattern/binary/symlink exclusion, missing decisions and conflicts, dataset provenance |
| `tests/providers.test.ts` | Actual adapter HTTP requests to localhost fixtures; OpenAI-compatible and Anthropic envelopes; OAuth grant caching/rotation; bearer headers; errors, cancellation, timeouts, size bounds; fake CLI executable contracts |
| `tests/generators.test.ts` | Framework call generation, target contract markers, artifact path/traversal/symlink/overwrite protection |
| `tests/workbench.test.ts` | Real CLI subprocess argument parsing; create/config/import behavior; generated TypeScript dependency preparation, execution and evaluation; optional isolated Python execution/evaluation |
| `tests/server.test.ts` | Local app token/Host/Origin boundaries; project/config/guidance/case APIs; jobs; real ZIP output; artifact traversal; concurrent-edit hashes; bounded guidance editing; clarification persistence |
| `tests/security.test.ts` | Nested symlinks and exports; dataset write paths; unsafe project identifiers; stale build refusal; process-tree cancellation |
| `tests/evaluation.test.ts` | Evaluation evidence and comparison behavior; consult the test file for the current exact cases |
| `tests/rebuild.test.ts` | Generated-file fingerprints and safe handling of obsolete artifacts during rebuild |
| `tests/deployment.test.ts` | Explicit execution, expected script selection, and stale configuration/generated-guidance refusal before script launch |

The TypeScript CLI integration uses `prepare`, not a mocked dependency installer. The Python CLI test runs only when an explicit interpreter is supplied:

```sh
NB_AGENT_PYTHON=/absolute/path/to/python3 npx tsx --test tests/workbench.test.ts tests/server.test.ts
```

The recorded run using the bundled Python interpreter passed both language flows. The standalone Python CLI test creates a temporary environment with `httpx` and `jsonschema`. The 0.2 durable native/LangGraph tests additionally use real `uv sync` environments and exercise model/tool recording, exact approvals, restart/resume, and offline replay. Neither test deploys a cloud image.

Initial integration tests exposed duplicated CLI positional arguments, configuration defaults replacing explicit manifest language, and exports discarding user evaluation cases/rubric. Those failures were fixed and regression tests passed. Later guidance editing tests verify successful saves, stale digest rejection without overwriting current content, secret/binary/size/conflict rejection, and unique clarification files.

Local browser QA also exercised configuration saving, rejection of TypeScript/CrewAI, guidance editing, interview answers, build, native demo run, and evaluation. These are recorded interactive checks; they do not constitute cross-browser or accessibility certification.

## Actual framework execution with local model/tool fixtures

The installed frameworks have been exercised against a localhost OpenAI Chat Completions-compatible fixture and a localhost HTTP tool. These tests use actual generated framework code and installed SDKs, with deterministic model replies supplied by the fixture. They do not prove a remote provider model behaves identically.

| Language | Framework | Recorded dependency | Observed task |
| --- | --- | --- | --- |
| TypeScript | Native | Generated shared runtime | Request typed lookup, execute HTTP tool once, consume result, return `TOOL_OK` |
| TypeScript | LangGraph | `@langchain/langgraph` 1.4.17 | Same model/tool loop through an actual StateGraph |
| TypeScript | OpenAI Agents SDK | `@openai/agents` 0.18.0 | Same model/tool loop through an actual Runner |
| Python | Native | Generated shared runtime | Same typed lookup task |
| Python | LangGraph | `langgraph` 1.2.12 | Same model/tool loop through an actual StateGraph |
| Python | OpenAI Agents SDK | `openai-agents` 0.22.3 | Same model/tool loop through an actual Runner |
| Python | CrewAI | `crewai` 1.15.22 | Same model/tool loop through actual Crew/Agent/Task execution |

The generated TypeScript native, LangGraph, and Agents projects passed their recorded type checks. Generated Python source passed compile checks. The TypeScript native contract tests passed. Framework environments are isolated because their dependency constraints differ; do not install every framework into one shared environment.

The repeatable smoke driver is separate from `npm test` because it installs and executes all framework environments:

```sh
PYTHON=/absolute/path/to/python3 AGENT_SMOKE_ROOT=/tmp/nb-agent-smoke node --import tsx tests/generator-runtime-smoke.mjs --install
```

Rerun without `--install` to reuse prepared environments. The driver generates projects, performs static checks, exercises tool loops, and tests generated HTTP boundaries against local fixtures. The final clean-install run passed **98 assertions across all seven combinations**, with 20 local mock-model requests. That run exposed and resolved CrewAI's different MCP dependency requirement: CrewAI uses Python MCP 1.28.x; other Python templates use MCP 1.30.x. Inspect the driver output for the result of your current environment and dependency resolution.

Generated native Python and TypeScript HTTP services were also exercised locally with a signed RSA JWT/JWKS fixture. Recorded checks included valid issuer/audience/scope, rejection of missing or incorrect audience/scope, untrusted request-body claims, denied inherited operator scopes, content-type rejection, and hostile Origin handling. These prove the checked local paths, not complete tenant/resource isolation across arbitrary downstream tools.

## Provider evidence

The provider suite passed its recorded thirteen tests. All remote-model responses in that suite come from local fixtures. CLI integration tests install fake `codex`, `claude`, and `grok` executables in a temporary PATH and verify argument construction, output parsing, invalid/error envelopes, timeouts, cancellation, and size limits. A process-tree test verifies cancellation and timeout also terminate a descendant that ignores SIGTERM on POSIX.

Available real CLI help output and official documentation informed adapters, but there was no authenticated live model inference through a real Codex, Claude Code, or Grok account. Current subscription entitlements, client versions, active identity, organization policy, allowance usage, and billing must be checked in the operator's own account. See [provider documentation](PROVIDERS.md).

Ollama transport is configured but this record does not establish that a local Ollama daemon/model was installed and exercised. Likewise, a successful mock OAuth grant does not verify a particular enterprise identity provider or custom gateway's authentication contract.

## MCP and host boundaries

Generated stdio and remote HTTP MCP source/configuration are distinct from installing an integration into a real client. Remote HTTP MCP requires inbound JWT configuration, a trusted authorization/JWKS service, externally reachable HTTPS, and client setup. Provider/service-specific OAuth registration is an operator prerequisite.

The implementation includes remote MCP entry points when ChatGPT is selected; it does not create a real ChatGPT app connection, install a desktop integration, provision the identity provider, or publish a hosted MCP endpoint. ChatGPT remote delivery requires an API/gateway runtime rather than a subscription CLI runtime. Ordinary cloud deployment scripts target the REST runtime unless the operator selects the remote MCP packaging path.

The optional `tests/mcp-http-smoke.mjs` suite passed 35 local assertions across TypeScript and Python. It uses actual MCP SDK transports, localhost JWKS and signed JWTs, and a stub agent that makes no model call. It covers initialization, discovery, invocation, OAuth resource metadata, incorrect audience/scopes, Host/Origin, body bounds, environment-permission isolation, verified approval propagation, and sanitized errors. Exercised SDKs were `@modelcontextprotocol/sdk` 1.30.1 and Python `mcp` 1.30.0; a repeat run also passed all 35 assertions using the freshly installed CrewAI environment with Python MCP 1.28.1. See [chat-host setup and reproducible smoke commands](CHAT-HOSTS.md).

## Explicitly unverified external actions

The following have not been established by repository unit tests or local model fixtures:

- Paid OpenAI, Anthropic, xAI, or third-party gateway inference; actual model IDs and account limits.
- Authenticated subscription inference through real provider CLI sessions.
- AWS AgentCore, Cloud Run, or Azure Container Apps image publication and runtime deployment.
- Production cloud IAM/OIDC policies, secret-store access, regional availability, quotas, and costs.
- A real ChatGPT/Claude Desktop/Codex/Claude Code client's complete connection and interaction flow.
- Real Podman execution, ARM64 container builds and non-native framework container builds. Neither engine was installed on the implementation host; native TypeScript/Python Docker images were subsequently built and tested on the Linux CI runner, as recorded below.
- Production task quality, judge calibration against a human-labeled benchmark, adversarial robustness, and operational reliability.

No deployment command or cloud resource creation is necessary to run the automated tests. `deploy --execute` is an explicit external action and can create billable resources; it must not be conflated with generating or reviewing the scripts.

## Product limitations

The app is a loopback-bound local workbench with a session token. Its token is not an enterprise login or tenant administration system. Generated services can enforce inbound JWT and scoped tools, but a tenant claim requires resource-specific authorization in each real adapter. Guidance and prompts do not grant permissions.

Recorded native/LangGraph runs now persist operation events, approval decisions and single-use claims, with process-restart resume and reconciliation for ambiguous side effects in both languages. This is an operation journal for those runtimes, not an arbitrary framework checkpoint engine. SDK-framework durability, hosted reviewer identity, managed cloud provisioning, autoscaling, and multi-tenant sandbox services remain outside the current implementation.

Guidance conflict detection is bounded and partly syntactic. It catches explicit matching ALLOW/DENY directives and flags differing recognized sections, but it does not prove arbitrary requirements are semantically consistent. Recognizable secret patterns are excluded; this is not complete sensitive-data detection.

The default dataset contains synthetic development cases. Demo reports can pass plumbing checks while proving nothing about an LLM's task quality. Live judge scores also require calibration; a threshold alone is not evidence of reliability. Version-bound reports and append-only review labels identify changed conditions. The local OS owner can still alter files, so these are not independently signed attestations or a statistically established quality claim.

Use the [full product specification](PRODUCT-SPEC.md) for intended scope and roadmap, [README](../README.md) for working local commands, and [deployment notes](DEPLOYMENT.md) for destination-specific prerequisites.

## 0.2 local workflow verification

All provider/model/tool data in these additions comes from explicit test fixtures. No new paid provider, subscription, cloud, or desktop-account verification is implied.

| Tests | Exercised failure modes |
| --- | --- |
| `evidence.test.ts`, `review.test.ts`, `cli-evidence.test.ts` | Stale requirement/source/case/rubric bindings; unreviewed links; holdout, demo and synthetic policy decisions; blind queues; corrections; disagreements; human/judge calibration; actual CLI release exit codes |
| `regeneration.test.ts` | Retained baselines; user edits; three-way merge/conflicts; transaction interruption/recovery; concurrent locks; changed plan hashes; old-build migration and dependency-lock provenance |
| `runs.test.ts` | Native/LangGraph Python and TypeScript pause/restart/approval/replay against local fixtures; exact caller/tenant/scopes; expiry, denial and single claim; ambiguous write reconciliation; redaction; observed graphs; portable bundles and zero-live-fallback replay; unowned source and runtime helper changes; lock recovery |
| `adapters.test.ts` | Pinned bundles and tampering; trusted install; interface conformance; bounded input/output/time; cancellation and descendant cleanup; reserved environment isolation; redaction; authenticated HTTP bridge; registry/build concurrency |
| `cli-operations.test.ts`, `cli-help.test.ts`, `cli-deps.test.ts` | Actual CLI configuration/connection/tool/case/guidance changes; backup and hash checks; prototype/cyclic/oversized inputs; coherent export; every command's help metadata and offline manual discovery; package-manager timeout/SIGINT and generated-runtime cancellation; concurrent builder-edit refusal |
| `server-quality.test.ts` | HTTP auth/Origin/Host; read-only GET; evidence registration; blind review and release; generation previews; approval inspection; mutation conflicts; stale/tampered/locked export refusal and private history exclusion |

The 0.2 framework smoke re-used isolated installed SDK environments and passed **98 assertions across all seven framework variants**, with 20 localhost model requests. The remote MCP smoke re-used native Python/TypeScript SDK environments and passed **35 assertions**. These repeats exercised the changed generated session/runtime templates; they were not fresh dependency installations.

Browser QA exercised project creation, exact-plan build application, dependency preparation, demo evaluation, a reviewed requirement, a bound blind human label, the default release gate rejecting demo/synthetic evidence, recorded history, and frozen replay. Report selection clears stale review controls, and changing merge mode invalidates the displayed generation plan. Browser QA is limited to the local in-app browser; its console contained no errors in the inspected flow. Production dependency audit reported zero known vulnerabilities at verification time.

## Guided onboarding and platform testing

The final integrated local run passed **207/207 tests, with no skips**, including the explicit Python CLI flow. TypeScript checking, the production build, generated CLI-documentation consistency and browser-script syntax checks also passed.

Added September 24, 2026. Provider onboarding tests use isolated official-command fixtures: reviewed installation consent, fixed package/argv selection, login and status, unknown Grok status, bounded and redacted browser/device handoff, cancellation, process-tree cleanup, project-role preservation, concurrent-edit boundaries, and explicit live-verification dispatch. Generated TypeScript and Python runtime tests invoke all three fake provider clients through managed-directory discovery. No real account sign-in, credential-file access, provider install or paid model inference was performed.

Platform descriptor/generator tests inspect architecture, generated prerequisite/runbooks, current Azure identity/schema/secrets, AgentCore permissions and pre-push validation, Cloud Run settings, and Compose architecture. Container dependency tests use fake Docker/Podman/Homebrew executables and isolated ownership receipts. They exercise explicit consent, setup/startup, local endpoint restrictions, VM identity, refusal to adopt existing installations, empty-storage cleanup and explicit whole-owned-VM-disk cleanup.

Deployment lifecycle tests use fake engines to exercise actual orchestration, generated-artifact fingerprints, architecture verification, isolated fixture configuration, reports, failures, cancellation, resource ownership, retention and cleanup. Changed engine endpoints and unavailable sockets cannot be mistaken for successful resource removal. These tests cannot establish that a real engine built or ran an image. The optional host fixture smoke separately passed **70 HTTP/JWT/model-fixture assertions across all seven Python/TypeScript framework variants**, reusing installed SDK environments. Repeat it after preparing dependencies with the generator smoke above:

```sh
AGENT_SMOKE_ROOT=/tmp/nb-agent-smoke node --import tsx tests/deployment-runtime-smoke.mjs
```

The real-container smoke requires a running local Docker engine and is separate from `npm test`:

```sh
node --import tsx tests/deployment-container-smoke.mjs --execute
```

It builds the generated native TypeScript and Python images, executes isolated HTTP/JWT/model fixtures, and verifies removal of every recorded run-owned resource. It may download public images/dependencies and retains JSON/Markdown reports in a printed temporary workspace. The [Linux CI run for implementation commit dd37894](https://github.com/nimeshbuilds/instrilo/actions/runs/36022224720) passed **207/207 repository tests without skips** and **32 real Docker checkpoints** across native TypeScript and Python. Both image inspections confirmed `linux/amd64`, both test reports passed, and every recorded run-owned container, image and network was removed. Other architectures/framework container builds, Podman execution and cloud deployment still require their own verification.

Browser QA covered provider installation-plan review, fake install/login, device handoff and cancellation, and preservation of unsaved configuration. Deployment QA covered platform controls, local test-plan review, and a retained failed-prerequisite report when the actual host had no container engine. The failure was reported as a failure, with an installation next step and no created container resources. No cloud resource, real container runtime installation or removal was performed.

## Published quickstart verification

The GitHub Pages site at <https://nimeshbuilds.github.io/instrilo/> contains ten walkthroughs. The shared runner passed **46 exact executable command blocks across all ten guides** in fresh temporary workspaces on macOS. This includes native TypeScript/Python, actual LangGraph execution, separate builder/runtime/judge HTTP connections, API-key and bearer headers, OAuth client credentials, a real local HTTP tool, evaluation regression detection, human-review abstention and strict release rejection, durable approval/resume/offline replay, and deployment artifact/preflight inspection.

Model and judge replies in these guides come from named deterministic local fixtures. Four optional account/container/cloud command blocks are explicitly marked manual and are excluded from automatic walkthrough verification. No real provider login, provider CLI installation, paid model call or cloud deployment was performed for these guides. The separate Docker evidence above does not establish an ARM64 build or real cloud execution for the deployment tutorial.

`npm run test:scenarios` executes the same strings that the site renders. `website/verification.json` is generated, not committed. Its fingerprints bind checks to the scenario, CLI source, dependencies, and example files; stale or absent evidence never displays a passing badge. The Pages workflow repeats the ten walkthroughs on Linux before it builds and publishes the site. The public site's `verification.json` retains the date, scope, step counts and fingerprints for that deployment.

The integrated repository suite passed **211/211 tests with no skips**, including four static-site tests that verify all ten pages, exact displayed commands, manual labels, local links/fragments/assets, source links, accessible static content, and refusal to treat stale records as current passes. Browser QA exercised the desktop layout, search, category filters, empty-result reset, command copying, guide navigation, and the readable narrow-screen layout without page overflow. The inspected browser console had no errors. The documented local-app startup command with `--port 0` also printed its authenticated local URL and served the branded homepage successfully.

## Built app and CLI release verification

The v0.2.1 release adds an npm-installable GitHub asset containing the compiled CLI, local browser app, runtime templates, and documentation. It requires Node.js and npm; runtime dependencies are fetched during installation. It is not a self-contained native executable or an npm registry publication. See the [installation guide](INSTALLATION.md).

The release workflow checks the packaged archive in a clean user-owned global prefix on Linux and macOS with Node.js 22 and 24. Its scope is the installed package rather than a source-tree invocation: executable aliases and version, complete help, TypeScript preparation and execution, Python generation, authenticated app/static assets, archive installation, and removal of the installed package while preserving project files. Release assets include SHA-256 checksums, installation instructions, and platform-specific machine-readable verification reports. Consult the actual reports attached to a release for each completed result; describing the workflow here does not claim an uncompleted job passed.

A clean installation check on macOS ARM64 with Node.js 22.19.0 passed **all eight package checkpoints**: archive contents; aliases and full manual; TypeScript generation, preparation and execution; Python generation; app assets and authenticated APIs; a separate local installation with hoisted dependencies; extracted runtime-only installation; and uninstallation that preserves projects. The public release workflow repeats these checks on the four platform/Node combinations before publishing.

The v0.2.1 source check passed **211/211 tests without skips** and reran **all ten quickstarts / 46 executable command blocks** after the package/version changes. The website's source-install instructions remain separate because those exact walkthroughs use repository-relative commands and fixtures. Four optional account/container/cloud blocks remain manual.

Package installation tests do not establish real account authentication, paid model quality, cloud deployment, native Windows compatibility, an offline installation, or every possible Node/operating-system version. Those boundaries remain as described above.


## 0.2.2 app startup and installation documentation

The website now presents two installation paths with shared prerequisites: the built release package and a source checkout. Both end with the browser-opening `web enable` command. The README, installation guide, and offline `web` manual explain the persistent project directory, automatic port, foreground terminal lifetime, `--no-open`, custom workspace/port, and legacy `app` behavior. The release-installed offline quickstart does not require a source checkout.

The four focused static-site tests passed after these documentation changes. They check the two visible installation choices, release version URLs, browser-launch instructions, unchanged walkthrough command text, local links/assets/fragments, accessible static content, and fingerprint-bound verification. Local browser inspection checked desktop and 390-pixel mobile layouts, both install-command copy buttons, and source instructions. The mobile document had no horizontal page overflow; long commands scroll within their own panels. The inspected browser console contained no errors. These checks do not establish actual operating-system browser launching; launcher and clean-package tests supply that separate evidence.

The integrated v0.2.2 source suite passed **219/219 tests with no skips**, including eight launcher tests, and all **ten walkthroughs / 46 executable command blocks** passed from a clean build. Launcher checks cover readiness before dispatch, both web command forms, option placement, headless operation, legacy app behavior, invalid ports, portable home-directory defaults, platform argument handling, and bounded handoff waiting/cancellation.

A fresh v0.2.2 package installation on macOS ARM64 / Node.js 22.19.0 passed **13/13 checkpoints**. The original eight packaging checks remain, with five additions for the installed web command, web enable, app --open, no-open behavior, and browser-opener failure fallback. Browser openers in these tests are isolated executables that call the actual authenticated loopback app; this verifies the dispatched URL and readiness without launching the tester's desktop browser. Actual desktop browser behavior and native Windows/WSL handoffs are not claimed by these fixtures. The release workflow repeats package checks on Linux and macOS with Node.js 22 and 24 before publication; consult each release's attached reports for the results of that exact archive.

## CLI-first walkthroughs in v0.2.3

The public guides now use the installed `instrilo` command. The tutorial workspace comes from `instrilo tutorials setup`, which copies the package's example files and complete offline guides into a new folder. Existing destinations are refused; editing those copies does not change the installed package. `tutorials list`, `tutorials show`, and `explain tutorials` expose the workflow in the terminal. Source contributors link their build and use the same command.

The walkthrough runner now packs and installs the compiled package into a temporary, user-owned prefix, puts that `instrilo` command on PATH, and prepares each workspace through its `tutorials setup` command. It uses no source/dependency symlinks. The record includes the installed version, archive SHA-256, and source fingerprints. A supplied `--tarball` can be checked through the same path. Public verification metadata retains the package identity and checksum.

The expanded end-to-end guide creates guidance and architecture, configures a real TypeScript LangGraph with a read-only tool, separates builder/runtime/judge connections, locks dependencies, records and replays an observed graph, exercises both evaluation splits and a strict release gate, and generates separate AWS AgentCore, Google Cloud Run and Azure Container Apps artifact bundles. All model/tool responses in its automatic path come from named localhost fixtures. It checks that synthetic evidence remains blocked from production release. Target-specific artifacts include architecture selection, JWT/secret references, runbooks, local test previews and source ZIPs.

The [production continuation](PRODUCTION-WALKTHROUGH.md) describes the real connections, reserved holdout cases, reviewed requirements, human labels, container execution and account-specific deployment steps. The automatic walkthrough does not perform these manual steps, certify model quality, create cloud resources, or establish live cloud readiness. Its ZIPs are generated source/artifact bundles, not previously built or deployed container images.

Local verification on macOS ARM64 / Node.js 22.19.0 passed **221/221 tests without skips**, **all ten installed-package walkthroughs / 51 exact executable command blocks**, and **14/14 clean-release checkpoints**. Five explicitly manual/account-dependent guide blocks were excluded. The final static-site check passed all four tests and built twelve pages with ten matching passing walkthrough records. The source-link fallback was exercised in an isolated npm prefix, including tutorial setup and real generated TypeScript execution. GitHub release checks repeat installation on Linux/macOS with Node.js 22/24 before publication; see the attached reports for the published archive.
