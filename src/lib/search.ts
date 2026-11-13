import MiniSearch from 'minisearch';
import type { NoteMeta } from '../types';

function tokenize(text: string) {
  const lower = String(text || '').toLowerCase();
  const tokens: string[] = [];
  const latin = lower.match(/[a-z0-9][a-z0-9+#._-]*/g) || [];
  for (const token of latin) {
    if (token.length >= 2) tokens.push(token);
  }
  const cjkRuns = lower.match(/[\u3400-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

export function createSearch(notes: NoteMeta[]) {
  const index = new MiniSearch<NoteMeta>({
    idField: 'path',
    fields: ['title', 'excerpt', 'tags', 'aliases'],
    storeFields: ['path', 'title', 'type', 'typeLabel', 'excerpt', 'tags', 'updated', 'status'],
    tokenize,
    searchOptions: {
      boost: { title: 4, aliases: 3, tags: 2 },
      prefix: true,
      fuzzy: 0.15,
    },
  });
  index.addAll(
    notes.map((note) => ({
      ...note,
      tags: note.tags.join(' '),
      aliases: note.aliases.join(' '),
    })) as unknown as NoteMeta[],
  );
  return index;
}

export function searchNotes(index: MiniSearch<NoteMeta>, query: string) {
  const text = query.trim();
  if (!text) return [];
  return index.search(text).map((result) => ({
    ...(result as unknown as NoteMeta),
    path: String(result.id),
    score: result.score,
  }));
}

export { tokenize };
