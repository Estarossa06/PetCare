import type { QueryResultRow } from "pg";

export interface SyncClient {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  release(): void;
}

export interface SyncPool {
  connect(): Promise<SyncClient>;
}

export interface SyncQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export type PetSyncPayload = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: "female" | "male" | "unknown" | null;
  birth_date: string | null;
  approximate_age_months: number | null;
  weight_kg: number | null;
  color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export interface PetSyncOperation {
  operation_id: string;
  entity_type: "pet";
  entity_id: string;
  action: "create" | "update" | "delete";
  base_version: number;
  local_revision: number;
  depends_on: string[];
  changed_fields: string[];
  payload: PetSyncPayload;
}

export interface SyncOperationResult {
  operation_id: string;
  status: "applied" | "already_applied" | "conflict" | "rejected" | "dependency_blocked";
  entity_type: "pet";
  entity_id: string;
  server_version?: number;
  server_updated_at?: string;
  cursor?: string;
  request_hash?: string;
  server_snapshot?: PetSyncPayload | null;
  code?: string;
  message?: string;
}

export interface PetSyncChange extends PetSyncPayload {
  entity_type: "pet";
  entity_version: number;
  change_type: "upsert" | "delete";
  cursor: string;
}
