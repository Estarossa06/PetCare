import type { Principal } from "./types.js";

export interface OwnedPet {
  id: string;
  name: string;
}

export interface OwnerScopedDatabase {
  query(text: string, values: unknown[]): Promise<{ rows: OwnedPet[] }>;
}

export class OwnerScopedQueries {
  constructor(private readonly pool: OwnerScopedDatabase) {}

  async findPet(principal: Principal, petId: string): Promise<OwnedPet | undefined> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        petId,
      )
    ) {
      return undefined;
    }
    const result = await this.pool.query(
      `SELECT id, name
       FROM pets
       WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [principal.userId, petId],
    );
    return result.rows[0];
  }
}
