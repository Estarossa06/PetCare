export interface SqliteExecutor {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: (string | number | null)[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T | null>;
}

export interface SqliteMigration {
  version: number;
  name: string;
  up(db: SqliteExecutor): Promise<void>;
}
