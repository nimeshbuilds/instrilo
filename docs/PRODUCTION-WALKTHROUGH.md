# From product guidance to an agent and cloud artifacts

Follow [the complete executable walkthrough](https://nimeshbuilds.github.io/instrilo/quickstarts/deployment-artifacts/) or read it in the terminal:

```sh
instrilo tutorials setup ./instrilo-tutorials
cd instrilo-tutorials
instrilo tutorials show deployment-artifacts
```

The installed CLI performs every agent action. The few `node examples/...` commands run the bundled deterministic test service and inspect its outputs; they do not replace the CLI or require a source checkout.

The walkthrough creates a support agent from ten product-guidance answers, adds an architecture document, configures independent builder/runtime/judge connections, generates an actual TypeScript LangGraph StateGraph, runs a read-only policy tool, exports the observed graph, evaluates with a separate judge, verifies the strict release gate, and creates three platform-specific source ZIPs. Python generation is also supported; this particular guide executes and verifies TypeScript.

## What you get

| Output in the tutorial workspace | Purpose |
| --- | --- |
| `.studio/tutorials/support-agent/guidance/` | Product guidance and architecture diagram |
| `.studio/tutorials/support-agent/generated/` | Executable LangGraph model/tool nodes, HTTP/MCP entrypoints, tests and locked dependencies |
| `.studio/tutorials/support-agent/run-graph.mmd` and `run-graph.json` | Graph of the actual recorded model → policy tool → model execution |
| `.studio/tutorials/support-agent/reports/` | Synthetic development and holdout wiring results with the separate fixture judge |
| `.studio/tutorials/support-agent/release-decision.json` | Correctly blocked decision; fixtures are not production evidence |
| `.studio/cloud/support-aws-agentcore/` | AgentCore project, ARM64 Dockerfile, runtime/IAM configuration and runbook |
| `.studio/cloud/support-cloud-run/` | Cloud Run project, AMD64 Dockerfile, secret references and runbook |
| `.studio/cloud/support-azure-container-apps/` | Azure project, AMD64 Dockerfile, managed-identity configuration and runbook |
| `deployment-bundle.zip` in each cloud project | Portable source/manifest/guidance/cases; not a built container image or deployed service |

The judge runs in the evaluation workflow, not automatically on every production request. LangGraph defines executable model and tool nodes; `runs graph` separately shows observed execution. The generated graph does not configure a distributed checkpoint backend. Local run records remain local operator-owned files.

## Move one target from the tutorial to a real candidate

The automatic steps use synthetic cases, deterministic models, no real credentials, and `.invalid` cloud placeholders. They deliberately leave the production evidence gate blocked. These next steps need your product decisions, real providers and human reviewers; they are not covered by the automatic walkthrough result.

1. Choose **one** cloud project and assign its operating owner. Resolve actual policy, escalation behavior, permitted data and failure behavior in guidance. Edit the original guidance rather than generated copies. Keep holdout answers outside builder guidance.
2. Configure real builder/runtime/judge connections separately. Use provider/API models or a gateway you can access; desktop subscription sessions cannot be moved into cloud containers. Select an independent judge and calibrate it against human review. Replace the policy endpoint and its authorization with your real read-only service.
3. Configure your real JWT issuer, JWKS, audience and allowed signing algorithm. Issue caller tokens with `agent:invoke`. Test rejected signatures, wrong audiences, missing scope, expired tokens and authorized calls. Tool authorization is a separate service responsibility; a scope claim alone does not provide data isolation.
4. Write and human-review development cases and separate holdout cases for every requirement. Include tool failure, missing/contradictory policy, injection attempts, boundary requests, latency and output limits. Mark `source: reviewed` only after an actual review; do not relabel the bundled synthetic cases to obtain a pass.
5. Review each requirement and its source, then create explicit requirement-to-case links. Configure the exact models, rubric and threshold before generating final evidence. A different model ID alone does not make the judge trustworthy.
6. Rebuild and lock/install dependencies. Run development evaluation, inspect failures, obtain blind human labels and inspect calibration. Complete that iteration before the final holdout. If you change guidance, configuration, cases or judge settings afterward, regenerate evidence; stale reports are rejected.

Use the CLI to inspect the required input formats before creating your real documents:

```sh
instrilo connections example gateway
instrilo tools example
instrilo cases example
instrilo requirements example
instrilo review example
```

For example, select the target and import your reviewed connection/tool documents. These files must contain your actual endpoint/model choices and **environment-variable names**, never credentials:

```sh
INSTRILO_CLOUD_PROJECT=.studio/cloud/support-aws-agentcore
instrilo connections add planning "$INSTRILO_CLOUD_PROJECT" --file ./my-builder.json --replace
instrilo connections add answering "$INSTRILO_CLOUD_PROJECT" --file ./my-runtime.json --replace
instrilo connections add scoring "$INSTRILO_CLOUD_PROJECT" --file ./my-judge.json --replace
instrilo tools add "$INSTRILO_CLOUD_PROJECT" --file ./my-policy-tool.json --replace
instrilo config set security.inbound '{"mode":"jwt","issuer":"https://YOUR_IDENTITY_ISSUER/","audience":"YOUR_AGENT_AUDIENCE","jwksUrl":"https://YOUR_IDENTITY_ISSUER/.well-known/jwks.json","algorithms":["RS256"]}' "$INSTRILO_CLOUD_PROJECT" --json
instrilo cases import "$INSTRILO_CLOUD_PROJECT" --file ./my-reviewed-cases.jsonl --replace
instrilo connections check "$INSTRILO_CLOUD_PROJECT"
instrilo validate "$INSTRILO_CLOUD_PROJECT"
```

Replace the uppercase identity placeholders before executing that configuration command. `connections check` checks references/client availability without making a model call; successful live execution/evaluation is a separate check. Supply local model/tool credentials privately in the named environment variables. Configure cloud secrets using the selected runbook; never bake them into an image.

A connection document has this form. Replace the `.invalid` URL and model ID with actual values. A bearer value may be a JWT if your gateway validates it and enforces its permissions; Instrilo does not grant gateway access itself. Use `instrilo explain gateways` for OAuth client-credentials alternatives.

```json
{
  "kind": "gateway",
  "model": "YOUR_RUNTIME_MODEL",
  "baseUrl": "https://your-gateway.example.invalid/v1",
  "auth": {"type": "bearer-env", "env": "RUNTIME_GATEWAY_TOKEN"}
}
```

## Bind real evidence to requirements

Both initial requirements are proposed. After a person reviews the source and behavior, prepare a requirement patch such as `reviewed-return-requirement.json` containing that person's actual identity label and reason:

```json
{
  "reviewer": "ACTUAL_REVIEWER_NAME",
  "reason": "ACTUAL_REASON_AFTER_REVIEWING_THE_POLICY_AND_REQUIREMENT"
}
```

Prepare a separate patch for the refund boundary. Replace the names/reasons before importing; these are audit labels owned by the local operator, not verified external identities. The following example assumes your reviewed holdout dataset contains `return-window-holdout` and `refund-handoff-holdout`, each with appropriate deterministic `contains`/`excludes`/JSON checks:

```sh
instrilo requirements update return-policy "$INSTRILO_CLOUD_PROJECT" --expected-revision 1 --file ./reviewed-return-requirement.json
instrilo requirements update refund-handoff "$INSTRILO_CLOUD_PROJECT" --expected-revision 1 --file ./reviewed-refund-requirement.json
# Set these to the actual reviewer's name and actual coverage-review reasons first.
instrilo requirements link return-policy "$INSTRILO_CLOUD_PROJECT" --case return-window-holdout --kind deterministic --reviewer "$INSTRILO_REVIEWER" --reason "$INSTRILO_RETURN_COVERAGE_REASON"
instrilo requirements link refund-handoff "$INSTRILO_CLOUD_PROJECT" --case refund-handoff-holdout --kind deterministic --reviewer "$INSTRILO_REVIEWER" --reason "$INSTRILO_REFUND_COVERAGE_REASON"
instrilo requirements status "$INSTRILO_CLOUD_PROJECT"
instrilo build "$INSTRILO_CLOUD_PROJECT" --overwrite
instrilo deps lock "$INSTRILO_CLOUD_PROJECT"
instrilo deps install "$INSTRILO_CLOUD_PROJECT"
instrilo eval "$INSTRILO_CLOUD_PROJECT" --split development --output "$INSTRILO_CLOUD_PROJECT/reports/production-development.json"
```

Use the review workflow on development results to calibrate the judge before final holdout. Record actual reviews, inspect disagreement and false-pass behavior, and improve the cases/rubric as necessary. One or two example cases are not enough to establish reliability for a real product. The CLI's `review calibrate` reports the available sample size; it cannot supply missing human judgment.

When the candidate is fixed, run holdout and collect blind review:

```sh
instrilo eval "$INSTRILO_CLOUD_PROJECT" --split holdout --output "$INSTRILO_CLOUD_PROJECT/reports/production-holdout.json"
instrilo review queue "$INSTRILO_CLOUD_PROJECT" --report reports/production-holdout.json --output "$INSTRILO_CLOUD_PROJECT/production-review.json"
```

A reviewer inspects the queue's exact input/output and binding. Prepare one label per reviewed case, using the queue's actual report ID, case ID and binding. `verdict` may be `pass`, `fail` or `abstain`; never default everything to pass. Use `instrilo review example` and `instrilo explain review` for the label format. For each actual label:

```sh
instrilo review label "$INSTRILO_CLOUD_PROJECT" --file ./actual-review-label.json
```

Then inspect calibration, coverage and the gate:

```sh
instrilo review assessments "$INSTRILO_CLOUD_PROJECT" --report reports/production-holdout.json
instrilo review calibrate "$INSTRILO_CLOUD_PROJECT" --report reports/production-holdout.json
instrilo requirements status "$INSTRILO_CLOUD_PROJECT"
instrilo release "$INSTRILO_CLOUD_PROJECT" --report reports/production-holdout.json --output "$INSTRILO_CLOUD_PROJECT/production-release.json"
```

Exit `0` means the configured evidence policy allowed this candidate. Exit `2` means the policy blocked it; inspect the reasons. Exit `1` is an execution/validation failure. Passing the policy neither deploys resources nor certifies production safety. Preserve the policy's prohibition on synthetic/demo evidence and its human-review requirement.

## Test the container, then follow its platform runbook

The generated runbooks specify dependencies, identities, secrets, registry setup, build/push, invocation, troubleshooting and exact-resource cleanup. The container test command can build and run a local container with mocked prerequisites, retaining JSON/Markdown evidence. It cannot verify your real cloud IAM, issuer policy, network, model entitlement or application quality.

```sh
instrilo deployment guide "$INSTRILO_CLOUD_PROJECT"
instrilo deployment engine status docker
instrilo deployment test "$INSTRILO_CLOUD_PROJECT" --engine docker
# After reviewing the plan and satisfying the engine/architecture prerequisites:
instrilo deployment test "$INSTRILO_CLOUD_PROJECT" --engine docker --execute
instrilo deployment reports "$INSTRILO_CLOUD_PROJECT"
```

Architecture constraints come from the platform contracts: [AgentCore requires ARM64 and port 8080](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html); [Cloud Run requires Linux x86-64 and listening on its injected port](https://docs.cloud.google.com/run/docs/container-contract); [Azure Container Apps requires Linux x86-64 images](https://learn.microsoft.com/en-us/azure/container-apps/containers). Cross-architecture local tests require supported hardware/emulation. The generated cloud scripts choose `linux/arm64` for AgentCore and `linux/amd64` for Cloud Run/Azure.

Complete every selected runbook prerequisite and replace every endpoint, model, identity, account, secret and registry placeholder. For Cloud Run the generated service retains Cloud Run IAM in addition to application JWT; for AgentCore this walkthrough chooses JWT rather than the alternate IAM-only mode. Azure uses the configured managed identity for registry/secret access. Read each generated runbook for the exact invocation flow.

Before serving real users, assign ownership for monitoring/alerts, budgets and rate/concurrency limits, data retention, real dependency failures, rollout and rollback. For durable cloud conversations configure and test a persistent checkpoint/state backend. Add domain-specific authorization at tool services. None of these operating decisions can be inferred from a passing synthetic tutorial.

Once the evidence decision, final container checks, real identity/provider tests and account prerequisites have passed, export the reviewed source bundle and execute the selected deployment:

```sh
instrilo export "$INSTRILO_CLOUD_PROJECT" --output "$INSTRILO_CLOUD_PROJECT/reviewed-deployment.zip"
instrilo deploy "$INSTRILO_CLOUD_PROJECT" --execute
```

Deployment can create billable resources. Follow the generated runbook to verify health **and authenticated invocation**, inspect logs, and confirm real model/tool results. Keep the immutable evaluation/review/release records separately: normal ZIP exports intentionally omit private run/evidence state. Container cleanup acts only on its recorded resources; cloud cleanup follows the runbook. Dependency cleanup is a separate ownership-checked operation and preserves preexisting/shared engines.
