import type { PoolClient } from "pg";

export interface Migration {
  version: number;
  name: string;
  up(client: PoolClient): Promise<void>;
}
