# Safe regeneration and upgrades

Regeneration compares three versions of each owned file: the previous generated baseline, the current file, and the new generated output. It preserves user-only edits and unrelated files. When both the user and generator change a file, it reports a conflict unless an explicitly requested three-way merge can combine separate line edits safely.

`buildProject(manifest, outputDir, overwrite, options)` keeps its original first three arguments. `overwrite: true` now requests safe regeneration; it does not grant permission to discard conflicting edits. The optional fourth argument accepts `dryRun`, `merge`, and `expectedPlanHash`. `planProject(manifest, outputDir?, options?)` returns the same plan without changing files.

From the CLI, inspect the proposed changes before applying them:

```sh
instrilo generation plan ./my-agent --merge
# Equivalent build preview:
instrilo build ./my-agent --dry-run --merge
# Copy the reviewed planHash into the apply command:
instrilo build ./my-agent --overwrite --merge --expected-plan <planHash>
instrilo generation inspect ./my-agent
```

Omit `--merge` to leave every change made on both sides as a conflict. Use the same merge choice for preview and application.

## Read a plan

A plan contains the destination, previous and proposed generation IDs, generator metadata, a `planHash`, and changes with these actions:

| Action | Meaning |
| --- | --- |
| `add` | A new generated file has no existing collision. |
| `update` | The old generated file is unchanged locally and can be replaced. |
| `merge` | An explicitly enabled three-way merge combined separate line edits. |
| `delete` | An unmodified generated file is no longer produced. |
| `preserve` | Keep a customization, user deletion, changed obsolete file, or unrelated user-owned path. |
| `unchanged` | Current content already matches the desired generated content, or an obsolete file is already absent. |
| `conflict` | Applying the generation would guess about or overwrite an unresolved change. |

Any conflict blocks the entire update before artifact or metadata writes. Dry runs do not create a missing output directory or acquire a write lock. Supplying the reviewed `planHash` as `expectedPlanHash` rejects a stale plan instead of applying it to changed inputs.

Initial generation refuses an existing target file, even if its content happens to match. It does not silently adopt user-owned files. A removed generated file stays removed while the generator's version of that file remains unchanged; a later generator change conflicts with that deletion.

Generated source mirrors require source edits: `agent-spec.json`, `guidance.md`, `guidance-manifest.json`, the exported manifest, `guidance/`, and `evals/` are protected from local changes during regeneration. Edit the project's manifest, guidance, or evaluation dataset and regenerate. Application code and separately created files can carry user customizations.

## Merge and resolve conflicts

Automatic merging is opt-in. The engine performs a line-based three-way comparison against retained content. It accepts separate edits and identical edits made by both sides. Overlapping replacements, competing insertions, ambiguous boundary insertions, binary content, and comparisons beyond the bounded merge size remain conflicts. It never writes conflict markers or asks a model to resolve source code.

A textual merge does not prove the resulting program correct. Review the merged code and run its type checks, contract tests, and relevant evaluations before deployment.

For an overlap, create the next generation in a separate empty output directory and compare it with the current file and retained baseline. Keep a backup of the customization. One supported manual resolution is to accept the reviewed incoming generated file, regenerate to establish its new baseline, then reapply and test the customization. There is no force-clobber option that treats a conflict as approval.

## Retained state and provenance

The generated directory contains:

```text
.instrilo/
  current.json
  baselines/<sha256>.json
  backups/build-lock-v1-<sha256>.json   # when upgrading a legacy build
  write.lock                         # only while a writer owns the update
  transaction.json                  # only while applying or recovering
```

Baseline files store the original generated text, its hash, file mode, and generator metadata. Their filenames are hashes of their complete serialized content. Existing baselines are verified and never overwritten. `current.json` identifies the current baseline and records the applied hashes, which can differ from the generated hashes for preserved or merged customizations. Previous baselines are retained.

Metadata includes the generator package version, source-module hashes, template hashes, and enabled adapter IDs, versions, and pinned code hashes. These identify the code used for generation; they do not bundle a historic compiler, dependency environment, or template execution environment. Third-party generator plugins are explicitly trusted code and must follow their own side-effect restrictions.

The runtime-facing `build-lock.json` remains schema version 1 for compatibility and now records generator/template/adapter fingerprints. Its generated-file hashes describe generator output. The retained sidecar uses schema version 2 and distinguishes that baseline from applied customizations.

Baselines and backups can contain earlier guidance and source. Treat them as private project data. Generated Git and Docker ignore files exclude `.instrilo/`, and the source ZIP export deliberately omits this local history. The ZIP is a source export, not a portable regeneration checkpoint. If exported generated code has custom edits, rebuilding it without its original baseline can produce conflicts; use a deliberate fresh destination and review/reapply those edits. Preserve the trusted `.instrilo/` directory separately when transferring a working generation history. A live transaction journal additionally contains rollback copies of affected files; do not publish it. The metadata is local tamper evidence, not a signature from a remote authority.

## Interrupted updates

Writers acquire an exclusive lock with their process ID, host, and a unique ownership token. Before replacement, a bounded journal records the old and new bytes. Individual files are replaced through temporary files and atomic renames; the runtime build lock is applied last. Cooperating run/deploy/export operations call `assertGenerationReady(directory)` and refuse an active or interrupted update.

`inspectGeneration(directory)` reports the baseline, customizations, pending transaction, lock owner, and dependency-lock status. `recoverGeneration(directory)` rolls back a prepared transaction, or finishes cleanup for an already committed transaction. It checks every affected file first and refuses recovery if a newer user edit matches neither the before nor after state. It does not overwrite that edit or partially start the rollback.

Recovery can remove an abandoned lock only when its recorded process is demonstrably gone on the same host. It refuses a live, remote-host, or malformed lock; inspect the owner before manual intervention. The journal protects against process interruption. It is not a filesystem snapshot, an operating-system sandbox, or a guarantee against a separate privileged process racing filesystem changes.

```sh
instrilo generation inspect ./my-agent  # inspect without applying recovery
instrilo generation recover ./my-agent  # immediately roll back or finalize the pending transaction
```

`withGenerationLock(directory, async directory => { ... })` lets cooperating dependency commands hold the same lock as builds. It rejects a pending generation transaction and releases the lock even if the callback fails. Package-manager changes inside that callback are not covered by the generation rollback journal; repair a failed dependency operation using that package manager.

## Legacy schema migration

`migrateGeneration(directory, { dryRun: true })` previews migration from a legacy version-1 `build-lock.json`. Applying the migration preserves an immutable copy of that file and creates sidecar version 2 without changing the generated source or project manifest. The project manifest's supported schema stays at version 1.

Legacy locks retained hashes but not original text. When a current file still matches its recorded hash, migration can retain that original baseline content. When it has already been edited, migration records that the old text is unavailable; it does not invent a baseline from the edited file. A later change on both sides remains an explicit conflict. Ordinary safe regeneration also retains the legacy baseline and backup when upgrading such a directory.

```sh
instrilo generation migrate ./my-agent          # preview the backup and unavailable original content
instrilo generation migrate ./my-agent --apply  # apply the sidecar migration
```

## Dependency reproducibility is separate

`package-lock.json`, `uv.lock`, virtual environments, and dependency directories are user-owned and are preserved. `dependencyLockStatus(directory)` reports whether a lock exists and fingerprints its bytes. For npm lockfiles with a root package entry, it compares declared dependency ranges against `package.json`. Python lock freshness requires `uv lock --check`; the helper does not infer it from the file's existence.

The CLI exposes explicit dependency operations against the generated directory:

```sh
instrilo deps status ./my-agent
instrilo deps lock ./my-agent
instrilo deps install ./my-agent
```

Lock creation can contact package registries. Installation executes the package manager's frozen-lock workflow. The corresponding direct package-manager operations in the generated directory are:

```sh
# TypeScript: resolve a lock, then install from it.
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts

# Python: resolve, check, and enforce the lock.
uv lock
uv lock --check
uv sync --locked
```

Review and commit the resulting lockfile. Regeneration never performs these network operations automatically. When generated dependency ranges change, an existing npm lock is preserved and reported as stale. A source-generation fingerprint is not a dependency lock, and a lockfile alone does not prove cross-platform or bit-for-bit container reproducibility.

## Verification

`tests/regeneration.test.ts` and `tests/rebuild.test.ts` exercise custom code, unchanged generation, changed source guidance, nonoverlapping merges, explicit conflicts with no writes, foreign-file collisions, user deletions, modified obsolete artifacts, stale plans, exclusive locks shared with dependency mutations, symlink paths, corrupt baselines, legacy backups, interrupted recovery, and dependency-lock preservation. The recovery fixtures simulate interrupted journal states without executing providers or deployment scripts.
