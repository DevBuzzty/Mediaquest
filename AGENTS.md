# AGENTS.md -- operator spine

<!--
Seeded by /podium-init as a starting skeleton, not a finished document.
Every block marked TODO below is a placeholder -- replace it with this
project's actual facts. Leaving a guessed value in place is worse than
leaving the TODO: an operator spine that states something false is read as
ground truth by every role that opens it.
-->

## Project context

<!-- TODO: one paragraph -- what this project is, who it is for, where it
runs, what makes it worth knowing before touching code. -->

## Roles

<!-- TODO: which roster this project actually runs. The optional podium-roles
layer ships a default six: planner, builder, critic, verifier, scout,
harvester -- see below. A project with its own roster instead does not
install podium-roles; replace this section with that project's own roles and
delete the table. -->

If `podium-roles` is installed:

| Role | Job |
|---|---|
| planner | Design work before code: spec, plan, architecture. |
| builder | Bounded implementation across the codebase. |
| critic | Adversarial pre-commit review. |
| verifier | Runs the test/verification suites and interprets results. |
| scout | Read-only research and codebase exploration. |
| harvester | Turns session lessons into durable memory and patterns. |

Each role reads its own memory file at the start of a run, at
`.claude/_podium/memory/<role>.md` by default (override the directory via
`podium.config.json`'s `layers.core.memoryDir`). Path-scoped
domain knowledge lives in `.claude/rules/*.md` (see `.claude/rules/example.md`,
created by `/podium-init`, for the shape of a new one) and loads automatically
the moment a matching file is written or edited (a `PreToolUse` hook on
Write/Edit -- merely reading the file triggers nothing) -- trust a loaded
rule; do not re-derive what it already states.

## Hard rules

<!-- TODO: this project's own non-negotiable rules -- the two or three things
a change must never violate (a parity requirement between two surfaces, a
deploy gate, a data-safety rule). `podium.config.json` carries
`workspaces[].gated` decides which workspaces the push gate of podium-gates
runs (without that layer it has no effect); `roles.gateTrio` is not read by
any layer yet. podium-core itself enforces neither. Write down what a change must never
violate here regardless of what tooling currently checks it. -->

## Verification

<!-- TODO: per workspace, what must pass before a commit. podium.config.json
already carries the machine-readable version (`workspaces[].test`,
`workspaces[].typecheck`); this section is the human-readable version, plus
anything the config can't express (a live smoke test, a manual device check,
a deploy-preview step). -->

## Where the rest lives

Path-scoped detail belongs in `.claude/rules/*.md`, not here. Keep this file
to what every role needs on every run -- each line here costs context every
time, and a rule that only matters in one directory belongs in that rule
file instead.
