export const DATA_SYNC_PATH = "/app/admin/sync";

export function getDataSyncPath(search = "") {
  if (!search) {
    return DATA_SYNC_PATH;
  }

  return `${DATA_SYNC_PATH}${search.startsWith("?") ? search : `?${search}`}`;
}
