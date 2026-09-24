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
