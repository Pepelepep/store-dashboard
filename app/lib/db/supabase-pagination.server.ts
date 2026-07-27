export const DEFAULT_SUPABASE_PAGE_SIZE = 1000;

type PageError = {
  message: string;
};

type PageResult<T> = {
  data: T[] | null;
  error: PageError | null;
};

export async function fetchAllSupabasePages<T>({
  fetchPage,
  getRowKey,
  label,
  pageSize = DEFAULT_SUPABASE_PAGE_SIZE,
}: {
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>;
  getRowKey: (row: T) => string;
  label: string;
  pageSize?: number;
}) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Supabase page size must be a positive integer.");
  }

  const rows: T[] = [];
  const seenRowKeys = new Set<string>();

  for (let from = 0; ; from += pageSize) {
    const pageNumber = Math.floor(from / pageSize) + 1;
    const { data, error } = await fetchPage(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `${label} page ${pageNumber} could not be loaded: ${error.message}`,
      );
    }

    const pageRows = data ?? [];

    for (const row of pageRows) {
      const rowKey = getRowKey(row);

      if (!rowKey || seenRowKeys.has(rowKey)) {
        throw new Error(
          `${label} pagination returned an invalid or duplicate stable row key.`,
        );
      }

      seenRowKeys.add(rowKey);
      rows.push(row);
    }

    if (pageRows.length < pageSize) {
      return rows;
    }
  }
}
