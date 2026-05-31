# Contributing to Engram

Thanks for looking at the internals. Engram is a small engine with a deliberately tight dependency budget, and contributions that keep it that way are the easiest to merge.

## Getting set up

```bash
git clone https://github.com/blakestone-x/engram
cd engram
npm install        # installs all workspaces
npm run build      # builds core, cli, and panel
npm test           # runs the @engram/core vitest suite
```

`npm install` at the root installs every workspace (`@engram/core`, `engram`, `@engram/panel`) — there is no separate install step per package.

## Build scripts

Run these from the repo root:

| Script | What it does |
|---|---|
| `npm run build` | Build all three packages (core → cli → panel). |
| `npm run build:lib` | Build just `@engram/core` and the `engram` CLI — what you want when you are not touching the panel. |
| `npm test` | Run the core test suite (`vitest run`). |
| `npm run typecheck` | Type-check core and cli with `tsc -b`. |
| `npm run lint` | Run each workspace's lint (type-check based). |
| `npm run clean` | Remove all `dist/` output and build info. |

After `npm run build:lib` you can drive the CLI from its built output without a global install:

```bash
node packages/cli/dist/index.js init scratch-vault
node packages/cli/dist/index.js --help
```

## Project layout

```
engram/
  package.json            npm workspaces root
  tsconfig.base.json
  SPEC.md                 internal build contract — read this before changing engine behavior
  docs/                   public docs (MEMORY-MODEL, HISTORY, ARCHITECTURE)
  examples/
    starter-vault/        a runnable sample vault
  packages/
    core/   @engram/core  the engine (see docs/ARCHITECTURE.md for the module map)
    cli/    engram         the CLI
    panel/  @engram/panel  the Vite + React control panel
```

`SPEC.md` is the internal contract every engine change is measured against. If your change makes the code disagree with the spec, update the spec in the same PR and call it out — do not let them drift.

## Coding conventions

- **ESM only.** Every package is `"type": "module"`. Use `.js` extensions on relative imports (NodeNext resolution), import from `node:`-prefixed builtins.
- **Strict TypeScript.** Target ES2022. Keep `types.ts` as the single source of cross-module shapes; import from there rather than redefining.
- **No native dependencies in `@engram/core`.** This is a hard rule. The engine must install and run on a clean machine with only Node ≥ 20. No `better-sqlite3`, no native addons. The HTTP server uses `node:http`; the index is plain JSON. If a change wants a native dep, it does not belong in core.
- **Keep core dependency-light.** The current budget is `gray-matter`, `yaml`, and `zod`. Adding to it needs a good reason.
- **Pure where it can be pure.** Decay and the tokenizer are pure functions given a clock. Keep them that way — it is what makes them testable against closed-form expectations.
- **Markdown stays canonical.** Anything you add to `.engram/` must be derivable from the `.md` files. Deleting `.engram/` must never lose data.

## Tests

The suite is vitest, in `@engram/core`. Run `npm test` (or `npm run test:watch --workspace @engram/core` while iterating). Engine changes should come with tests; the decay and consolidation math in particular is verified against the closed-form formulas and hand-built fixtures, and a regression there should be caught by a failing assertion, not a code review.

## Running the panel in dev

The panel is a client of the core HTTP API, so you run two processes:

```bash
# Terminal 1 — the engine's HTTP API on loopback:4319, pointed at a vault
node packages/cli/dist/index.js panel --dir ./examples/starter-vault

# Terminal 2 — the Vite dev server for the React UI
npm run dev --workspace @engram/panel
```

Vite serves the UI with hot reload and proxies `/api` to the core server on `127.0.0.1:4319`, so edits to the panel show up live while the engine stays put. To test the production path instead, `npm run build --workspace @engram/panel` and let `engram panel` serve the built `dist/` directly.

## PR checklist

Before opening a pull request:

- [ ] `npm run build` succeeds.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` is clean.
- [ ] New engine behavior has a test, and the math has a closed-form or fixture assertion.
- [ ] `@engram/core` gained no native dependency.
- [ ] If engine behavior changed, `SPEC.md` was updated to match.
- [ ] `CHANGELOG.md` has an entry under `Unreleased` for anything user-facing.
- [ ] Commits are scoped and the diff contains only what the change needs.
