---
paths: "REPLACE/WITH/A/GLOB/**"
---

<!--
This is a path-scoped rule. `hooks/rule-router.js` loads it automatically the
moment a tool writes or edits a file matching the `paths:` glob above (see
that hook for the exact matching and precedence rules -- the narrowest
matching glob wins when more than one rule covers a file).

Write ONLY project-specific truth in the body below: a constraint this
codebase actually has, a trap that has actually bitten someone here, a
convention this project actually follows. Do not paste in generic
best-practice advice -- a rule file is read back as ground truth for THIS
project, and generic advice read that way is worse than no rule at all: it
gets applied here whether or not it actually fits.

Delete this whole comment block once the rule has real content, and rename
this file to something that names the area it covers (e.g. billing.md,
mobile.md) rather than leaving it as example.md.
-->
