export const DEFAULT_SUPABASE_PAGE_SIZE = 1000;

const PAGE_FETCH_MAX_ATTEMPTS = 4;
const PAGE_FETCH_RETRY_DELAYS_MS = [250, 750, 2000];

type PageError = {
  message: string;
};

type PageResult<T> = {
  data: T[] | null;
  error: PageError | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Transient network hiccups between the app and Supabase's REST API (e.g.
// "TypeError: fetch failed") surface as a resolved {error} here rather than a
// rejected promise, and are indistinguishable in shape from a genuine query
// error. Retrying a few times with backoff absorbs the transient case; a real
// query error still fails the same way after retries exhaust.
async function fetchPageWithRetry<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  from: number,
  to: number,
): Promise<PageResult<T>> {
  let lastResult: PageResult<T> | undefined;

  for (let attempt = 0; attempt < PAGE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      lastResult = await fetchPage(from, to);
    } catch (thrown) {
      lastResult = {
        data: null,
        error: {
          message: thrown instanceof Error ? thrown.message : String(thrown),
        },
      };
    }

    if (!lastResult.error) return lastResult;
    if (attempt < PAGE_FETCH_MAX_ATTEMPTS - 1) {
      await sleep(PAGE_FETCH_RETRY_DELAYS_MS[attempt]);
    }
  }

  return lastResult as PageResult<T>;
}

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
    const { data, error } = await fetchPageWithRetry(
      fetchPage,
      from,
      from + pageSize - 1,
    );

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
