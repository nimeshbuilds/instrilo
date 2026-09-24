# Instrilo roadmap

Build with intent. Ship with evidence.

Status: September 24, 2026. **IMPLEMENTED** describes behavior in this repository; **PLANNED** describes proposed work, not an available feature or a delivery commitment. Verification levels are recorded separately in [VERIFICATION.md](VERIFICATION.md).

## The product direction

Instrilo should make it easy to **turn requirements into an agent repository people can test, change, and maintain**. The first audience to validate is small engineering teams and agencies delivering agents to different clients. They need to explain why a release is acceptable, reproduce a failure, and upgrade a project without losing their own work.

The [competitive research](COMPETITORS.md) shows that creation, graph editors, tracing, judges, MCP, and deployment templates already exist in integrated products. Adding all of them is not, by itself, a competitive advantage. Our proposed advantage is a coherent, inspectable engineering workflow across supported **Python and TypeScript** projects, with source and evidence that remain usable outside this tool. This is a positioning hypothesis to test with users, not a claim of exclusivity.

Success should look like this: a maintainer changes a requirement, sees which behavior and examples it affects, inspects a code diff, reproduces relevant failures, and exports a reviewed release. The community should be able to extend that workflow without maintaining a private fork of the entire application.

## What is already implemented

| IMPLEMENTED | Practical boundary |
| --- | --- |
| Shared CLI and local app, guidance import/interview/editing, follow-up questions | Missing requirements remain visible; conflict detection is bounded and partly syntactic. |
| Independent builder, runtime, and judge connections | Actual provider/account entitlement still needs a deliberate live check. |
| Native, LangGraph, and OpenAI Agents generation in Python and TypeScript; CrewAI in Python | Support is combination-specific. A Python-only framework is not represented as TypeScript support. |
| Actual runtime execution, deterministic checks, optional LLM judges, traces and comparison fingerprints | There is no replay engine, human calibration workbench, or statistically established quality guarantee. |
| Build fingerprints and refusal to run stale configuration; obsolete generated-file cleanup | Changed obsolete files are preserved. **`build --overwrite` can still replace manual edits to files that remain generated.** There is no three-way merge or general custom-code preservation. |
| Scoped HTTP tools, exact-call approval digests, inbound JWT, bounded execution | There is no durable single-use approval ledger or automatic tenant-specific data filtering. |
| Owned source, portable manifest, guidance and evaluation export; cloud and MCP artifacts | Local protocol/framework checks are recorded. Real cloud deployments and account connections are not implied. |

The current implementation is the starting point for these milestones. Existing trace arrays and hashes must not be relabeled as completed replay, provenance, or release-management features.

## Priorities and dependencies

| Priority | PLANNED milestone | User outcome | Depends on |
| --- | --- | --- | --- |
| P0 | A. Requirements linked to release evidence | Know which promises were tested and which remain unresolved | Versioned requirement/case references and backward-compatible migration |
| P0 | B. Safe regeneration and reproducible upgrades | Update generated infrastructure without losing custom work | File ownership contract, retained generation baseline, dependency locks |
| P1 | C. Portable failure bundles and replay | Reproduce a reported failure without repeating external side effects | A's identifiers, B's versioned build inputs, a shared event schema |
| P1 | D. Public adapter contract and conformance kit | Add an integration with evidence instead of broad compatibility claims | Extracted existing adapters; shared fixtures and version policy |
| P1 | E. Human review and judge calibration | Understand when an automated score disagrees with people | A's evaluation references and versioned datasets/rubrics |
| P2 | F. Durable approvals and inspectable workflows | Resume approved work safely and understand real control flow | C's event/state contract and D's capability declarations |

Start the schema/version work needed for A and B before expanding their UI. D can begin by wrapping the existing test fixtures, but its public compatibility promise should follow the first working adapters. F should support a narrow, explicitly tested workflow subset before adding more framework combinations.

## A. Requirements linked to release evidence — PLANNED, P0

**Why it matters:** a passing evaluation is hard to interpret when nobody knows which product requirements its cases cover. This is also a useful open-source contribution surface: domain experts can improve requirements, examples, and checks without writing an orchestration framework.

Add stable requirement identifiers with guidance-source references and an explicit review state. Link each requirement to an enforced policy, deterministic check, reviewed example, human review, or an explicit “not yet testable” decision. Builder-proposed links remain proposals until reviewed; fluent generated explanations do not establish coverage.

**Acceptance criteria:**

- A sample support-drafting brief includes requirements for grounded answers, billing escalation, and approval before sending. Each has an inspectable source and evidence link, including a deliberately uncovered requirement.
- Editing a source requirement marks affected links/results for review; it does not silently accept yesterday's result against changed requirements.
- CLI and app show the same requirement/evidence status. A machine-readable release report distinguishes passed checks, failed checks, uncovered requirements, unreviewed cases, and waived items with a recorded reason.
- CI can apply a project-owned release policy with explicit exit codes. Synthetic cases cannot be presented as human review, and a judge score alone cannot satisfy a configured deterministic policy requirement.
- The example and report contract work for Python and TypeScript. Existing manifests migrate without inventing business rules or silently changing runtime behavior.

**First contribution:** propose the requirement-to-case schema and a fixture showing a changed requirement invalidating one evidence link. Keep the first version small; do not add a general requirements-management database.

## B. Safe regeneration and reproducible upgrades — PLANNED, P0

**Why it matters:** code ownership is of limited value if the next generation step destroys the user's changes. Contributors also need dependency failures to be reproducible instead of depending on whichever package versions resolved that day.

Define which files belong to the generator, which belong to the user, and where supported customizations live. Prefer stable extension modules for custom tools and business logic. Use a retained prior generation baseline for three-way comparison where files must be shared; do not promise arbitrary AST rewriting across every framework.

**Acceptance criteria:**

- A dry-run presents additions, changes, deletions, preserved user files, and conflicts before writing. These commands are proposed behavior, not current CLI options.
- A user adds a custom tool and modifies generated behavior, then upgrades templates. User-owned files remain byte-for-byte unchanged; conflicting shared-file changes produce a reviewable conflict rather than a silent overwrite.
- A failed or interrupted update preserves a recoverable previous project. Unsafe paths and symlinks remain rejected; modified obsolete files are not silently deleted.
- A release lock records schema/generator/template versions, guidance hashes, relevant dependency locks, runtime versions, and configured model identifiers. Mutable provider aliases are explicitly marked as such; a lock cannot freeze a remote model the provider does not version.
- Fresh environments can install a generated TypeScript project from its npm lock and a generated Python project from its Python dependency lock without a new dependency solve. Semantically identical inputs produce identical generated content apart from separately identified run metadata.
- Schema migrations have a dry-run, backup and validation step, fixtures for older supported versions, and an explicit refusal path for unsupported conversions.

**First contribution:** a file-ownership proposal and regression fixture for “custom tool survives template update.” Lockfile/schema work should land in small, independently reviewable changes.

## C. Portable failure bundles and replay — PLANNED, P1

**Why it matters:** an issue containing “the agent failed once” is expensive for both users and maintainers. A small, scrubbed reproduction can make a community issue actionable without sharing account credentials or production access.

Introduce a versioned event format for observable model requests/responses, tool calls/results, authorization decisions, timing, and state transitions. Do not request or store private model reasoning. Sensitive content capture must be explicit and redactable; metadata-only recording should remain useful.

**Acceptance criteria:**

- Export/import a failure bundle containing the manifest/build references, relevant input/case, ordered events, and declared redactions. A contributor can inspect it without running the agent or executing bundled code.
- Exact replay uses recorded model and tool responses and performs **zero external requests**. A missing fixture fails explicitly rather than falling back to a live provider.
- A separate counterfactual mode can evaluate a changed agent against frozen tools. It clearly identifies newly invoked model calls and their cost/behavior limits; its results are not called deterministic replay.
- Write tools are disabled during replay. Tests verify that replay of an earlier write never repeats the external action.
- Python and TypeScript implementations produce semantically equivalent events for the same supported task, with adapters for framework-specific details instead of dropped events.
- An issue-safe export removes test credentials and selected sensitive fields, records what was omitted, and warns when redaction prevents faithful reproduction. A standard trace export can integrate with existing observability tools without making one hosted service mandatory.

**First contribution:** the event schema and one native Python/TypeScript replay fixture for a failed HTTP tool call. Add other frameworks after the contract survives that example.

## D. Public adapter contract and conformance kit — PLANNED, P1

**Why it matters:** the community should be able to add a provider, framework, or destination without changing several hardcoded lists. Users need to know which operations were tested, especially when an endpoint is only partially API-compatible.

Extract distinct contracts for provider transport, framework generation, runtime target, and client/channel integration. Keep role selection separate. A CLI subscription session must not be advertised as a generic cloud API credential.

**Acceptance criteria:**

- At least one existing built-in adapter of each applicable kind uses the public contract before it is called stable. Capability negotiation rejects unsupported operations before generation or execution.
- A sample third-party adapter can be developed locally with a pinned version, declared permissions, compatibility range, and reproducible tests. Installation is explicit: extensions are code, not implicitly trusted metadata.
- The conformance kit checks protocol envelopes, timeouts/cancellation, size bounds, auth-reference handling, tool-call semantics, and negative authorization cases. Framework adapters run their real SDK against local fixtures.
- The published matrix identifies language × framework × provider × target × operation, dependency versions, evidence date, and verification tier. A mocked transport test cannot label an account or cloud destination live-verified.
- A contributor adding a generally applicable runtime capability supplies Python and TypeScript coverage. A framework-specific exception can remain Python-only if declared and tested; unsupported combinations fail clearly.
- Live provider/cloud checks are opt-in and separate from baseline contributor tests. No secret or paid subscription is required to contribute a deterministic adapter fixture.

**First contribution:** move the existing supported-combination data into one validated capability source and test that CLI, app, validator, generator, and documentation agree. A plugin marketplace is not required for this milestone.

## E. Human review and judge calibration — PLANNED, P1

**Why it matters:** configurable judges are already common. The useful next step is showing where their assessments agree or disagree with people who know the task. Reviewers need a manageable queue; maintainers need evidence for changing a rubric or threshold.

**Acceptance criteria:**

- Reviewers can label outputs, record a reason, and distinguish individual judgments from resolved labels. A blind-review option hides the judge's verdict until the human has submitted a judgment.
- Reports show the sample size and judge-human agreement, including false-pass/false-fail counts for categorical labels and unresolved disagreements. They do not turn a small calibration set into a reliability claim.
- Each assessment records dataset/case, rubric, judge configuration, and reviewer-label versions. Changed rubrics trigger a comparison rather than overwriting previous judgments.
- Development and holdout sets are versioned separately. The builder's normal refinement path does not automatically receive holdout answers; promotion to a release evaluation is an explicit operation.
- Fixtures cover malformed judge output, prompt injection inside evaluated text, and position/order effects for any pairwise evaluation feature. A scoring failure remains a failure to assess, not a passing result.
- The same review/evidence format works for outputs from both languages; there is no separate TypeScript and Python review product.

**First contribution:** a human-label import/export format and a small disagreement report using supplied synthetic fixtures. Do not auto-label those fixtures as real human review.

## F. Durable approvals and inspectable workflows — PLANNED, P2

**Why it matters:** today an exact-call digest can gate an action, but there is no durable pause/review/resume lifecycle. A useful graph should explain the actual execution and its pauses, not suggest capabilities the generated runtime lacks.

Start with native and LangGraph support in both languages, if the conformance kit demonstrates the required semantics. Other adapters should declare unsupported behavior until their implementations are exercised.

**Acceptance criteria:**

- An agent pauses before a write, survives a process restart, and resumes only after an authorized reviewer approves the exact tool, arguments, caller/tenant, and relevant state. Denial, expiry, changed arguments, and reusing a consumed approval all reject the action.
- Approval and run-state transitions are persisted transactionally and tested with concurrent workers. Tool adapters declare their idempotency behavior; an ambiguous network outcome is surfaced for reconciliation rather than promising impossible universal exactly-once delivery.
- A read-only graph/trace view corresponds to actual nodes, transitions, pauses, and tool outcomes in supported runtimes. Native and framework implementations pass equivalent interruption/resume fixtures.
- Any later graph editing is limited to declared operations and passes round-trip tests: manifest → framework → inspectable representation preserves meaning. Unsupported nodes cannot be silently approximated.
- Request bodies, model outputs, and instruction files cannot authorize their own approvals. The review UI is an access-controlled client of the approval service, not its security boundary.

**First contribution:** a state/approval contract and tests for expiry, altered arguments, and duplicate resume. A broad drag-and-drop editor comes after the execution contract.

## Gateway and deployment policy — PLANNED, after adapter foundations

Gateway-specific work should be driven by a real deployment rather than growing an entire enterprise control plane in advance. The first policy profile should restrict allowed endpoints/models by role, reference externally managed credentials, and apply the same policy during local validation and runtime execution. Outbound model identity remains separate from inbound caller identity and tool-resource authorization.

Acceptance for a first deployment profile: a forbidden provider or missing scope is rejected before any external request; time/tool/concurrency limits are exercised; unknown price data remains unknown rather than becoming a false spending guarantee; a deliberate target smoke test records identities/configuration and cleanup. Hard aggregate spending limits need reservation/accounting semantics across workers and explicit handling of provider-side billing uncertainty.

Depend on D's capability contract; integrate release evidence from A and approved-action state from F where needed. Hosted organization accounts, tenant administration, and managed cloud provisioning are separate future decisions. Configuration templates alone cannot establish tenant isolation.

## What we will deliberately defer

Do not prioritize a large integration count, a marketplace, autonomous agent teams by default, a generic graph canvas, or a new observability platform ahead of the milestones above. Reuse established storage, tracing, identity, and package tooling where it fits. Preserve usable local workflows and exports; a hosted account should not be a prerequisite for the core author/build/test loop.

Subscription adapters are convenient where vendors support them, but changing vendor entitlements should not determine the architecture or the project's value proposition.

## How priorities change

Recruit three to five teams to complete the same brief → custom change → failure diagnosis → upgrade exercise in Python or TypeScript. Record setup interventions, time to an acceptable reviewed result, whether a failure can be reproduced, and whether custom work survives the upgrade. Compare against the relevant alternatives identified in [COMPETITORS.md](COMPETITORS.md); do not infer an advantage from a feature checklist.

Promote a milestone when it removes repeated observed work, has an inspectable acceptance fixture, and has a plausible maintainer. Publish completed evidence rather than dates that assume every provider/framework/cloud combination is equivalent. Use [CONTRIBUTING.md](../CONTRIBUTING.md) to propose a bounded first contribution.
