# AGENT.md — mend (hidden-spec-cli-01-run-20261122)

One CLI, `node main.ts [options] [PATCH]`, that applies AI-written edits in four
formats (unified diff, SEARCH/REPLACE, V4A, JSON) to a tree of text files, to the
contract in SPEC.md. All or nothing: any failed edit means no file is written.

## Layout

- `main.ts` — CLI entrypoint: argument parsing, output/exit codes, JSON edits
  (section 9), the all-or-nothing write (section 10), trial hand-over to
  `runner.ts` when `MAKEFUN_ENV_URL` is set.
- `core.ts` — errors, safe paths, patch/file line handling, the in-memory tree,
  format detection (sections 2–4, 10).
- `match.ts` — three matching tiers and tier-2 re-indentation (section 5).
- `unified.ts` — unified diffs (section 6).
- `searchreplace.ts` — SEARCH/REPLACE blocks (section 7).
- `v4a.ts` — V4A patches (section 8).
- `runner.ts`, `check.ts` — the kit's trial runner and practice checker, kept as
  shipped. `SPEC.md` is the contract; `LICENSE` is MIT.

## Test

```sh
node check.ts ../program/generator/practice.json   # 100 public practice checks
```

Run from this directory with Node 22. The practice score is
`round(1000 * passed / 100)`. A single check can be run by family, e.g.
`node check.ts ../program/generator/practice.json u-offset`.

## Notes for the submit session

- Kit: `~/workspace/makefun/hidden-spec-cli-01-run-20261122-kit/`
  (nested CLI at `hidden-spec-cli-01-run-20261122-kit/cli/makefun.mjs`).
- Anchor (kit init, before the first write):
  `makefun anchor 744ec135a39dd4d79e87a09e27766c11640124a8 round 34184650`
  (drand round emitted after the competition opened 2026-11-22T14:00:00Z).
- `.makefun/owner.json` names the payout wallet
  `3ogm89wLch7hTjRTpcBGgE4LDanCZiDEa6GtF7VWcnzk`.
- Harness: Muse, provider meta, model ipnext/avocado-5.17-v7; prompt-file is the
  verbatim standing order, prompt-origin scheduled, prompt-via
  makefun-new-bounty-watch; bundle with `--mcp none`.
