export interface FilterSearchSource {
  displayName: string;
  category: string;
  description?: string;
  keywords?: string;
}

export interface FilterSearchRecord<T extends FilterSearchSource> {
  entry: T;
  name: string;
  nameWords: string[];
  category: string;
  categoryWords: string[];
  description: string;
  keywords: string;
  order: number;
}

export interface FilterSearchResult<T extends FilterSearchSource> {
  items: T[];
  total: number;
}

export const normalizeFilterSearchText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokenVariants = (token: string) => {
  const variants = [token];
  if (token.length >= 7 && token.endsWith("ing")) variants.push(token.slice(0, -3));
  if (token.length >= 6 && token.endsWith("ed")) variants.push(token.slice(0, -2));
  if (token.length >= 6 && token.endsWith("es")) variants.push(token.slice(0, -2));
  if (token.length >= 5 && token.endsWith("s")) variants.push(token.slice(0, -1));
  return variants;
};

const bestTokenScore = <T extends FilterSearchSource>(
  record: FilterSearchRecord<T>,
  token: string,
) => {
  let best = Number.POSITIVE_INFINITY;
  for (const variant of tokenVariants(token)) {
    if (record.nameWords.includes(variant)) best = Math.min(best, 0);
    else if (record.nameWords.some((word) => word.startsWith(variant))) best = Math.min(best, 3);
    else if (record.name.includes(variant)) best = Math.min(best, 7);
    else if (record.categoryWords.includes(variant)) best = Math.min(best, 11);
    else if (record.categoryWords.some((word) => word.startsWith(variant))) best = Math.min(best, 14);
    else if (record.category.includes(variant)) best = Math.min(best, 18);
    else if (record.keywords.includes(variant)) best = Math.min(best, 22);
    else if (record.description.includes(variant)) best = Math.min(best, 30);
  }
  return best;
};

export const buildFilterSearchIndex = <T extends FilterSearchSource>(entries: readonly T[]) =>
  entries.map((entry, order): FilterSearchRecord<T> => {
    const name = normalizeFilterSearchText(entry.displayName);
    const category = normalizeFilterSearchText(entry.category);
    return {
      entry,
      name,
      nameWords: name.split(" ").filter(Boolean),
      category,
      categoryWords: category.split(" ").filter(Boolean),
      description: normalizeFilterSearchText(entry.description || ""),
      keywords: normalizeFilterSearchText(entry.keywords || ""),
      order,
    };
  });

export const searchFilterIndex = <T extends FilterSearchSource>(
  index: readonly FilterSearchRecord<T>[],
  query: string,
  limit = 48,
): FilterSearchResult<T> => {
  const normalizedQuery = normalizeFilterSearchText(query);
  if (!normalizedQuery) return { items: [], total: 0 };

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const scored = index.flatMap((record) => {
    let score = 0;
    for (const token of tokens) {
      const tokenScore = bestTokenScore(record, token);
      if (!Number.isFinite(tokenScore)) return [];
      score += tokenScore;
    }

    if (record.name === normalizedQuery) score -= 100;
    else if (record.name.startsWith(normalizedQuery)) score -= 45;
    else if (record.name.includes(normalizedQuery)) score -= 24;
    else if (record.category === normalizedQuery) score -= 12;

    score += Math.min(8, record.name.length / 20);
    return [{ record, score }];
  });

  scored.sort((a, b) =>
    a.score - b.score ||
    a.record.name.localeCompare(b.record.name) ||
    a.record.order - b.record.order
  );

  return {
    items: scored.slice(0, Math.max(0, limit)).map(({ record }) => record.entry),
    total: scored.length,
  };
};
