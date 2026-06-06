export function getLimit(limit?: number, fallback = 20) {
  return Math.min(Math.max(limit ?? fallback, 1), 50);
}

export function paginateByCursor<T extends { id: string }>(
  items: T[],
  limit: number,
  cursor?: string,
) {
  const startIndex = cursor
    ? Math.max(
        items.findIndex((item) => item.id === cursor) + 1,
        0,
      )
    : 0;
  const pageItems = items.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < items.length ? pageItems.at(-1)?.id ?? null : null;

  return { items: pageItems, nextCursor };
}

