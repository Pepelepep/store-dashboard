export const DATA_SYNC_PATH = "/app/settings";

export function getDataSyncPath(search = "") {
  const searchParams = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  searchParams.set("tab", "sync");
  return `${DATA_SYNC_PATH}?${searchParams.toString()}`;
}
