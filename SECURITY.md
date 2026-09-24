# Instrilo security policy

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/nimeshbuilds/instrilo/security/advisories/new). Please do not open a public issue for a suspected credential leak, authorization bypass, or exploitable vulnerability.

Include the affected commit/version, a minimal reproduction using synthetic data, the expected boundary, and the observed impact. Identify the surface involved: the local workbench, a provider adapter, generated code, MCP, or deployment artifacts. Remove tokens, keys, private prompts/results, account identifiers, and local session URLs before sending a report. Do not test against other people's accounts or services.

## Supported code

This project is in early development. Security fixes target the current default branch. Older snapshots and modified generated projects do not have a separate maintenance commitment. After a fix, operators need to review, regenerate or patch, and redeploy their own exported projects as appropriate.

## Boundaries

The workbench is a local development application. Its session URL grants access to local projects and should remain private. Exported agents are separate programs with their own credentials, identity configuration, tool permissions, and deployment exposure.

Generated JWT verification checks configured identity claims and scopes. Tenant-specific data access still belongs to the tool backend. Exact-call approval digests enforce the configured call boundary, but single-use approvals require an application-side replay ledger. Cloud scaffolding does not configure an entire account or prove a deployment secure.

Automated tests use mock providers and local authentication fixtures. Passing tests are evidence for those paths; they do not certify provider policy compliance, a live identity-provider setup, or a production deployment.
