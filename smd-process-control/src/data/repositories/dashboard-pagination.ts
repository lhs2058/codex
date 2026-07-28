export const DASHBOARD_PAGE_SIZE = 1000;
export const DASHBOARD_ID_CHUNK_SIZE = 100;

export interface PaginatedQuery<T> extends PromiseLike<{ data: T[] | null; error: { message?: string } | null }> {
  order(column: string, options?: { ascending?: boolean }): PaginatedQuery<T>;
  range(from: number, to: number): PaginatedQuery<T>;
}

export async function readAllPages<T>(
  createQuery: () => PaginatedQuery<T>,
  fallbackError: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += DASHBOARD_PAGE_SIZE) {
    const result = await createQuery()
      .order("id", { ascending: true })
      .range(from, from + DASHBOARD_PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message ?? fallbackError);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < DASHBOARD_PAGE_SIZE) return rows;
  }
}

export function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let from = 0; from < ids.length; from += DASHBOARD_ID_CHUNK_SIZE) {
    chunks.push(ids.slice(from, from + DASHBOARD_ID_CHUNK_SIZE));
  }
  return chunks;
}
