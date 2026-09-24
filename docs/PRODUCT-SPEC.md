# Instrilo — product specification

Version 0.1 · 2026-09-23

## Product decision

Build a CLI-first agent project compiler with a web app over the same core. A user describes a job or supplies a guidance directory, chooses a framework and model connections, and receives an inspectable agent project with evaluation and delivery artifacts. The promise is **a runnable starting point with explicit assumptions and measurable behavior**. A generated project is not automatically reliable, secure, or ready for unrestricted production use.

The initial audience is a technical solo founder or small software team adding its first agent. A useful pilot is support research and response drafting: read a ticket, find supporting documentation, draft an answer, and request approval before sending. This is a proposed market wedge, not an enforced business rule or a conclusion from customer research.

The product should answer five practical questions:

1. What is the agent supposed to do, and which decisions remain unresolved?
2. Which tools and data can it access, under whose identity?
3. Does it pass reviewed examples, and what changed when a prompt or model changed?
4. Which provider/framework/target combinations have actually been verified?
5. Can the user export, run, and own the resulting code?

## Source and decision record

The source of product requirements is the project owner's brief in this conversation: a near-one-click agent stack; guidance-directory input; a guided interview; CLI followed by an app; Python and TypeScript; multiple frameworks; independently configurable builder, runtime, and judge; supported subscriptions or APIs or a custom gateway; JWT authentication and authorization; and artifacts for cloud runtimes, a local API runner, coding harnesses, and chat applications.

The brief's reference to Andrew Ng motivates task decomposition, tools, reflection, planning, collaboration when useful, and empirical evaluation. This document does not claim endorsement, a certified implementation of a course, or that every pattern should appear in every project. A simple workflow that passes task-specific evaluations is preferable to unnecessary autonomous loops.

Architectural judgments made here are explicitly product choices: portable specifications, code ownership, deterministic templates for critical plumbing, independently configured provider roles, a tested compatibility matrix, and versioned evaluation evidence. Customer willingness to pay and the best initial workflow still need validation.

Vendor SDKs, subscription permissions, API schemas, and hosting contracts change. Generated setup notes and the repository's current implementation are the immediate implementation references; vendor documentation and live account tests must establish production compatibility. A generated file, mocked request, or passing offline test is not evidence of a completed cloud deployment.

## Vocabulary and independent configuration

| Concept | Meaning | Example |
| --- | --- | --- |
| Provider connection | Model endpoint or supported CLI transport plus an authentication reference | API key stored in an environment variable, OAuth client credentials, local CLI session, custom gateway |
| Role | Where a connection is used | Builder, runtime, judge |
| Framework | How application control flow and tool execution are implemented | Native loop, LangGraph, OpenAI Agents, CrewAI |
| Runtime target | Where the exported service executes | Local runner, container, AWS AgentCore, Cloud Run, Azure Container Apps |
| Development harness | A tool used to build or interactively run development tasks | Codex, Claude Code |
| Host/channel | An application that interacts with the agent through a supported bridge | Claude Desktop, ChatGPT, web chat |
| Subscription | A vendor-specific access and billing arrangement | Access through an official logged-in client where its supported interface permits it |

A subscription is not a transferable API credential. Support must identify the exact client, operation, authentication mechanism, and limitations. A builder may work through an interactive or headless CLI session even when that connection cannot host a cloud agent. Never extract browser session cookies or assume a paid chat subscription entitles a third-party service to API usage.

A custom gateway is a connection transport. Its actual model capabilities, tool calling, structured outputs, streaming, usage reporting, and authentication support still need verification. An OpenAI-shaped HTTP endpoint does not prove identical semantics.

## User journey

### Existing guidance

1. Select a guidance directory and inspect the eligible files locally.
2. Show file inventory, hashes, missing sections, unresolved placeholders, and potential conflicts.
3. Confirm task intent through a concise interview for missing decisions.
4. Choose language, framework, independent provider roles, tool permissions, and delivery target.
5. Validate configuration and show unsupported combinations before generation.
6. Generate the project and review its behavior, permission policy, and target artifacts.
7. Run a local preview and evaluation cases. Inspect failures and traces.
8. Add real reviewed examples and holdout cases. Calibrate the judge.
9. Deploy through an explicit supported target workflow when credentials and target-specific requirements are ready.

### No existing guidance

The interview covers purpose, users, inputs, outputs, success criteria, tools, boundaries, escalation, examples, and operations. Answers become readable Markdown guidance. Blank answers remain `UNDECIDED` alongside the actual unanswered question. The wizard must not invent refund thresholds, retention periods, legal requirements, access permissions, human owners, or escalation rules.

An optional live builder can help refine wording or propose missing questions. Its suggestions are distinguishable from user-provided facts. Refinement should not silently grant permissions, change authorization, or label generated examples as reviewed.

### Concrete example

Input: “Research support tickets using our help center and draft a response. Billing disputes need a human.”

The wizard requests representative redacted tickets, the help-center source, the supported ticketing API, who can read which tickets, what counts as a dispute, and whether any action may send a response. If those answers are absent, the system records the missing decisions. It can still build a local draft-only preview with no external tools configured.

Output: an owned code project with a typed application entry point, tool definitions, authenticated API boundary if selected, limits, example configuration, guidance, evaluation cases, and delivery instructions. The dashboard distinguishes mechanical checks from judge assessments and labels synthetic data.

## Shared architecture

```text
CLI ───────────┐
              ├── shared core ── project spec + guidance inventory
Web app ──────┘        │
                      ├── builder connection / optional refinement
                      ├── framework generator ── owned Python or TypeScript code
                      ├── runtime connection ── agent execution
                      ├── evaluator ── deterministic checks + optional judge
                      └── delivery generator ── runtime / harness / host artifacts
```

The manifest is the source of truth. CLI and app call the same parser, validator, guidance scanner, generator, and evaluation functions. The web app must not acquire a second, incompatible configuration model.

Critical infrastructure is generated from maintained templates and validated specifications. The model can draft instructions and propose configurations. The model should not freely improvise authentication verification, credential storage, deployment permissions, or tool authorization code.

### Current manifest contract

`ProjectSpec` in `src/types.ts` separates:

- `schemaVersion`, project name, description, language, framework, and guidance location.
- Named `connections`, each with provider kind, optional endpoint/model, timeout, and credential references.
- `roles.builder`, `roles.runtime`, and `roles.judge`, independently referencing connections.
- `agent.systemPrompt`, typed HTTP tools, approval requirements, scopes, and execution limits.
- Evaluation dataset, rubric, and threshold.
- Inbound authentication plus scope and tenant configuration.
- Delivery target, host artifacts, region, and port.

Connection credentials are environment-variable references. The project file must not contain actual keys, bearer tokens, or OAuth client secrets. Secret values also must not enter generated guidance, logs, committed artifacts, or judge prompts.

The current schema deliberately rejects unknown keys. Future changes need an explicit schema version and migration instead of silently ignoring intended security settings.

### Desired adapter boundaries

Provider adapters supply connection validation and generation. CLI builder adapters additionally describe session prerequisites and headless limitations. Framework generators validate supported features and generate actual framework code. Runtime-target adapters plan/package/deploy. Harness and host adapters generate their own instruction and bridge artifacts. Evaluation is a shared concern across generated frameworks.

Later versions should add explicit capabilities, structured compatibility diagnostics, immutable build locks, generation provenance, migration commands, and replayable tool fixtures. Avoid adding a universal graph intermediate representation before multiple real integrations demonstrate which semantics can safely be shared.

## Supported combinations and verification policy

The validator currently enforces this generation matrix. It is a configuration boundary, not a statement that every external dependency has been live-tested.

| Framework | Language | Runtime connection kinds accepted |
| --- | --- | --- |
| Native | Python, TypeScript | API providers, custom gateway, Ollama; supported local CLI transports; offline demo |
| LangGraph | Python, TypeScript | OpenAI, xAI, gateway, Ollama |
| OpenAI Agents | Python, TypeScript | OpenAI, xAI, gateway |
| CrewAI | Python | OpenAI |

Anthropic is currently native-only. CLI runtime connections require the native framework, local target, and no portable HTTP tool definitions. They execute direct headless prompts and are not general model API servers. CLI sessions and offline demo connections use `auth.type: none` in the manifest because no API credential is consumed by those adapters; official CLI login is a separate prerequisite.

The offline demo runtime is local/native only. An offline builder can inspect guidance for a real API runtime on another framework or target; an offline judge makes evaluation a smoke check rather than a model-quality assessment. Demo behavior must never be presented as a live model, a real quality score, or deployment verification. Runtime and judge can share a connection, but the product flags that choice and recommends independent calibration; selecting a different model is not proof of independence or accuracy.

Publish capability status at the granularity of **language × framework × connection × target × operation**:

| Tier | Evidence required | What may be claimed |
| --- | --- | --- |
| Specified | Written contract and configuration validation | Planned/configurable behavior only |
| Generated | Artifacts produced and inspected | Files are generated |
| Statically checked | Syntax/types/configuration checks against generated artifacts | Static checks passed |
| Locally exercised | Meaningful local integration tests, including failures | Tested in the recorded local environment |
| Provider verified | Actual supported client/API account exercised | Live connection verified for that operation |
| Target verified | Deployment, invocation, auth, and cleanup tested on the real target | Target deployment verified for the recorded configuration |

Each record should carry test date, versions, model identifier, target configuration, and known limitations. Offline demonstrations and mocks cannot promote an integration to provider-verified or target-verified.

## Guidance handling

The implemented scanner is read-only. It accepts Markdown, MDX as text, plain text, JSON, and YAML. It does not render MDX, import code, follow embedded instructions, execute scripts, or run files. Hidden files, dependency/build directories, recognizable credential filenames, private-key patterns, common token patterns, symlinks, binary content, and invalid UTF-8 are excluded.

Reads are bounded: 64,000 bytes per file, 256,000 content bytes in total, 100 included files, 2,000 visited directory entries, and depth eight. Included files have deterministic relative paths and SHA-256 hashes. Ordering is stable. Reports name skipped content without revealing the detected secret.

Secret-pattern detection is a best-effort exclusion, not a full data-loss-prevention guarantee. Users still need to review the file inventory before sending guidance to a live builder/provider. Unrecognized credentials and sensitive prose may not match known patterns.

The initial missing-decision analysis recognizes the ten interview sections and common heading aliases. It does not claim semantic understanding of all arbitrary prose. Differing repeated sections produce a possible-conflict warning; explicit matching `ALLOW:` and `DENY:` directives produce a conflict that prevents application. Other unresolved `UNDECIDED`, `TODO`, or `TBD` requirements are reported.

Applying guidance changes the prompt, not runtime permissions. Tool results and retrieved documents are task data and cannot override authorization, approval requirements, or execution limits. The interview writer exclusively creates its guidance file so it cannot silently overwrite manually edited instructions.

## Authentication, authorization, and trust boundaries

Keep five identities separate:

1. The person using the builder CLI or app.
2. The caller invoking the deployed agent.
3. The provider account paying for model requests.
4. The identity authorized to execute each downstream tool action.
5. The human or operator approving an action.

JWT authentication verifies signatures, allowed asymmetric algorithms, issuer, audience, and token lifetime. The configured JWKS source is fixed by configuration; token-controlled URLs must not choose the verifier's key source. Symmetric algorithms and `none` are rejected by project validation. Hosted JWT issuer and JWKS URLs use HTTPS.

Authorization checks scopes and tenant/resource access after authentication. A valid token alone does not grant every tool action. Trusted scope/approval data must originate from verified claims or an explicit local operator environment, never from request-body or model-generated assertions. Binding approvals to an exact tool and argument digest prevents a broad approval from being reused for different actions.

Public hosted targets without inbound authentication produce a visible warning. Scope or tenant policies without an authenticated identity are invalid configuration. Production admission policy may later make authentication mandatory according to the actual deployment model.

A tenant claim is not, by itself, complete tenant isolation. Resource adapters must bind storage queries and downstream actions to the verified tenant. Tests must demonstrate that one tenant cannot retrieve or mutate another tenant's resources. A system prompt cannot enforce that property.

HTTP tool URLs are absolute HTTP(S) URLs without embedded credentials or fragments. Input schemas require an object root. Tool names are unique. Network egress controls, DNS rebinding defenses, metadata endpoint protection, and deployment-specific private-network policy remain separate runtime/platform responsibilities; syntactic URL validation is not an SSRF defense by itself.

For a hosted builder product, generated code/builds need isolated execution, scoped secret injection, project/tenant authorization, bounded subprocesses, and a controlled filesystem workspace. A local prototype is not evidence those hosted boundaries are complete.

## Evaluation model

Evaluation begins with the task, not a generic “agent quality” score.

- Use deterministic checks for response shape, required/excluded content, permitted actions, arguments, escalation rules, and other objective constraints.
- Use a judge rubric only where judgment is necessary. Treat the result as a noisy measurement.
- Calibrate judge labels against human-reviewed examples. Keep disagreements visible and change rubrics deliberately.
- Mark every case `reviewed` or `synthetic` and `development` or `holdout`; never infer human review from generated content.
- Keep holdout cases separate from iterative prompt tuning. Judge-model or rubric changes require recorded evaluation versions.
- Replay frozen tool results for regression comparisons; exercise live integrations separately.
- Evaluate the complete task and trajectory where available, including authorization errors, unsafe action attempts, incorrect tool arguments, retries, and failures.
- Report deterministic outcomes, judge scores, cost/usage, latency, errors, and sample provenance separately.
- Do not treat an empty dataset, skipped judge, unavailable provider, or invalid judge response as a pass.
- Protect the judge from instructions embedded in outputs and examples. The output under assessment must not alter the rubric.

The two seed examples are explicitly synthetic development cases about clarification and undefined business rules. They demonstrate dataset format. They are not task coverage, a reviewed benchmark, a safety assessment, or a launch gate. The default numeric threshold is configuration scaffolding and has no empirical calibration.

Longer-term evaluation work includes versioned datasets, baseline comparisons, paired comparisons with order controls, judge-human agreement, uncertainty/sample-size reporting, trace-level checks, and adversarial cases selected from observed failures.

## Generated artifacts by destination

All outputs should include readable source, example environment-variable references, installation/run instructions, project guidance, evaluation configuration, and a clear verification status.

| Destination | Appropriate artifacts | Boundary |
| --- | --- | --- |
| Local API runner | Python or TypeScript service, provider configuration, auth middleware, tool loop, local instructions | Runs locally; external providers may still receive prompts |
| Docker/container target | Runtime application, image build file, health/configuration guidance | Building an image is not deployment verification |
| AWS AgentCore | Target-compatible application/entry point and deployment guidance/configuration | Real packaging, identity, account, region, and invocation must be verified with AWS |
| Cloud Run / Azure Container Apps | Container artifacts and provider-specific deployment instructions | Cloud credentials, identities, networking, and billing are external prerequisites |
| Codex / Claude Code | Harness-specific guidance and supported tool/configuration artifacts | A development harness is not automatically the hosted production runtime |
| Claude Desktop / ChatGPT | Supported bridge/configuration instructions appropriate to the host | Installing/configuring a connector and supplying required backend access are separate steps |

Artifacts may contain templates or manual prerequisites. The UI must label that state clearly and must not report a service as deployed because a deployment file exists. Chat host bridges must not distribute runtime secrets to end users.

## CLI and web application

The CLI is the automation and power-user interface. The app is a visual workflow around the same core. The minimum shared operations are project creation/loading, interview guidance generation, inspection, validation, generation, preview execution, and evaluation.

The app should expose separate provider selectors for builder/runtime/judge, immediately explain invalid combinations, show unresolved guidance, and present generated files and evidence status. A graph is an optional visualization of a real workflow; it is not required to create a project or a substitute for control-flow semantics.

Provider secrets belong in environment variables or a future secret manager. The app should never put them in URLs, shared exported manifests, logs, generated instructions, or browser storage as a default persistence mechanism.

## Delivery plan

### Local foundation

Implement the manifest, shared validator, guidance inventory, deterministic interview, explicit missing decisions, separate role connections, actual framework generators, local execution, evaluated outputs, owned source export, and a basic app using the same functions. Exercise error paths and unsafe configuration, not only happy paths.

### Verified integrations

Install and exercise generated projects for each advertised language/framework combination. Verify live providers and official CLI integrations with credentials supplied through their supported mechanisms. Verify one cloud target end to end before adding a broad “deploy anywhere” promise. Add compatibility evidence and target-specific failure explanations.

### Design partners and product polish

Work with three target teams on a repeatable workflow. Observe setup time, task success against reviewed cases, time spent diagnosing failures, and whether they keep running the generated project. Ask for payment for a concrete successful setup or hosted workspace rather than measuring interest in an abstract agent platform.

### Hosted collaboration

Add project accounts, tenant isolation, execution sandboxes, encrypted credential storage, deployment identities, versioned runs, approval inboxes, human feedback, audit trails, and reproducible release promotion. Introduce billing only with observable usage and clearly defined entitlements.

### Broader ecosystem

Expand frameworks, models, integrations, targets, and channels based on real demand. Add graph inspection/editing only when its semantics map correctly to generated framework code. Multi-agent collaboration, long-running durable workflows, resumable approval state, and advanced retrieval are separate features with distinct failure modes and evaluation needs.

A four-to-six-week estimate applies only to a narrow local pilot with an experienced developer and aggressive scope cuts. It does not cover the entire provider/framework/target matrix, security review, enterprise identity, a production deployment platform, or the full roadmap.

## Success measures and non-goals

Measure time from intent to the first reproducible run, percentage of real reviewed cases completed, number of unresolved requirements caught before deployment, regression diagnosis time, source export success, and continued use by paying pilot teams. Track setup failures by integration combination.

Early non-goals: inventing another agent framework; a universal arbitrary graph editor; guaranteeing output correctness with an LLM judge; representing every subscription as an API; and claiming production certification from generated scaffolding. The distinguishing product is an understandable, owned project with honest evidence about what works and what remains unverified.
