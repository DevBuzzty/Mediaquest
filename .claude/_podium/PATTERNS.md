# Patterns

A pattern is a solution proven to generalize across more than one situation in
this project -- not a one-off fix, and not a fact tied to a single file or
role (those belong in a path-scoped rule or a role's own memory instead).

**Only the harvest pass writes to this file (the `podium-harvest` skill, or the
`harvester` role where `podium-roles` is installed). Every role reads it.** A
pattern lands here by promotion, not by direct write: it starts as a probation
entry (see `<memoryDir>/PROBATION.md`, default `.claude/_podium/memory`) and is promoted only once it has been
cited independently in at least two other places -- see `lib/learn.js`
(`evolve`) for exactly how that decision is made and what "independently"
excludes. A citation is the deliberate token `probation:<slug>` (slug in kebab
form with at least two parts). MIGRATION: a slug mentioned without the `probation:`
prefix no longer counts, so add the prefix where an existing entry is cited.

## Schema

Each entry is one row in the table below:

| Field | Meaning |
|---|---|
| Trigger | The situation that calls for this pattern -- what you would be doing when it applies. |
| Pattern | The solution itself, stated so it can be applied without re-deriving it. |
| Where used | The places this pattern has already been applied, as file paths or role names. |
| Confidence | How settled this pattern is (0.0-1.0). Raised each time it proves out again. |
| Times applied | A running count of independent applications. |
| Last validated | The date this entry was last confirmed still correct. |

| Trigger | Pattern | Where used | Confidence | Times applied | Last validated |
|---|---|---|---|---|---|
