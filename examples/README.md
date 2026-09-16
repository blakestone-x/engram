# Starter vault

Fourteen fictional engineering and operations memories demonstrate retrieval, decay, and consolidation without an API key.

## Run it

First install and build from the repository root:

```bash
npm ci
npm run build
```

Then, still at the repository root:

```bash
node packages/cli/dist/index.js reindex --dir examples/starter-vault
node packages/cli/dist/index.js doctor --dir examples/starter-vault
node packages/cli/dist/index.js status --dir examples/starter-vault
node packages/cli/dist/index.js recall "checkout timeout" --dir examples/starter-vault
node packages/cli/dist/index.js context "checkout timeout" --budget 800 --dir examples/starter-vault
node packages/cli/dist/index.js consolidate --dir examples/starter-vault
node packages/cli/dist/index.js decay --dir examples/starter-vault
node packages/cli/dist/index.js panel --dir examples/starter-vault
```

Open http://127.0.0.1:4319 for the panel; stop it with Ctrl+C. The panel needs the full build, not just `build:lib`.

## What to expect

| Tier | Count | Contents |
|---|---|---|
| working | 3 | Task notes, including an old Redis experiment |
| episodic | 6 | Four related checkout-timeout incidents and two unrelated entries |
| semantic | 3 | Database, API, and error-handling guidance |
| procedural | 2 | Deployment and incident-response procedures |

- `doctor` checks 14 memories and exits 0 when there are no integrity errors.
- `recall` finds the checkout-timeout notes.
- `consolidate` finds at least one eligible cluster.
- `decay` flags the old Redis note. Dates are fixed, so retention percentages and the number of forgettable memories change over time.

Consolidation and decay preview changes unless you pass `--apply`. Reindex writes a derived index; panel actions can modify the vault. Copy `examples/starter-vault` outside the checkout before trying mutations. Consolidate before applying decay if you want the related active episodes to remain eligible.

Run `npm run smoke` after a full build to check the starter vault and the CLI, MCP, and panel paths against temporary copies.
