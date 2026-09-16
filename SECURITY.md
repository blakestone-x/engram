# Security Policy

Engram is local-first. A vault is a folder of markdown on your own machine: the engine makes no network calls unless you explicitly configure an embedding provider, and there is no telemetry, account, or hosted service to attack. Treat the vault, local HTTP interface, and MCP clients as one trusted local environment. A loopback listener is not an authentication mechanism.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub's [private vulnerability reporting](https://github.com/blakestone-x/engram/security/advisories/new) rather than opening a public issue. Include a description, affected version, and a minimal reproduction if you have one. Expect an initial response within a week.

## Scope

In scope:

- The `@engram/core` engine, the `engram` CLI, and the `@engram/mcp` server.
- The control-panel HTTP API (implemented in `@engram/core` and consumed by `@engram/panel`). The CLI binds it to `127.0.0.1` and it has no authentication. The library returns an HTTP server whose caller chooses the listening address; do not expose it to an untrusted network.
- The privacy redaction pass (`redactPatterns`) failing to scrub a configured match from a body submitted through `addMemory`.

Out of scope:

- Secrets you place in a vault yourself. Treat a vault as plaintext you control; the redaction pass is a safety net for accidental paste-ins, not an encryption boundary.
- Anything that requires already having write access to your `.engram/` directory or `.env`.
- Third-party embedding providers you opt into; data you send for embeddings leaves under your own key and their terms.

## Trust boundaries

- Vault contents are plaintext. Body redaction uses a limited set of regular expressions. Titles, summaries, other frontmatter, imports, and direct file edits are not comprehensively scrubbed.
- `scope`, `author`, and `visibility` are caller-supplied metadata. Scope filters on recall/context are not authorization; unscoped queries can see all memories and other tool surfaces are vault-wide.
- Retrieved text may contain malicious instructions or incorrect claims. Agents should treat it as untrusted data and retain their own tool policy and approval boundaries.
- Use separate vaults and operating-system permissions for mutually untrusted users or agents. Coordinate concurrent writers and maintenance; multi-file operations are not transactions.

## Supported versions

Engram is pre-1.0 and is not published to npm. Fixes land on `main`; tagged releases are snapshots and older tags are not maintained separately. Review the changelog and CI results when updating.
