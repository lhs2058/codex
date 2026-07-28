export const DASHBOARD_PAGE_SIZE = 1000;
export const DASHBOARD_ID_CHUNK_SIZE = 100;

export interface PaginatedQuery<T> extends PromiseLike<{ data: T[] | null; error: { message?: string } | null }> {
  order(column: string, options?: { ascending?: boolean }): PaginatedQuery<T>;
  range(from: number, to: number): PaginatedQuery<T>;
}

export async function readAllPages<T>(
  createQuery: () => PaginatedQuery<T>,
  fallbackError: string,
  keyOf: (row: T) => string,
): Promise<T[]> {
  const rows = new Map<string, T>();
  for (let from = 0; ; from += DASHBOARD_PAGE_SIZE) {
    const result = await createQuery()
      .order("id", { ascending: true })
      .range(from, from + DASHBOARD_PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message ?? fallbackError);
    const page = result.data ?? [];
    for (const row of page) rows.set(keyOf(row), row);
    if (page.length < DASHBOARD_PAGE_SIZE) return [...rows.values()];
  }
}

export function chunkIds(ids: string[]): string[][] {
  const uniqueIds = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let from = 0; from < uniqueIds.length; from += DASHBOARD_ID_CHUNK_SIZE) {
    chunks.push(uniqueIds.slice(from, from + DASHBOARD_ID_CHUNK_SIZE));
  }
  return chunks;
}
