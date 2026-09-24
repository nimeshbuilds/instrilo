# Recorded runs, approvals and replay

Instrilo can record and resume local **Native and LangGraph** runs in **Python and TypeScript**. It persists the model/tool interaction history, pauses before an approval-required tool, and replays completed operations while reconstructing the agent's messages after a restart. This is a bounded event journal around the generated model/tool boundaries; it does not add a hosted workflow service or a general LangGraph checkpoint database.

OpenAI Agents SDK, CrewAI, and subscription CLI providers are explicitly unsupported for this feature. Ordinary execution with those adapters is unchanged. Durable runs currently require macOS, Linux, or WSL.

## Recording is optional

Ordinary `runProject` execution does not retain run content. Starting a recorded run requires `recordContent: true`: prompts, model messages, tool arguments, results and errors are needed to reproduce its behavior. Records live in `<project>/.instrilo/runs/<run-id>.json`, with owner-only file permissions. Treat that directory as sensitive local application data and exclude it from version control and public artifacts.

The journal records model messages and normalized responses, and tool names, arguments and results. It never records provider request headers or OAuth exchanges. Known environment-secret values, recognizable token patterns, and sensitive object keys are scrubbed. This is not a detector for every private business fact. When scrubbing changes required content, the run becomes inspect-only rather than silently resuming with altered evidence. Errors are retained after scrubbing.

## Approval and resume

The local OS user is the authorization boundary. Caller and tenant values are labels supplied by that trusted local operator; they are not remote authentication credentials. An app must not expose these functions to untrusted remote callers and treat a caller string as authenticated identity.

For an approval-required operation, the coordinator persists a pending event and returns `paused` **before any tool HTTP request**. Its approval digest binds the run ID, current build, event position, exact arguments, caller, tenant, and scope set. A review decision must echo that digest. Approval expires after five minutes by default, with an explicit maximum of one hour. The reviewer may approve or deny the particular pending call.

Resume verifies the current manifest, guidance, local source inventory and available dependency lockfiles against the recorded build. The inventory includes custom files outside the generator baseline, including `dist/` helpers. Installed dependencies, caches and private state (`node_modules`, `.venv`, `__pycache__`, `.git`, `.instrilo`, and `.env*`) are excluded; their contents are not individually fingerprinted. It verifies caller, tenant and scopes too. It reconstructs prior messages by supplying the saved model/tool responses; completed calls are not dispatched again. The next approved call atomically transitions from approved to claimed under the exclusive run lock before dispatch. Expired, denied, previously consumed and changed approvals are rejected. An expired approval cannot be renewed in place; start a fresh run and review the new request.

Two concurrent reviewers or resume processes cannot claim the same operation. State writes use an atomic file replacement and filesystem synchronization. Pausing releases the lock, so a later CLI/app process can continue. A coordinator crash may leave a lock: the explicit recovery operation only removes it after confirming its recorded PID no longer exists. A live PID is never displaced. If a PID has been reused or the lock is malformed, inspect it manually rather than forcing an automatic takeover.

## Ambiguous side effects

The journal marks an operation started before dispatch. If a tool request fails, the process is interrupted, or a result is lost, the external effect may already have happened. The run becomes `needs_reconciliation`; resume never automatically retries that tool.

The operator must inspect the destination and supply its verified result plus an explanation through `reconcileRun`. That recorded result becomes the completed operation, and the rest of the run can continue without sending the tool request again. This action asserts an externally observed result; Instrilo cannot verify that assertion by itself. If the outcome cannot be established, leave the run unresolved. Downstream idempotency and transactional APIs are still valuable; this journal does not promise exactly-once external effects.

## Replay and inspection are different

`replayRun` executes the current, trusted generated entrypoint again, but returns saved results at every model/tool boundary. It requires the same build fingerprint, rejects a missing/mismatched/incomplete fixture, and has no live fallback. The generated HTTP transport additionally refuses network dispatch in replay mode. A successful replay reports zero live model calls, zero live tool calls, and whether its final output matches the recording. Recorded provider usage describes the original run, not replay billing.

Replay is for these generated adapters and trusted local source. It is not an OS sandbox for arbitrary code somebody inserts outside those boundaries. Changing source or dependency locks invalidates the fingerprint. Run bundles do not contain executable source, and importing one never launches code or installs it into the executable local-run store.

`runGraph` produces JSON nodes/edges and Mermaid from the actual ordered model/tool events, including pending, failed and ambiguous operations. The view describes the path that ran; it is not an editable planned workflow, nor a proof of task correctness.

## Portable bundles

`exportRunBundle` defaults to omitting prompts, arguments, responses and final output. Pass `includeContent: true` only when sharing that content is intended. Exports are schema-versioned JSON, bounded to 16 MiB and scrubbed again. `importRunBundle` validates the schema, event ordering and size and returns an inspect-only view and graph. It does not follow paths, install dependencies, register an executable run, or execute embedded instructions. Exported approvals are historical data and cannot authorize a new run.

`replayRunBundle` is a separate, explicit operation. It executes an existing trusted local project against recorded responses, never code imported from the bundle. It requires `executeLocal: true`, complete unredacted recorded content, completed or failed operations, and matching local source/configuration/dependency-lock fingerprints. A missing or mismatched fixture fails without making a replacement live call. The local run store is not populated with the imported recording. Inspection remains the default use of a shared bundle.

```sh
# Default export omits content and supports inspection only.
instrilo runs export RUN_ID ./my-agent --output metadata.json
instrilo runs inspect-bundle metadata.json

# Review the recorded content before sharing a replayable bundle.
instrilo runs export RUN_ID ./my-agent --include-content --output replay.json
instrilo runs inspect-bundle replay.json

# At the receiving machine, first obtain and trust the matching project separately.
# Its dependencies must already be installed. No code is installed from replay.json.
instrilo runs replay-bundle replay.json ./matching-agent --execute-local
```

Build mismatches, metadata-only bundles, redacted content and absent execution consent are rejected. The CLI exits with a nonzero status when replay fails or does not reproduce the recorded result. Matching fingerprints establish consistency with the selected local files; they do not certify the bundle author, installed dependency contents, or environment. Replay remains subject to the trusted-code boundary described above.

## Core API

All directory arguments below refer to a generated project directory. The store is placed under its parent project's `.instrilo/runs`.

```ts
const run = await startRecordedRun(spec, generatedDir, input, {
  recordContent: true,
  // Optional trusted local identity labels and scopes:
  caller: 'local:operator', tenant: 'customer-a', scopes: ['records:write'],
});

const pending = run.events.find(event => event.status === 'pending');
await approveRun(generatedDir, run.id, {
  expectedDigest: pending!.approvalDigest!, expiresInMs: 300_000,
});
const resumed = await resumeRecordedRun(spec, generatedDir, run.id, {
  caller: run.caller, tenant: run.tenant, scopes: run.scopes,
});
const replay = await replayRun(spec, generatedDir, run.id, {
  caller: run.caller, tenant: run.tenant, scopes: run.scopes,
});

const portable = await exportRunBundle(generatedDir, run.id, { includeContent: true });
const inspected = importRunBundle(portable); // executable: false; no code runs
const portableReplay = await replayRunBundle(spec, matchingGeneratedDir, portable, {
  executeLocal: true, // executes this already-trusted matching local project
});
```

Other exported operations are `listRuns`, `getRun`, `denyRun`, `reconcileRun`, `recoverRunLock`, and `runGraph`. `reconcileRun` requires the exact event digest, a result and an operator note. These functions are local library operations; a hosted reviewer-identity service is outside this implementation.

## Verification

```sh
# TypeScript native/LangGraph and journal safety tests:
npx tsx --test tests/runs.test.ts

# Also exercise actual Python native/LangGraph runtimes:
NB_AGENT_PYTHON=/absolute/path/to/python3 npx tsx --test tests/runs.test.ts
```

The tests install generated dependencies into temporary projects and use a local mock provider/tool server. Both languages/frameworks exercise a model call, completed read, approval pause, concurrent approval/resume, write and final model response. The server is then shut down before replay. A portable TypeScript fixture independently builds a second matching local project and verifies both API and CLI replay without copying run history. It checks explicit execution consent, omitted/redacted content, incomplete/missing events and changed custom files, including an imported `dist/` helper. Other fixtures verify denial, expiry, changed identity/build/arguments, error-event replay, bounded inspect-only import, serialized dead-lock recovery and ambiguous-write reconciliation without repeating the write. No paid model, cloud deployment, or remote reviewer account is used.
