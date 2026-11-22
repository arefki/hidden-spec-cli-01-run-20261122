// match.ts — the three matching tiers of SPEC.md section 5.
// An old block O is found in a file's lines at the first tier where it occurs at least once:
// tier 0 every line equal, tier 1 trailing spaces/tabs ignored, tier 2 leading and trailing
// spaces/tabs ignored. A context line is written as the file's own matched line; at tier 2
// every other new line is re-indented from the old block's indent to the file's.

import type { FileState } from './core.ts';

/** Leading spaces and tabs of a line. */
export function leading(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m === null ? '' : m[0];
}

function norm(line: string, tier: number): string {
  if (tier === 0) return line;
  if (tier === 1) return line.replace(/[ \t]+$/, '');
  return line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/** Positions where oldLines occur in lines at the given tier; occurrences may overlap. */
export function occurrences(lines: string[], oldLines: string[], tier: number): number[] {
  const out: number[] = [];
  if (oldLines.length === 0 || oldLines.length > lines.length) return out;
  const want = oldLines.map((l) => norm(l, tier));
  for (let i = 0; i + oldLines.length <= lines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < want.length; j += 1) {
      if (norm(lines[i + j]!, tier) !== want[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * The first tier at which oldLines occur at least once at or after `from`
 * (tier 0 only with strict), with those occurrences, or null.
 */
export function findTier(
  lines: string[],
  oldLines: string[],
  strict: boolean,
  from = 0,
): { tier: number; occ: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const occ = occurrences(lines, oldLines, tier).filter((i) => i >= from);
    if (occ.length > 0) return { tier, occ };
  }
  return null;
}

/** First line at or after `from` equal to `line` at the first tier with one, or -1. */
export function findSingle(lines: string[], line: string, from: number, strict: boolean): number {
  const found = findTier(lines, [line], strict, from);
  return found === null ? -1 : found.occ[0]!;
}

/** One line of a replacement: a context line is written as the file's own matched line. */
export interface NewLine {
  text: string;
  /** Index into the old lines when this is a context line, else undefined. */
  contextOf?: number;
}

/**
 * Build the replacement lines for a matched span starting at `pos`: context lines come
 * from the file, other lines are re-indented at tier 2 (SPEC.md section 5).
 */
export function buildReplacement(
  fileLines: string[],
  oldLines: string[],
  newLines: NewLine[],
  tier: number,
  pos: number,
): string[] {
  const out: string[] = [];
  const f = leading(fileLines[pos] ?? '');
  const p = leading(oldLines[0] ?? '');
  for (const nl of newLines) {
    if (nl.contextOf !== undefined) {
      out.push(fileLines[pos + nl.contextOf]!);
      continue;
    }
    if (tier === 2) {
      const t = nl.text;
      if (t !== '' && t.trim() !== '' && t.startsWith(p)) out.push(f + t.slice(p.length));
      else out.push(t);
    } else {
      out.push(nl.text);
    }
  }
  return out;
}

/** A file's lines with a span replaced. */
export function spliceLines(state: FileState, pos: number, del: number, ins: string[]): FileState {
  const lines = [...state.lines];
  lines.splice(pos, del, ...ins);
  return { lines, br: state.br, final: state.final };
}
