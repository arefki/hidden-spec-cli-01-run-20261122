# hidden-spec-cli-01-run-20261122

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/arefki/hidden-spec-cli-01-run-20261122/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/arefki/hidden-spec-cli-01-run-20261122/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend is one command-line tool that applies the edits AI models write, in every format
they use: unified diffs (often with wrong line numbers), SEARCH/REPLACE blocks, V4A
patches and text-editor tool calls as JSON. It finds the lines an edit names even when
the model drifted their whitespace or indentation, and changes every file or none.

## Run it

```sh
node main.ts [options] [PATCH]
```

`PATCH` is a patch file, or `-`/nothing to read the patch from standard input. The
working directory is the root of the tree the patch applies to.

```sh
node main.ts fix.patch            # apply a unified diff
cat edit.txt | node main.ts       # apply a SEARCH/REPLACE patch from stdin
node main.ts --format=v4a p.patch # force one format
node main.ts --check fix.patch    # dry run: same output, nothing written
node main.ts --strict fix.patch   # match lines exactly (tier 0 only)
```

Options: `--format=auto|unified|search-replace|v4a|json`, `--check`, `--strict`.
Exit 0 prints one line per changed file plus `ok: N files`; exit 1 lists the edits
that failed plus `failed: K of N edits`; exit 2 is one `error:` line (usage, no
patch, unknown format, or a parse fault). Nothing is ever half-applied: when any
edit fails, no file is written.

## How it works

- `main.ts` — the CLI: arguments, output and exit codes, JSON edits, the
  all-or-nothing write, and the trial hand-over to `runner.ts`.
- `core.ts` — the in-memory tree, safe paths, file line breaks (LF/CRLF, final
  break), format detection.
- `match.ts` — the three matching tiers (exact, trailing whitespace, leading and
  trailing whitespace) and tier-2 re-indentation.
- `unified.ts` — unified diffs: sections, hunks, nearest-occurrence matching,
  creation/deletion/move, `\ No newline at end of file`.
- `searchreplace.ts` — SEARCH/REPLACE blocks, including file creation and the
  exactly-once rule.
- `v4a.ts` — V4A patches: Add/Delete/Update sections, `@@` anchors, `*** End of
  File`, the moving cursor.
- `runner.ts`, `check.ts` — the kit's trial runner and practice checker, kept as
  shipped. `SPEC.md` is the whole contract; `node check.ts
  ../program/generator/practice.json` runs the 100 public practice checks.

Node 22 and its standard library alone; no dependencies, no network, no model calls.

---

<sub>Entered on [make.fun](https://make.fun/?ref=v4nm4nhq&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
