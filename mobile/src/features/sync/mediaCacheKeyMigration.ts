type MediaCursorState = { media_cache_key_version: number; media_download_cursor: number };

export async function prepareAccountScopedMediaCache(
  db: {
    getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
    runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  },
  accountId: string,
): Promise<boolean> {
  const state = await db.getFirstAsync<MediaCursorState>(
    "SELECT media_cache_key_version,media_download_cursor FROM sync_metadata WHERE account_id=?",
    accountId,
  );
  if (!state || state.media_cache_key_version >= 1) return false;
  await db.runAsync(
    `UPDATE sync_metadata SET media_download_cursor=0,media_cache_key_version=1,updated_at=?
     WHERE account_id=? AND media_cache_key_version<1`,
    new Date().toISOString(),
    accountId,
  );
  return true;
}
