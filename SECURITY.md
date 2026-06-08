# Security Policy

Engram is local-first. A vault is a folder of markdown on your own machine: the engine makes no network calls unless you explicitly configure an embedding provider, and there is no telemetry, account, or hosted service to attack. The most useful place to harden is therefore your own vault and how you wire the MCP server into an agent.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub's [private vulnerability reporting](https://github.com/blakestone-x/engram/security/advisories/new) rather than opening a public issue. Include a description, affected version, and a minimal reproduction if you have one. Expect an initial response within a week.

## Scope

In scope:

- The `@engram/core` engine, the `engram` CLI, and the `@engram/mcp` server.
- The control-panel HTTP API (`@engram/panel`), which binds to loopback (`127.0.0.1`) only and has no auth — issues that let it bind elsewhere or leak vault contents off-host are in scope.
- The privacy redaction pass (`redactPatterns`) failing to scrub a documented secret class on write.

Out of scope:

- Secrets you place in a vault yourself. Treat a vault as plaintext you control; the redaction pass is a safety net for accidental paste-ins, not an encryption boundary.
- Anything that requires already having write access to your `.engram/` directory or `.env`.
- Third-party embedding providers you opt into; data you send for embeddings leaves under your own key and their terms.

## Supported versions

Engram is pre-1.0 and ships fixes against the latest published version only. Run current `main` for security fixes.
