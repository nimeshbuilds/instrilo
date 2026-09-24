# Contributing to Instrilo

Instrilo turns product guidance into agent source, execution, evaluation, and delivery artifacts. Contributions should make that workflow easier to understand, reproduce, and maintain. Python and TypeScript are both first-class generated runtimes; the workbench itself is written in TypeScript.

Read the [README](README.md) for the user workflow, [verification record](docs/VERIFICATION.md) for current evidence, and [roadmap](docs/ROADMAP.md) for proposed priorities. The roadmap deliberately distinguishes implemented behavior from planned work.

## Set up the workbench

Use Node.js 22 or newer and npm on macOS, Linux, or WSL. Native Windows dependency preparation and process-tree cancellation still need fixes and verification. From a checkout:

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
```

Start the local app with:

```sh
npm run dev -- --workspace .studio/projects --port 4317
```

Open the authenticated URL printed in the terminal. New projects use the offline demo. No model account, API key, cloud account, or paid subscription is required for baseline contribution work.

The default test suite includes a real generated TypeScript dependency installation in a temporary directory. It may need package-registry access or a populated cache. It does not invoke live model providers or deploy cloud resources. Avoid describing that distinction as “no network.”

## Include Python verification

Use Python 3.11–3.13. `uv` is needed for Python `prepare`, dependency locks, and the durable native/LangGraph tests. The standalone Python CLI test creates a temporary virtual environment with pip.

```sh
NB_AGENT_PYTHON=/absolute/path/to/python3 npm test
```

Without `NB_AGENT_PYTHON`, Python CLI and durable-runtime integration cases are explicitly skipped. Report the skip rather than claiming both runtime languages passed. Keep framework environments separate: their SDK dependency requirements can differ.

For a manual native Python project:

```sh
npm run cli -- init contributor-python --language python --directory .studio/projects
npm run cli -- build .studio/projects/contributor-python
NB_AGENT_PYTHON=/absolute/path/to/python3 npm run cli -- prepare .studio/projects/contributor-python
npm run cli -- run .studio/projects/contributor-python --input "Offline contributor smoke check"
```

Use `--language typescript` and a different project name for the equivalent TypeScript workflow. `prepare` uses npm for that generated project. Generated `.env.example` files contain variable names; they do not automatically load credentials.

## Choose the right checks

Run focused checks during development, then the applicable repository checks before submitting. A documentation-only change does not require every framework to be reinstalled.

| Change | Relevant checks |
| --- | --- |
| Manifest, compatibility or guidance | `tests/core.test.ts`, relevant workbench/server cases, `npm run check` |
| Provider transport or authentication | `tests/providers.test.ts`, invalid/timeout/cancellation fixtures, documentation of supported capabilities |
| Generated runtime/framework code | Generator tests and the optional real-framework smoke suite for affected languages/combinations |
| API, UI or project filesystem behavior | Server/security tests, build, and a local browser check of the affected flow |
| Evaluation behavior | Evaluation tests, unchanged/changed case and rubric comparisons, explicit failure behavior |
| Build/regeneration or deployment selection | Regeneration/rebuild/deployment tests; use fixture scripts instead of real cloud actions |
| Requirement/review/release changes | Evidence/review and CLI-evidence tests; stale bindings, conflicting labels and denied releases |
| Durable runs or approvals | Runs tests in both languages; zero-network replay, expiry, uncertain outcomes and concurrent operations |
| Extensions and CLI | Adapter/CLI tests; `npm run docs:cli` then `npm run docs:check` |
| Remote MCP source | MCP protocol smoke suite for both languages; no real host account is needed |

For example:

```sh
npx tsx --test tests/core.test.ts tests/server.test.ts
npm run check
npm run build
```

The normal test entry point is `npm test`. There is no separate lint/format command currently; match surrounding TypeScript/JavaScript style and avoid unrelated reformatting.

### Actual framework smoke tests

The optional suite installs the seven supported language/framework variants into separate directories, runs their real SDKs against local model/tool fixtures, and checks generated HTTP boundaries:

```sh
PYTHON=/absolute/path/to/python3 AGENT_SMOKE_ROOT=/tmp/agent-contributor-smoke node --import tsx tests/generator-runtime-smoke.mjs --install
```

Use a dedicated disposable directory. Omit `--install` to reuse its dependency environments after the first run. This suite can download substantial dependencies and is separate from `npm test`; its model and tool traffic remains local. Do not combine CrewAI and other Python framework dependencies into a single virtual environment.

After that suite has prepared environments, run the remote MCP checks using the same absolute smoke-root path:

```sh
NB_SMOKE_NODE_MODULES=/tmp/agent-contributor-smoke/typescript-native/node_modules \
NB_SMOKE_PYTHON=/tmp/agent-contributor-smoke/python-native/.venv/bin/python \
node tests/mcp-http-smoke.mjs
```

The MCP suite uses real transports, a stub agent, and locally signed test JWTs. See [CHAT-HOSTS.md](docs/CHAT-HOSTS.md) for standalone setup and protocol boundaries. These commands are POSIX-shell examples; use WSL on Windows for the current source release and report platform-specific skips.

## Where code belongs

| Area | Files |
| --- | --- |
| Public project/data contracts | `src/types.ts` |
| Schema, compatibility, guidance and cases | `src/core.ts` |
| Provider transports and diagnostics | `src/providers.ts` |
| Framework and target generation | `src/generators.ts`, `src/templates/` |
| Execution, evaluation and build freshness | `src/execution.ts` |
| Project creation, refinement and rebuild | `src/workbench.ts` |
| Evidence, review and release policy | `src/evidence.ts`, `src/review.ts` |
| Regeneration, dependency provenance and durable runs | `src/regeneration.ts`, `src/runs.ts` |
| Trusted extensions | `src/adapters.ts`, `src/adapter-worker.mjs` |
| CLI and local application | `src/cli*.ts`, `src/project-ops.ts`, `src/server*.ts`, `src/web/` |

Keep business logic in shared modules where the CLI and app need identical behavior. Change templates rather than checking in a patched `generated/` output as the implementation. Runtime fixes that apply to both languages need both templates and equivalent observable tests.

## Propose a design change

Start an issue or discussion before a large schema change, a new public adapter interface, a new framework/target, or a change to authorization and approval semantics. Routine fixes and small documentation improvements can go straight to a focused pull request.

A useful proposal states:

1. A concrete user failure or repeated task, with a minimal redacted example.
2. The proposed observable behavior and why existing functionality does not satisfy it.
3. Affected manifest fields, generated files, languages, providers and destinations.
4. Compatibility/migration and ownership implications, especially for user-edited code.
5. A bounded acceptance fixture and what remains deliberately out of scope.

Use the roadmap's priorities as guidance, not as proof that a feature is implemented or that a maintainer has committed to a schedule. New providers/frameworks should declare their supported combinations; avoid silently approximating unsupported features. For an inherently language-specific framework, document that boundary rather than adding a misleading second-language checkbox.

## Keep tests and reports trustworthy

Use local HTTP fixtures, fake CLI executables, synthetic keys, and temporary directories in baseline tests. Tests must not silently reuse a contributor's provider login, exchange real OAuth credentials, consume model credits, send messages, or run cloud deployments. A new live smoke test must be a separately invoked operation with explicit setup and a clear account/cost boundary.

Never include real prompts containing private customer data, access tokens, `.env` files, or account credential stores in a patch or issue. Redact traces before sharing. Keep tool-result text and evaluated model output untrusted; they must not grant permissions or override a judge's rubric.

Match tests to failure modes. For example, a tool adapter needs coverage for invalid arguments and denied scopes/approvals, not only a successful response. A cancellation fix should show work has stopped rather than merely hiding a pending result. Avoid tests that only restate implementation details.

Report exactly what was exercised: static checking, generated artifacts, local mocks, installed framework behavior, or deliberate real-account tests. A passing local OAuth fixture is not verification of an enterprise identity provider, and a generated cloud file is not a deployment. Never change synthetic cases to `reviewed` without an actual human review.

## Submit a focused pull request

Explain the problem and resulting behavior, then include relevant validation and limitations. Add a before/after example when it makes the change easier to assess. Update user documentation when commands, capabilities, generated outputs, or setup requirements change.

Include tests for material behavior changes and the failure being fixed. For UI changes, provide a screenshot or concise browser-check description of the affected flow. Keep unrelated refactors and generated dependency churn separate. Do not commit `node_modules`, virtual environments, local projects, reports with sensitive data, or machine-specific paths.

When a dependency changes, update the corresponding lockfile where one is maintained and exercise the affected generated environment. Do not report a cached environment as a clean-install check. List any unavailable test environment or skipped check plainly.

## Good first contribution proposals

These are starting ideas, not claims that matching issues already exist:

- Add a minimal fixture for a reproducible bug in one of the current command/API flows.
- Improve a confusing compatibility error while keeping CLI/app validation consistent.
- Extend an existing provider fixture for a documented error envelope without making a live model call.
- Document a platform-specific setup failure with the exact runtime versions and a verified fix.
- Improve keyboard access, focus handling, or an error message in one app flow, with a browser check.
- Add a domain-specific requirement-to-case example or a custom-code regeneration regression.

Do not report an exploitable vulnerability with secrets or a public attack reproduction in an ordinary issue. If the published repository provides private vulnerability reporting, use it; otherwise ask the maintainer for a private reporting route before sharing exploit details. No private contact address or response-time guarantee is implied here.
