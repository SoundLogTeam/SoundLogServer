export function dataResponse<T>(data: T) {
  return { data };
}

export function pagedResponse<T>(
  data: T[],
  page: { limit: number; nextCursor?: string | null },
) {
  return {
    data,
    page: {
      limit: page.limit,
      nextCursor: page.nextCursor ?? null,
    },
  };
}

export function acceptedResponse() {
  return { data: { accepted: true } };
}

