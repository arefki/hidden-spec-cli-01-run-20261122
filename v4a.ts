// v4a.ts — V4A patches (SPEC.md section 8).
// `*** Begin Patch` … `*** End Patch`, with Add File, Delete File and Update File sections.
// Update chunks carry an optional `@@` anchor and an optional `*** End of File` marker, and
// apply in order behind a cursor that starts at line 0.

import { Exit2, Fail, blank, parseFile, safe, serializeFile } from './core.ts';
import type { Edit, Tree } from './core.ts';
import { buildReplacement, findSingle, findTier } from './match.ts';
import type { NewLine } from './match.ts';

interface Chunk {
  /** Anchor text, or null when the chunk has none. */
  anchor: string | null;
  /** Raw body lines: ` `, `-`, `+` or empty. */
  body: string[];
  /** `*** End of File` ended this chunk: it is anchored to the end of the file. */
  eof: boolean;
}

type V4aSection =
  | { kind: 'add'; path: string; lines: string[] }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo: string | null; chunks: Chunk[] };

function isSectionStart(l: string): boolean {
  return l.startsWith('*** Add File:') || l.startsWith('*** Delete File:') || l.startsWith('*** Update File:');
}

function chunkParts(ch: Chunk): { oldLines: string[]; newLines: NewLine[] } {
  const oldLines: string[] = [];
  const newLines: NewLine[] = [];
  for (const bl of ch.body) {
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
  }
  return { oldLines, newLines };
}

function v4aEdit(s: V4aSection, strict: boolean): Edit {
  return (tree: Tree) => {
    if (s.kind === 'add') {
      const p = s.path;
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, s.lines.length === 0 ? '' : s.lines.join('\n') + '\n');
      return;
    }
    if (s.kind === 'delete') {
      const p = s.path;
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    const p = s.path;
    if (!safe(p)) throw new Fail('unsafe', p);
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    if (s.moveTo !== null) {
      if (!safe(s.moveTo)) throw new Fail('unsafe', s.moveTo);
      if (tree.get(s.moveTo) !== null) throw new Fail('exists', s.moveTo);
    }
    let state = parseFile(before);
    let cursor = 0;
    for (const ch of s.chunks) {
      if (ch.anchor !== null) {
        const idx = findSingle(state.lines, ch.anchor, cursor, strict);
        if (idx === -1) throw new Fail('no-match', p);
        cursor = idx + 1;
      }
      const { oldLines, newLines } = chunkParts(ch);
      if (oldLines.length > 0) {
        const found = findTier(state.lines, oldLines, strict, cursor);
        if (found === null) throw new Fail('no-match', p);
        let occ = found.occ;
        if (ch.eof) occ = occ.filter((pos) => pos + oldLines.length === state.lines.length);
        if (occ.length === 0) throw new Fail('no-match', p);
        const pos = occ[0]!;
        const replacement = buildReplacement(state.lines, oldLines, newLines, found.tier, pos);
        const lines = [...state.lines];
        lines.splice(pos, oldLines.length, ...replacement);
        state = { lines, br: state.br, final: state.final };
        cursor = pos + replacement.length;
      } else {
        const pos = ch.eof ? state.lines.length : cursor;
        const ins = newLines.map((nl) => nl.text);
        const lines = [...state.lines];
        lines.splice(pos, 0, ...ins);
        state = { lines, br: state.br, final: state.final };
        cursor = pos + ins.length;
      }
    }
    const text = serializeFile(state);
    if (s.moveTo !== null) {
      tree.now.set(p, null);
      tree.now.set(s.moveTo, text);
      tree.moves.push({ old: p, new: s.moveTo });
    } else {
      tree.now.set(p, text);
    }
  };
}

export function parseV4a(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last >= 0 && blank(lines[last]!)) last -= 1;
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: V4aSection[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (blank(line)) {
      i += 1;
      continue;
    }
    if (line.startsWith('*** Add File:')) {
      const path = line.slice('*** Add File:'.length).trim();
      const raw: string[] = [];
      let j = i + 1;
      while (j < last) {
        const l = lines[j]!;
        if (isSectionStart(l)) break;
        if (l.startsWith('+') || l === '') {
          raw.push(l);
          j += 1;
          continue;
        }
        throw new Exit2(`error: parse ${j + 1}`);
      }
      while (raw.length > 0 && blank(raw[raw.length - 1]!)) raw.pop();
      sections.push({ kind: 'add', path, lines: raw.map((l) => (l === '' ? '' : l.slice(1))) });
      i = j;
      continue;
    }
    if (line.startsWith('*** Delete File:')) {
      const path = line.slice('*** Delete File:'.length).trim();
      let j = i + 1;
      while (j < last) {
        const l = lines[j]!;
        if (blank(l)) {
          j += 1;
          continue;
        }
        if (isSectionStart(l)) break;
        throw new Exit2(`error: parse ${j + 1}`);
      }
      sections.push({ kind: 'delete', path });
      i = j;
      continue;
    }
    if (line.startsWith('*** Update File:')) {
      const path = line.slice('*** Update File:'.length).trim();
      const updateLine = i;
      let moveTo: string | null = null;
      let j = i + 1;
      if (j < last && lines[j]!.startsWith('*** Move to:')) {
        moveTo = lines[j]!.slice('*** Move to:'.length).trim();
        j += 1;
      }
      const chunks: Chunk[] = [];
      let cur: Chunk | null = null;
      let firstChunk = true;
      while (j < last) {
        const l = lines[j]!;
        if (isSectionStart(l)) break;
        if (l.startsWith('@@')) {
          if (cur !== null) chunks.push(cur);
          // SPEC.md section 8: the text after `@@` is the chunk's anchor, and an
          // empty text is no anchor — a bare `@@` line must not search for an
          // empty line, it leaves the chunk unanchored.
          const anchorText = l.slice(2).trim();
          cur = { anchor: anchorText === '' ? null : anchorText, body: [], eof: false };
          firstChunk = false;
          j += 1;
          continue;
        }
        if (l === '*** End of File') {
          if (cur === null) throw new Exit2(`error: parse ${j + 1}`);
          cur.eof = true;
          chunks.push(cur);
          cur = null;
          firstChunk = false;
          j += 1;
          continue;
        }
        if (l.startsWith('***')) throw new Exit2(`error: parse ${j + 1}`);
        if (l === '' || l.startsWith(' ') || l.startsWith('-') || l.startsWith('+')) {
          if (cur === null) {
            if (firstChunk) {
              cur = { anchor: null, body: [], eof: false };
              firstChunk = false;
            } else {
              throw new Exit2(`error: parse ${j + 1}`);
            }
          }
          cur.body.push(l);
          j += 1;
          continue;
        }
        throw new Exit2(`error: parse ${j + 1}`);
      }
      if (cur !== null) {
        while (cur.body.length > 0 && blank(cur.body[cur.body.length - 1]!)) cur.body.pop();
        chunks.push(cur);
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${updateLine + 1}`);
      sections.push({ kind: 'update', path, moveTo, chunks });
      i = j;
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  if (sections.length === 0) throw new Exit2('error: parse 1');
  return sections.map((s) => v4aEdit(s, strict));
}
