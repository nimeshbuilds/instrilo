# Requirements, release evidence, and human review

Instrilo can connect a reviewed product requirement to reviewed evaluation cases, retain the exact evaluated outputs, and produce a machine-readable release decision. Human labels bind to those outputs and the judge configuration. The same records work for generated Python and TypeScript agents.

These are local project workflows. A passing gate establishes that the recorded evidence satisfies the selected policy; it does not establish general agent reliability, authenticate reviewer identities, or deploy the agent.

## Requirements and cases

A requirement has a stable ID, text, an inspected guidance source path and SHA-256 digest, and an explicit review state. Creating a requirement without a reviewer and reason leaves it `proposed`. The builder cannot turn a proposed requirement into reviewed coverage automatically.

This example assumes you have written and reviewed a billing-escalation requirement in `support-agent/guidance/purpose.md`. Replace the example input and assertions with representative cases from your product. Mark a case `reviewed` only after a person has actually reviewed it.

```sh
instrilo requirements add ./support-agent --data '{"id":"REQ-BILLING","title":"Escalate billing disputes","text":"A billing dispute must be escalated to a human.","sourcePath":"purpose.md","reviewer":"Nimesh","reason":"Reviewed against the product policy."}'

instrilo cases add ./support-agent --data '{"id":"billing-escalation","input":"I dispute this charge.","expected":"Escalate the billing dispute to a human without approving a refund.","contains":["human"],"excludes":["refund approved"],"source":"reviewed","split":"holdout"}'

instrilo requirements link REQ-BILLING ./support-agent \
  --case billing-escalation --kind deterministic \
  --reviewer Nimesh --reason "Checks the escalation response and forbidden refund claim."

instrilo requirements status ./support-agent
```

Substring checks are a limited assertion, not proof that an escalation occurred. Use additional reviewed cases, tools, and human inspection appropriate to the behavior you promise.

Links are one of `deterministic`, `judge`, or `human`. Every link records the case-content and requirement-revision hashes, its reviewer, reason, and date. Synthetic examples cannot be linked as reviewed evidence. A deterministic link requires at least one declared `contains`, `excludes`, or `requireJson` assertion.

| Status | Meaning |
| --- | --- |
| `proposed` | The requirement needs a named human review and reason. |
| `stale-source` | Its source file changed or disappeared. |
| `uncovered` | No current evidence link covers the reviewed requirement. |
| `stale-link` | A case or requirement changed; at least one retained link needs review. |
| `ready` | Current reviewed links exist. The release gate still needs a matching passing report. |
| `waived` | A current, unexpired waiver exists. Policy must separately permit it. |

Source tracking is conservative: changing any part of the referenced guidance file requires re-review. To accept revised guidance, update the requirement with a reviewer and reason, inspect the changed cases, then link them again. Earlier requirement revisions remain in the local history.

```sh
instrilo requirements update REQ-BILLING ./support-agent --expected-revision 1 \
  --data '{"reviewer":"Nimesh","reason":"Reviewed the revised guidance and confirmed this requirement."}'

instrilo requirements link REQ-BILLING ./support-agent \
  --case billing-escalation --kind deterministic \
  --reviewer Nimesh --reason "Rechecked coverage against the updated requirement."
```

Remove obsolete links explicitly with `requirements unlink`, specifying the case, reviewer, and reason. An optional `--kind` removes only that link kind. The removal and prior requirement snapshot are retained in the same atomic state update; removing an obsolete link does not reapprove other links.

Requirement imports accept an array, or `{ "schemaVersion": "1", "requirements": [...] }`, using the same fields as `requirements add`. Imports reject duplicate IDs atomically. Updates reject stale `--expected-revision` values.

## Evaluate and apply a release policy

Configure actual runtime and judge connections before attempting a release evaluation. Demo mode is useful for plumbing checks and is blocked by the default release policy. Build and prepare the project, then evaluate a reserved holdout dataset:

```sh
instrilo build ./support-agent
instrilo prepare ./support-agent
instrilo eval ./support-agent --split holdout --output ./support-agent/reports/release-candidate.json
instrilo evidence register ./support-agent --file ./support-agent/reports/release-candidate.json
instrilo release ./support-agent --report reports/release-candidate.json
```

Registration is idempotent for identical content. An existing report ID cannot be replaced with different contents. Report paths passed to `release` and review commands must stay inside the project and cannot traverse symlinks. A registered report ID can be used instead of a path. Inspect evaluation output to obtain that ID.

`release` exits **0** when the selected policy permits the recorded evidence and **2** when the gate is blocked. Invalid input or a storage failure is an ordinary command error. It saves a versioned JSON decision under `.instrilo/evidence/releases/` and can additionally write a new file with `--output`. It never deploys.

The default policy is:

```json
{
  "schemaVersion": "1",
  "allowDemo": false,
  "allowSynthetic": false,
  "allowWaived": false,
  "requireHoldout": true,
  "requireAllCasesPass": true,
  "requireDeterministic": true,
  "requireHumanReview": false,
  "minHumanReviews": 1
}
```

Use `instrilo policy template` to obtain the schema, `policy apply PROJECT --file policy.json` to save a project policy, and `policy show PROJECT` to inspect it. `release --policy policy.json` supplies a policy for that invocation. `schemaVersion` is mandatory; unknown properties, string-valued booleans, and invalid quorum counts are rejected. Omitted properties use the strict defaults above.

The gate checks:

- At least one requirement exists; each is reviewed, current, and covered, or explicitly waived under an allowing policy.
- The report matches the current manifest, selected dataset and case contents, complete inspected guidance inventory, and judge/rubric/threshold configuration. Old reports lacking these fingerprints cannot pass.
- Report provenance and demo/live mode agree with the actual current configuration and dataset. Changing just the report's mode or summary count cannot turn a demo or synthetic report into accepted evidence.
- Every linked case occurs in the selected report and passes. `contains`, `excludes`, and JSON validity are recomputed from its recorded output; a claimed passing check cannot replace the assertion. Live results also need a successful judge score at the current threshold and no execution failure.
- Each requirement has a deterministic link when policy requires one. Judge-only or human-only links cannot satisfy that policy.
- Human failures or unresolved disagreements on linked cases block release. A `human` link or `requireHumanReview` policy additionally needs the configured number of agreeing substantive human passes.
- Project fingerprints and requirement/review revisions remain unchanged while the gate runs. Evidence writers are serialized during the final check and save.

Weakening a policy is an explicit project-owner decision. Allowed demo reports retain the classification `smoke-only`; they never become model-quality evidence. Allowing synthetic report cases does not permit synthetic requirement links. Waivers need a reviewer and reason, can expire, and become invalid when their requirement changes. Exceptions and the exact policy hash appear in the release decision.

Each decision includes `allowed`, `classification`, requirement and case outcomes, structured issues, exceptions, report hash, policy hash, project snapshot, requirement revision, and review revision. A release decision describes that snapshot; later changes require another evaluation or gate as indicated by freshness checks.

## Blind review and immutable labels

Start with a blind queue:

```sh
instrilo review queue ./support-agent --report reports/release-candidate.json --output review-queue.json
```

The queue shows the input, exact output, reference if captured, provenance, and opaque binding hashes. It omits the automated verdict, judge rationale, check outcomes, and prior human verdicts. `--unblind` includes those fields. This is a presentation boundary for independent assessment, not protection against an operator who can open the report file.

Review a case and append a label, preferably copying the queue's `binding` object into the label document. Supplying it detects an accidental mismatch with the output on the reviewer's screen.

```json
{
  "reportId": "ID_FROM_REPORT",
  "caseId": "billing-escalation",
  "verdict": "pass",
  "reviewer": "Nimesh",
  "reason": "The response escalates the dispute without approving a refund."
}
```

```sh
instrilo review label ./support-agent --file label.json
instrilo review assessments ./support-agent --report ID_FROM_REPORT
instrilo review export ./support-agent --output labels.json
instrilo review import ./support-agent --file labels.json
instrilo review calibrate ./support-agent --report ID_FROM_REPORT
```

Verdicts are `pass`, `fail`, and `abstain`. Every label records a generated ID, timestamp, reason, reviewer, and exact report/case/output/judge binding. The same normalized reviewer cannot count twice for one binding. To correct a label, append a new label with `supersedes` set to that reviewer's current label ID. Original labels remain in the export. A reviewer cannot replace another reviewer's label.

Imported labels require matching registered report snapshots and valid checksums. Importing the same labels is idempotent; reusing a label ID with changed content fails. Transfer the matching evaluation report and project evidence as appropriate before importing labels into another workspace. Imports contain label history, not the underlying report outputs.

Two opposing substantive reviews remain an unresolved disagreement. Instrilo does not resolve them by majority vote. Reviewers can re-examine the case and append corrections, or leave it blocked. Abstentions do not count toward the pass quorum. Changed cases, outputs, or judge configuration cannot silently reuse labels from another binding; historical labels remain inspectable.

## Interpret calibration carefully

Calibration reports include sample count, agreement rate, agreed passes/fails, **false passes** (judge passes; humans fail), and **false fails** (judge fails; humans pass). They also show unresolved disagreements, unreviewed cases, abstentions, and human consensus cases lacking a usable judge decision.

Only a recorded live judge decision and an unambiguous substantive human verdict contribute to agreement. Demo outputs, scoring/execution failures, missing judgments, abstentions, and disagreements cannot become successful calibration samples. The historical `Judge rubric` check supplies the old judge's decision; a changed threshold does not rewrite yesterday's labels. Freshness is reported separately, and stale calibration cannot qualify current release evidence.

These are descriptive counts for the labeled sample. They are not confidence intervals, estimates of production reliability, proof of reviewer independence, or automated rubric optimization. Pairwise order-effect testing, calibrated probability claims, externally authenticated reviewers, and hosted review assignments are outside this version.

## Storage, hashes, and operating limits

The v1 `agent-studio.yaml` manifest remains compatible. Evidence uses versioned project sidecars:

```text
.instrilo/evidence/
  requirements.json
  release-policy.json
  reviews.json
  reports/<hashed-report-id>.json
  releases/<decision-id>.json
  write.lock                         # present only during a write
```

Documents have a canonical SHA-256 checksum envelope. Reads and writes are bounded to 16 MB per document, reject symlinks through the project path checks, require regular files, and use `O_NOFOLLOW`. Writes use an exclusive temporary file, sync, and atomic rename. State updates use an exclusive writer lock. A crashed writer's lock is not stolen automatically: confirm no writer is active before removing it and retrying.

Current schema limits include 1,000 requirements, 1,000 links per requirement, 10,000 saved requirement revisions/removals, 5,000 results per report, and 20,000 human labels per project. Imports validate their entire contents before committing. These are bounded local files, not a distributed multi-tenant review database.

Manifest, parsed case, selected-dataset, and judge fingerprints use SHA-256 of their serialized JSON representation. Guidance hashes use the sorted list of `{path, sha256}` entries from the bounded inspector. Report, output-binding, policy, and storage checksums use canonical JSON with sorted object keys. Evaluation captures its editable inputs before and after the run and rejects changes. All inspected guidance files contribute to evaluation freshness, including files not referenced by an individual requirement.

An owner with write access can rewrite a report, impersonate a reviewer, or recompute checksums. The checks detect stale and accidentally altered records; they are **not cryptographic attestation, immutable remote audit storage, or identity verification**. Network filesystems and hostile concurrent filesystem mutation are outside the local single-owner trust model. Model identifiers can be mutable aliases, so hashes do not freeze a provider's remote model implementation. Requirement coverage remains a human assertion about test meaning.

Reports and labels can contain sensitive user inputs, outputs, references, and review notes. They remain local files. Inspect what you export or commit.

## Core API for integrations

All functions accept a project directory. The CLI and local application can call these same operations; validation and persistence belong in the core modules.

| Module | Export and input |
| --- | --- |
| `src/evidence.ts` | `addRequirement(projectDir, {id, title?, text, sourcePath, reviewer?, reason?})` |
| | `importRequirements(projectDir, inputsOrVersionedDocument)`; `listRequirements(projectDir)` |
| | `updateRequirement(projectDir, id, partialInput, {expectedRevision?})` |
| | `linkRequirement(projectDir, id, {caseId, kind, reviewer, reason})` |
| | `unlinkRequirement(projectDir, id, {caseId, kind?, reviewer, reason})` |
| | `waiveRequirement(projectDir, id, {reviewer, reason, expiresAt?})`; `evidenceStatus(projectDir)` |
| | `registerEvidenceReport(projectDir, report)`; `loadRegisteredReport(projectDir, idOrPath)` |
| | `captureEvidenceSnapshot(projectDir)`; `reportFreshness(projectDir, registeredReport)` |
| | `parseReleasePolicy(input?)`; `importReleasePolicy(projectDir, input)`; `loadReleasePolicy(projectDir)` |
| | `releaseEvidence(projectDir, idOrPath, optionalPolicy)` returns and saves the decision |
| `src/review.ts` | `reviewQueue(projectDir, idOrPath, {blind?: boolean})` defaults to blind |
| | `addReview(projectDir, {reportId, caseId, verdict, reviewer, reason, binding?, supersedes?})` |
| | `importReviews(projectDir, {schemaVersion:'1', labels})`; `exportReviews(projectDir)` |
| | `reviewAssessments(projectDir, idOrPath)`; `calibrationReport(projectDir, idOrPath)` |

`RequirementInput`, `Requirement`, `RequirementLink`, `EvidenceSnapshot`, `RegisteredReport`, `ReleasePolicy`, `ReviewBinding`, and `ReviewLabel` are exported TypeScript types. Runtime schemas validate imported data rather than trusting TypeScript declarations.

## Verification

Run `npx tsx --test tests/evidence.test.ts tests/review.test.ts tests/cli-evidence.test.ts`. The 17 core tests use real temporary project files and explicitly constructed evaluation fixtures. They cover source/case staleness, missing coverage, synthetic/demo/waiver policies, independently recomputed output checks, human quorum and disagreement, immutable report IDs and labels, corrections, import idempotency, hashes, path and symlink rejection, blind presentation, and calibration counts. Three additional integration tests invoke actual CLI subprocesses for project/case creation, report registration, requirements and stale links, review/correction/export/import, policy gates and exit codes, and nested help/required flags. They make no model or cloud calls and do not establish the quality of any live judge.
