# Skills roster

The named skills of Codegraph Studio, unified under Greek mythology: each name
reflects a role. They are invoked explicitly — by name.

## Who's who

| Skill | Role | When to call |
|-------|------|--------------|
| `athena` | Strategist / planner | Start work from an issue, analyze the task, and align on the approach before implementation |
| `hephaestus` | Engineer + docs steward | Develop the parser, canvas viewer, VS Code extension; changes that also update the documentation |
| `talos` | Fast, lightweight engineer | Small-to-medium, well-understood edits without re-chewing the task |
| `hermes` | Code↔doc drift watcher | Spot a divergence between code and docs or a code smell and prepare a precise report |
| `iris` | Bug reports / PRs | File an issue, open an MR/PR via branch → commit → push → pull request |

## Examples: who to call

### `athena` — planner

- "Take issue #42 and propose how to solve it."
- "There are several ways to do X — let's settle on the approach before coding."
- "Analyze the task: what affects the invariants and both runtimes?"

### `hephaestus` — engineer + docs

- "Add a new edge kind to the parser and update `GLOSSARY.md`/`INVARIANTS.md`."
- "We're changing the webview↔host message protocol — update code and docs together."
- "Refactor the canvas viewer; the task carries risk to the contracts."

### `talos` — fast, lightweight engineer

- "Fix a typo in the UI text and touch up a line in `README.md`."
- "A clear, couple-of-steps task — just do it, no long discussion."
- "A small style tweak that definitely doesn't touch the invariants."

### `hermes` — drift watcher

- "Check whether the README and the actual build commands have drifted apart."
- "Looks like a term in the code doesn't match `GLOSSARY.md` — write up the finding."
- "Spotted duplication/dead code — prepare a report for an issue."

### `iris` — bug reports / PRs

- "File a bug for this error on GitHub."
- "Open a PR from the current branch into `main`."
- "Prepare an issue from the finding by `hermes`."

## How they relate

- `athena` plans → `hephaestus` (or `talos`) implements.
- `hermes` finds a problem → proposes `iris` to file an issue.
- `iris` files issues/PRs; it does not fix or plan itself.
- `talos` hands off to `hephaestus` when there's risk (an invariant breaks, data
  is dropped, a contract changes).

## Subagents

When launching subagents, every skill defaults to a cheap model — **grok** or
**composer** (`cursor-grok-4.6-high-fast`, `cursor-grok-4.5-medium`,
`composer-2.5`, `composer-2.5-fast`). Expensive tiers (Claude Opus/Sonnet,
Gemini Pro) only in cases of genuine necessity: when the work must be split off
from your own context and a light model clearly can't handle it.
