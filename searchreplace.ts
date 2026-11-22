// searchreplace.ts — SEARCH/REPLACE blocks (SPEC.md section 7).
// A block is a path line, a SEARCH marker, old lines, a divider, new lines and a REPLACE
// marker. Each block is one edit: an empty old block creates the file, otherwise the old
// lines must occur at their tier exactly once.

import { Exit2, Fail, blank, parseFile, safe, serializeFile } from './core.ts';
import type { Edit, Tree } from './core.ts';
import { buildReplacement, findTier } from './match.ts';
import type { NewLine } from './match.ts';

interface Block {
  path: string;
  oldLines: string[];
  newLines: string[];
}

function blockEdit(b: Block, strict: boolean): Edit {
  return (tree: Tree) => {
    const p = b.path;
    if (!safe(p)) throw new Fail('unsafe', p);
    if (b.oldLines.length === 0) {
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, b.newLines.length === 0 ? '' : b.newLines.join('\n') + '\n');
      return;
    }
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    const state = parseFile(before);
    const found = findTier(state.lines, b.oldLines, strict);
    if (found === null) throw new Fail('no-match', p);
    if (found.occ.length > 1) throw new Fail('ambiguous', p);
    const pos = found.occ[0]!;
    const newLines: NewLine[] = b.newLines.map((t) => ({ text: t }));
    const replacement = buildReplacement(state.lines, b.oldLines, newLines, found.tier, pos);
    const lines = [...state.lines];
    lines.splice(pos, b.oldLines.length, ...replacement);
    tree.now.set(p, serializeFile({ lines, br: state.br, final: state.final }));
  };
}

export function parseSearchReplace(lines: string[], strict: boolean): Edit[] {
  const blocks: Block[] = [];
  let prevEnd = 0;
  let prevPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() === '<<<<<<< SEARCH') {
      const searchLine = i;
      let path: string | null = null;
      for (let j = i - 1; j >= prevEnd; j -= 1) {
        const l = lines[j]!;
        if (blank(l)) continue;
        if (l.trim().startsWith('```')) continue;
        path = l.trim();
        break;
      }
      if (path === null) {
        if (prevPath !== null) path = prevPath;
        else throw new Exit2(`error: parse ${searchLine + 1}`);
      }
      let eq = -1;
      for (let k = i + 1; k < lines.length; k += 1) {
        if (lines[k]!.trimEnd() === '=======') {
          eq = k;
          break;
        }
      }
      if (eq === -1) throw new Exit2(`error: parse ${searchLine + 1}`);
      let rep = -1;
      for (let k = eq + 1; k < lines.length; k += 1) {
        if (lines[k]!.trimEnd() === '>>>>>>> REPLACE') {
          rep = k;
          break;
        }
      }
      if (rep === -1) throw new Exit2(`error: parse ${searchLine + 1}`);
      blocks.push({ path, oldLines: lines.slice(i + 1, eq), newLines: lines.slice(eq + 1, rep) });
      prevPath = path;
      prevEnd = rep + 1;
      i = rep + 1;
    } else {
      i += 1;
    }
  }
  if (blocks.length === 0) throw new Exit2('error: parse 1');
  return blocks.map((b) => blockEdit(b, strict));
}
