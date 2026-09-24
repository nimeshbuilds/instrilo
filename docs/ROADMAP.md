# Instrilo roadmap

Build with intent. Ship with evidence.

Status: September 24, 2026, version 0.2. **IMPLEMENTED** means a bounded operation exists in this repository. **PLANNED** means it is not shipped. A local implementation or fixture is not a live-provider, cloud, security, or statistical quality certification; see [VERIFICATION.md](VERIFICATION.md).

## Product direction

Instrilo turns product intent into an agent repository people can inspect, test, change, and maintain. The first audience to validate is small engineering teams and agencies delivering agents for different clients. They need to explain why a release is acceptable, reproduce failures, and update infrastructure without losing their work.

The [competitive research](COMPETITORS.md) shows that creation, graph editors, tracing, judges, MCP, and deployment templates already exist. Our positioning hypothesis is the complete, inspectable engineering workflow across **Python and TypeScript**, with source and evidence usable outside Instrilo. A long feature checklist does not establish an advantage.

Six milestones now have working local implementations. Their original broader ambitions remain divided into completed scope and explicit follow-up work below. They should not be presented as six production-complete platforms.

## Current baseline

| Area | IMPLEMENTED in 0.2 | Practical boundary |
| --- | --- | --- |
| A. Requirements and release evidence | Reviewed source references, versioned case links, staleness, reasoned waivers, strict policy and JSON release decisions | Coverage is a human assertion; local records are not independent attestation. |
| B. Safe regeneration and upgrades | Retained baselines, dry runs, reviewed plan hashes, preservation/conflicts, opt-in line merges, journal recovery, legacy migration, npm/uv lock operations | Text merges need tests; remote model aliases and whole build environments are not frozen. |
| C. Failure bundles and replay | Content-consented recording, scrubbed export/import, actual frozen replay, explicit replay of a complete portable bundle against matching local code | Native/LangGraph only, Python and TypeScript. No live fallback or imported executable code. |
| D. Adapter contract | Versioned manifests, content pins, explicit code trust, local conformance, namespaced artifact extensions, authenticated provider gateway | Framework/target/host extensions augment built-ins; the public contract does not replace the built-in security/runtime implementation. |
| E. Human review and calibration | Blind queues, exact-output bindings, immutable labels/corrections, disagreement handling, descriptive false-pass/false-fail counts | Reviewer identity is self-asserted; no statistical reliability or automatic rubric calibration claim. |
| F. Durable approvals and observed graphs | Persisted native/LangGraph runs, exact action approvals, expiry/denial, restart/resume, ambiguous-write reconciliation, graph from actual events | Local OS identity and filesystem locks; no hosted approval service or arbitrary graph editor. |

These build on the shared CLI/app, guidance interview/editing, independent builder/runtime/judge connections, framework generation, evaluation, scoped tools/JWT, and cloud/MCP artifacts. The CLI exposes its whole command tree through `instrilo help --all`, machine-readable metadata through `help --json`, and the operational manual through `explain`. The app uses the same evidence, execution, generation, and export functions rather than a separate project format.

## A. Requirements linked to release evidence — IMPLEMENTED local baseline

**Outcome:** a maintainer can tell which product promises have current reviewed checks and why a proposed release is blocked. Domain experts can contribute requirements and cases without changing a framework.

The [evidence workflow](EVIDENCE.md) assigns stable requirement IDs and guidance-file hashes. Linking needs a reviewed requirement, a reviewed case, a reviewer, and a reason. Changes invalidate links instead of accepting yesterday's evidence. Release policies reject missing/stale/failed, demo, synthetic, waived, or disputed evidence by default; a judge-only link cannot satisfy deterministic coverage. Decisions capture the policy and evidence fingerprints. Both languages use the same sidecars while the source manifest remains schema v1.

**Acceptance already exercised:** changed guidance/case content blocks old coverage; missing linked cases block release; deterministic assertions are recomputed; explicit policy exceptions remain visible; CLI exit 2 identifies a completed but blocked release gate. Human labels bind to the registered report rather than a mutable result ID alone.

**PLANNED next:** requirement links to enforced tool/resource policies and trace-level assertions, not only output cases. Acceptance: a support fixture demonstrates that a forbidden send action cannot satisfy an approval requirement merely by printing the right phrase; changed authorization policy invalidates that evidence. Depend on F's events and a versioned assertion contract. Do not autoapprove model-proposed coverage.

## B. Safe regeneration and reproducible upgrades — IMPLEMENTED local baseline

**Outcome:** users can customize exported code and inspect an upgrade before applying it. Contributors can reproduce dependency conflicts with an actual package-manager lock.

[Regeneration](REGENERATION.md) compares retained generator output, current files, and incoming artifacts. It preserves user-only edits and foreign files, refuses overlaps, optionally merges separate text edits, and retains immutable baselines. Protected configuration/guidance/dataset mirrors must be changed in their source. The transaction journal and explicit recovery refuse to erase post-crash edits. Legacy migration preserves available baseline content and labels missing historical content honestly. Dependency lock creation and frozen installation are explicit, separate operations.

**Acceptance already exercised:** custom code survives unchanged generation; conflicts produce no artifact writes; changed obsolete files remain; stale plans and symlink paths reject; interrupted updates recover conservatively; dependency locks stay user-owned. Export holds the generation lock, rejects incomplete or stale source mirrors, and excludes private history.

**PLANNED next:** maintained extension modules for custom tools plus a representative framework-upgrade fixture. Acceptance: a real Python and TypeScript customization survives a documented SDK/template upgrade and passes its behavior tests. Depend on D's stable extension points. Keep semantic/AST merging and reproducible historical compiler environments separate from the current line-merge guarantee.

## C. Portable failure bundles and replay — IMPLEMENTED for native/LangGraph

**Outcome:** a user can share a bounded failure record and reproduce supported behavior without repeating external side effects.

[Recorded runs](RUNS.md) capture normalized model/tool events only with explicit content consent. Metadata-only exports are the default. Import validates and displays data without installing or executing anything. Complete, unredacted terminal bundles can be replayed through an explicit local-execution operation against an already built project whose source and dependency-lock fingerprints match. Replay returns recorded responses and rejects missing or changed fixtures with zero live model/tool fallback.

**Acceptance already exercised:** a recorded read/approval/write flow resumes after process restart, replay works after the fixture provider/tool server is shut down, missing fixtures fail, and replay does not repeat a write. Python and TypeScript share the supported native/LangGraph contract. Redacted or incomplete records stay inspect-only; imported approvals cannot grant a new action.

**PLANNED next:** standard trace export and bounded counterfactual evaluation with frozen tools. Acceptance: an explicit counterfactual command reports which fresh model calls occurred, never performs external writes, and labels its result separately from frozen replay. Depend on D's per-operation capability declarations. OpenAI Agents/CrewAI durable replay needs actual SDK fixtures before those combinations are advertised.

## D. Adapter contract and conformance kit — IMPLEMENTED experimental contract

**Outcome:** contributors can add useful project artifacts or a model transport without privately forking the entire application, and users can inspect the code and its declared permissions first.

The API-v1 adapter manifest declares kind, version, operations, supported languages, entrypoint, and environment/network/filesystem intent. Explicit installation pins the bundle's content. Namespaced generation writes below `extensions/ADAPTER_ID/` and participates in safe regeneration. Completion providers can run behind an authenticated loopback OpenAI-compatible gateway. Conformance checks exercise envelopes, declared language generation, and rejection of invalid/unknown input without forwarding configured provider secrets.

**Acceptance already exercised:** pinned code changes require reinstall; unsafe paths and reserved runtime environment variables reject; generation cannot overwrite protected built-in code; malformed completion results reject; local gateway auth, input limits and cancellation are testable without a paid account.

**PLANNED next:** extract selected built-ins through the public contract and add operation-specific capability/conformance profiles. Acceptance: one built-in transport and one supported framework extension use the same interface as a third-party package; CLI/app/validation agree on declared supported operations; a missing tool-call or cancellation capability fails before execution. A framework-specific Python exception remains explicit rather than claiming TypeScript parity.

Dependencies: A/B fingerprints and C/F event semantics. Passing a local envelope test is not broad SDK compatibility. Permission declarations are not an OS sandbox; adapters are trusted executable code. A plugin marketplace and hostile-code hosting are separate decisions.

## E. Human review and judge calibration — IMPLEMENTED descriptive baseline

**Outcome:** people can inspect whether automated judgments match task experts and preserve the reasons when they do not.

The [review workflow](EVIDENCE.md) hides judge/check/prior-human verdicts by default, binds labels to report/case/output/judge hashes, and appends corrections without erasing original labels. Opposing active reviewers remain unresolved; abstentions do not count as consensus. Reports show sample size, agreement, false passes/fails, unreviewed cases, disagreements, and missing judge assessments. Changed rubric/configuration makes historical evidence stale without rewriting the old judgment.

**Acceptance already exercised:** asynchronous stale-binding rejection, immutable label import/export, same-reviewer corrections, quorum enforcement, disagreement blocking, and exclusion of demo/scoring failures from calibration samples. The format is shared across Python/TypeScript outputs.

**PLANNED next:** task-stratified sampling, reviewer assignment/adjudication, uncertainty estimates, and pairwise order controls if pairwise judges are introduced. Acceptance: reports distinguish sample selection from population reliability, a heldout rubric comparison preserves old judgments, and adversarial judge-input fixtures remain failures to assess rather than fabricated passes. Depend on stable A report/case references. Hosted reviewer authentication is part of a separate collaboration boundary.

## F. Durable approvals and inspectable workflows — IMPLEMENTED local native/LangGraph

**Outcome:** a write can pause for inspection, survive a process restart, and resume after approval of the exact action. The graph explains what actually happened.

The [local journal](RUNS.md) binds approval to run/build/event/tool arguments, caller/tenant labels, and scopes. Approval is single-use and expires; denial, changed identity/build, stale digest, and concurrent claims reject. A started tool with an uncertain result requires external verification and recorded reconciliation. Replay supplies completed results without repeating external actions. JSON/Mermaid and the local app render observed events and pauses.

**Acceptance already exercised:** concurrent reviewers/resumes cannot both claim an operation; rejected or expired approvals do not send a write; reconciliation continues without repeating the uncertain call; changed source or fixtures block replay. Available in native and LangGraph for both languages on macOS/Linux/WSL.

**PLANNED next:** an authenticated remote approval service only when a real multi-user deployment needs it. Acceptance: separately authenticated reviewer identity, tenant/resource authorization, transactional cross-worker state, revocation and audit storage pass negative multi-user tests. Depend on C events, D capabilities, and a deployed identity/storage design. No local caller string is sufficient remote identity. General graph editing and round-trip framework conversion remain deferred.

## Next priority: validate the workflow, then close observed gaps

| Priority | PLANNED outcome | Acceptance | Dependencies |
| --- | --- | --- | --- |
| P0 | A complete design-partner workflow in both languages | Three teams complete brief → customization → reviewed release → failure reproduction → upgrade; record interventions and unresolved work | Current A–F baseline, task-specific reviewed fixtures |
| P0 | One deliberately verified provider/target path | Document exact versions, account setup, auth failures, deployment/invocation/cleanup and remaining manual steps | Existing provider/deployment artifacts; operator-authorized accounts |
| P1 | Stronger policy/trace evidence and adapter profiles | A forbidden tool action is enforced and traced; declared adapter capability failures surface before run | A, C, D, F |
| P1 | Maintained extension points and framework upgrade fixtures | Real custom behavior survives a reviewed Python/TypeScript upgrade | B, D |
| P2 | Multi-user review/approvals and statistically informed evaluation | Identity/tenant negative tests and correctly scoped uncertainty reports | E/F plus explicit hosted architecture |

Gateway deployment policy remains **PLANNED**: role-specific allowed endpoints/models, externally managed credentials, resource authorization, time/concurrency limits, and auditable rejection before external requests. The current authenticated local adapter gateway is not this deployment policy product. Hard aggregate spending limits need reservation/accounting semantics and must handle uncertain provider billing; missing price data cannot become a false budget guarantee.

Do not prioritize integration count, a marketplace, autonomous agent teams by default, a universal graph canvas, or a new hosted observability platform ahead of demonstrated user work. Subscription adapters are conveniences within supported vendor interfaces, not the architectural foundation.

Measure time to a reviewed result, setup interventions, failures reproduced, custom changes preserved, and continued use. Compare the same workflow against relevant alternatives rather than claiming advantage from a checklist. Publish verification evidence instead of dates that assume all providers, languages, frameworks, and targets are equivalent. Use [CONTRIBUTING.md](../CONTRIBUTING.md) for bounded contributions; the unimplemented acceptance items above are intended starting points.
