// unified.ts — unified diffs (SPEC.md section 6).
// A section is one edit: creation, deletion, move or change of one path. Its hunks apply in
// order, each to the result of the ones before it; a hunk takes the occurrence nearest to the
// line number it names (wrong numbers and drifted whitespace are expected).

import { Exit2, Fail, parseFile, safe, serializeFile } from './core.ts';
import type { Edit, FileState, Tree } from './core.ts';
import { buildReplacement, findTier } from './match.ts';
import type { NewLine } from './match.ts';

interface Hunk {
  /** Old start line, 1-based (A). B and D are not used. */
  a: number;
  /** O: the hunk's context and `-` lines, in body order. */
  oldLines: string[];
  /** N: the hunk's context and `+` lines, in body order. */
  newLines: NewLine[];
  /** A `\` line follows the hunk's last context or `+` line. */
  ctxPlusBackslash: boolean;
  /** A `\` line follows the hunk's last `+` line. */
  plusBackslash: boolean;
  /** The hunk has at least one `+` line. */
  hasPlus: boolean;
}

interface Section {
  oldPath: string | null;
  newPath: string | null;
  creation: boolean;
  deletion: boolean;
  hunks: Hunk[];
}

interface SectionBuilder {
  diffOld?: string;
  diffNew?: string;
  pairOld?: string | null;
  pairNew?: string | null;
  renameFrom?: string;
  renameTo?: string;
  newFile: boolean;
  deletedFile: boolean;
  hunks: Hunk[];
}

function parseDiffGit(line: string): { old: string; new: string } | null {
  const m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
  if (m === null) return null;
  return { old: m[1]!, new: m[2]! };
}

/** The path of a `--- ` / `+++ ` line: text after the four characters, up to the first tab, surrounding spaces removed. */
function headerPath(line: string): string {
  return line.slice(4).split('\t')[0]!.trim();
}

/** `/dev/null` means no file; a leading `a/` or `b/` is removed. */
function stripPrefix(p: string): string | null {
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) return p.slice(2);
  return p;
}

function parseHunkHeader(line: string): number | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (m === null) return null;
  return Number(m[1]);
}

function buildHunk(a: number, body: string[]): Hunk {
  const oldLines: string[] = [];
  const newLines: NewLine[] = [];
  for (const bl of body) {
    if (bl.startsWith(' ')) {
      const text = bl.slice(1);
      const idx = oldLines.length;
      oldLines.push(text);
      newLines.push({ text, contextOf: idx });
    } else if (bl === '') {
      const idx = oldLines.length;
      oldLines.push('');
      newLines.push({ text: '', contextOf: idx });
    } else if (bl.startsWith('-')) {
      oldLines.push(bl.slice(1));
    } else if (bl.startsWith('+')) {
      newLines.push({ text: bl.slice(1) });
    }
    // `\` lines refer to the body line before them; they carry no line of their own.
  }
  let lastCtxPlus = -1;
  let lastPlus = -1;
  body.forEach((bl, j) => {
    if (bl === '' || bl.startsWith(' ') || bl.startsWith('+')) lastCtxPlus = j;
    if (bl.startsWith('+')) lastPlus = j;
  });
  const after = (j: number): boolean => j >= 0 && j + 1 < body.length && body[j + 1]!.startsWith('\\');
  return {
    a,
    oldLines,
    newLines,
    ctxPlusBackslash: after(lastCtxPlus),
    plusBackslash: after(lastPlus),
    hasPlus: lastPlus >= 0,
  };
}

function finalize(b: SectionBuilder): Section {
  const oldPath =
    b.pairOld !== undefined
      ? b.pairOld
      : b.renameFrom !== undefined
        ? stripPrefix(b.renameFrom)
        : b.diffOld !== undefined
          ? stripPrefix(b.diffOld)
          : null;
  const newPath =
    b.pairNew !== undefined
      ? b.pairNew
      : b.renameTo !== undefined
        ? stripPrefix(b.renameTo)
        : b.diffNew !== undefined
          ? stripPrefix(b.diffNew)
          : null;
  const creation = b.newFile || oldPath === null;
  const deletion = !creation && (b.deletedFile || newPath === null);
  return { oldPath, newPath, creation, deletion, hunks: b.hunks };
}

function applyHunks(state: FileState, hunks: Hunk[], strict: boolean, path: string): FileState {
  let s = state;
  let d = 0;
  for (const h of hunks) {
    if (h.oldLines.length > 0) {
      const found = findTier(s.lines, h.oldLines, strict);
      if (found === null) throw new Fail('no-match', path);
      const target = h.a - 1 + d;
      let best = found.occ[0]!;
      for (const pos of found.occ) {
        if (Math.abs(pos - target) < Math.abs(best - target)) best = pos;
      }
      const replacement = buildReplacement(s.lines, h.oldLines, h.newLines, found.tier, best);
      const touchesEnd = best + h.oldLines.length === s.lines.length;
      const lines = [...s.lines];
      lines.splice(best, h.oldLines.length, ...replacement);
      s = { lines, br: s.br, final: touchesEnd ? !h.ctxPlusBackslash : s.final };
      d += h.newLines.length - h.oldLines.length;
    } else {
      const pos = Math.min(Math.max(h.a + d, 0), s.lines.length);
      const ins = h.newLines.map((nl) => nl.text);
      const lines = [...s.lines];
      lines.splice(pos, 0, ...ins);
      s = { lines, br: s.br, final: pos === s.lines.length ? !h.ctxPlusBackslash : s.final };
      d += h.newLines.length;
    }
  }
  return s;
}

function sectionEdit(s: Section, strict: boolean): Edit {
  return (tree: Tree) => {
    if (s.creation) {
      const p = s.newPath;
      if (p === null) throw new Fail('unsafe', '/dev/null');
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      const plus: string[] = [];
      for (const h of s.hunks) {
        for (const nl of h.newLines) {
          if (nl.contextOf === undefined) plus.push(nl.text);
        }
      }
      let noEol = false;
      for (let k = s.hunks.length - 1; k >= 0; k -= 1) {
        if (s.hunks[k]!.hasPlus) {
          noEol = s.hunks[k]!.plusBackslash;
          break;
        }
      }
      tree.now.set(p, plus.length === 0 ? '' : plus.join('\n') + (noEol ? '' : '\n'));
      return;
    }
    if (s.deletion) {
      const p = s.oldPath;
      if (p === null) throw new Fail('unsafe', '/dev/null');
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    const oldP = s.oldPath!;
    const newP = s.newPath!;
    if (!safe(oldP)) throw new Fail('unsafe', oldP);
    if (!safe(newP)) throw new Fail('unsafe', newP);
    const before = tree.get(oldP);
    if (before === null) throw new Fail('missing', oldP);
    const isMove = oldP !== newP;
    if (isMove && tree.get(newP) !== null) throw new Fail('exists', newP);
    const state = applyHunks(parseFile(before), s.hunks, strict, oldP);
    const text = serializeFile(state);
    if (isMove) {
      tree.now.set(oldP, null);
      tree.now.set(newP, text);
      tree.moves.push({ old: oldP, new: newP });
    } else {
      tree.now.set(oldP, text);
    }
  };
}

export function parseUnified(lines: string[], strict: boolean): Edit[] {
  const sections: Section[] = [];
  let cur: SectionBuilder | null = null;
  let inHeader = false;
  const startSection = (): SectionBuilder => {
    const b: SectionBuilder = { newFile: false, deletedFile: false, hunks: [] };
    if (cur !== null) sections.push(finalize(cur));
    cur = b;
    inHeader = true;
    return b;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const dg = parseDiffGit(line);
      if (dg === null) throw new Exit2(`error: parse ${i + 1}`);
      const b = startSection();
      b.diffOld = dg.old;
      b.diffNew = dg.new;
      i += 1;
      continue;
    }
    if (line.startsWith('--- ')) {
      const next = lines[i + 1];
      if (next !== undefined && next.startsWith('+++ ')) {
        if (cur !== null && inHeader) {
          if (cur.pairOld === undefined) {
            cur.pairOld = stripPrefix(headerPath(line));
            cur.pairNew = stripPrefix(headerPath(next));
          }
          i += 2;
          continue;
        }
        const b = startSection();
        b.pairOld = stripPrefix(headerPath(line));
        b.pairNew = stripPrefix(headerPath(next));
        i += 2;
        continue;
      }
      if (cur !== null && inHeader) throw new Exit2(`error: parse ${i + 2}`);
      i += 1;
      continue;
    }
    if (line.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const a = parseHunkHeader(line);
      if (a === null) throw new Exit2(`error: parse ${i + 1}`);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const bl = lines[j]!;
        if (bl.startsWith('--- ') && lines[j + 1] !== undefined && lines[j + 1]!.startsWith('+++ ')) break;
        if (bl === '' || bl.startsWith(' ') || bl.startsWith('-') || bl.startsWith('+') || bl.startsWith('\\')) {
          body.push(bl);
          j += 1;
          continue;
        }
        break;
      }
      while (body.length > 0) {
        const last = body[body.length - 1]!;
        if (last === '' || last === ' ') body.pop();
        else break;
      }
      cur.hunks.push(buildHunk(a, body));
      inHeader = false;
      i = j;
      continue;
    }
    if (cur !== null && inHeader) {
      if (line.startsWith('rename from ')) cur.renameFrom = line.slice('rename from '.length).trim();
      else if (line.startsWith('rename to ')) cur.renameTo = line.slice('rename to '.length).trim();
      else if (line.startsWith('new file mode')) cur.newFile = true;
      else if (line.startsWith('deleted file mode')) cur.deletedFile = true;
    }
    i += 1;
  }
  if (cur !== null) sections.push(finalize(cur));
  if (sections.length === 0) throw new Exit2('error: parse 1');
  return sections.map((s) => sectionEdit(s, strict));
}
