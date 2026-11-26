# QA gates

The quality bar for this project, as executable checks. A gate is all-or-nothing:
if any check inside it fails, the gate fails and `npm run qa` exits non-zero.

```bash
npm run qa            # summaries and failures only
npm run qa:verbose    # every check with its measured value
npm run qa:explore    # exploratory probes for problems gates don't cover
```

CI runs `npm run qa` on every push and pull request.

## Why these gates

Each one exists because something in this category actually broke here, or because
a green test suite would hide that class of bug.

| Gate | What it enforces | Failure it prevents |
|---|---|---|
| **G1** Types compile | `tsc` clean for app and tests | Shipping a build that only works in the dev server |
| **G2** Production build | Build succeeds, hashed assets, single bundles, <400 kB gzip | A repo whose documented build command does not work |
| **G3** Test suites | Both node suites pass | Regressions hidden behind a stale build |
| **G4** Data integrity | Sanitizer survives hostile shapes; dangling shelf refs cleared; merge works on pre-shelf data; export round-trips | **A crash on restoring an old backup** — this happened |
| **G5** Untrusted content | Named errors for junk EPUBs; no `eval`, `Function`, `innerHTML`; size caps | A malicious or corrupt book taking down the app |
| **G6** Durability | Write failures published; boot probe; bytes outlive the undo window; destructive delete confirmed | **Silently losing a journal** — this happened |
| **G7** Accessibility | No emoji icons; icons hidden from AT; modal dialog semantics and trap; live region; named controls | Keyboard and screen-reader users locked out |
| **G8** Design system | No inline hex in components; no `transition-all` or hover-scale; reduced motion; one easing curve | Visual drift back to template defaults |
| **G9** Repo hygiene | No secrets or personal identifiers; ignored build output and notes; every module reachable | **Committing an account id or token** — nearly happened |
| **G10** Honest claims | README discloses the missing reader and does not overclaim | Shipping a repo that advertises features it lacks |

## Adding a gate

Write the check so it fails loudly and reports a measured value, not just "false".

1. Add `gate('G11', 'Name', 'What it protects')`.
2. Add `check('short name', () => { ... })` — return a string describing the
   measurement, or throw with the observed value.
3. Update the table above.

Prefer checks that read the **built output or the running app** over checks that
grep source, when both are possible. Source checks are a fast proxy; the built
artefact is the truth.

## Exploratory QA

Gates only verify what someone thought to assert. `qa-exploratory.cjs` drives the
real app through hostile sequences — duplicate names, refresh mid-undo, quota
failure, corrupt uploads, 8 shelves on a phone — and reports findings by severity.
It is expected to find things; when it does, fix the product, then add a gate so
the finding cannot come back.

Findings are written to `.review/qa-findings.json`.
