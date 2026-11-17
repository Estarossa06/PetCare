import type { QueryResultRow } from "pg";
import type { Queryable } from "../../db/queryable.js";
import type {
  CreatePetInput,
  Pet,
  PetFields,
  PetFilters,
  PetPage,
  PetRepository,
  UpdatePetInput,
} from "./types.js";

interface PetRow extends QueryResultRow {
  id: string;
  owner_id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: Pet["sex"];
  birth_date: string | Date | null;
  approximate_age_months: number | null;
  weight_kg: string | null;
  color: string | null;
  notes: string | null;
  photo_storage_key: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const petColumns = `
  id, owner_id, name, species, breed, sex, birth_date,
  approximate_age_months, weight_kg, color, notes, photo_storage_key,
  version, created_at, updated_at, deleted_at
`;

const inputColumns: Record<keyof PetFields, string> = {
  name: "name",
  species: "species",
  breed: "breed",
  sex: "sex",
  birthDate: "birth_date",
  approximateAgeMonths: "approximate_age_months",
  weightKg: "weight_kg",
  color: "color",
  notes: "notes",
  photoStorageKey: "photo_storage_key",
};

function toPet(row: PetRow): Pet {
  return {
    ...row,
    birth_date: toDateOnly(row.birth_date),
    weight_kg: row.weight_kg === null ? null : Number(row.weight_kg),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    deleted_at: row.deleted_at?.toISOString() ?? null,
  };
}

function toDateOnly(value: string | Date | null): string | null {
  if (value === null || typeof value === "string") return value;
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function filterClause(
  ownerId: string,
  filters: PetFilters,
): { clause: string; values: unknown[] } {
  const conditions = ["owner_id = $1", "deleted_at IS NULL"];
  const values: unknown[] = [ownerId];

  if (filters.species) {
    values.push(filters.species);
    conditions.push(`species = $${values.length}`);
  }
  if (filters.search) {
    values.push(filters.search.toLowerCase());
    const parameter = `$${values.length}`;
    conditions.push(
      `(strpos(lower(name), ${parameter}) > 0
        OR strpos(lower(coalesce(breed, '')), ${parameter}) > 0
        OR strpos(lower(species), ${parameter}) > 0)`,
    );
  }

  return { clause: conditions.join(" AND "), values };
}

export class PostgresPetRepository implements PetRepository {
  constructor(private readonly database: Queryable) {}

  async list(ownerId: string, filters: PetFilters): Promise<PetPage> {
    const { clause, values } = filterClause(ownerId, filters);
    const [itemsResult, countResult] = await Promise.all([
      this.database.query<PetRow>(
        `SELECT ${petColumns}
         FROM pets
         WHERE ${clause}
         ORDER BY lower(name), id
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, filters.offset],
      ),
      this.database.query<{ total: string } & QueryResultRow>(
        `SELECT count(*)::text AS total FROM pets WHERE ${clause}`,
        values,
      ),
    ]);

    return {
      pets: itemsResult.rows.map(toPet),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: Number(countResult.rows[0]?.total ?? 0),
      },
    };
  }

  async findById(ownerId: string, petId: string): Promise<Pet | undefined> {
    const result = await this.database.query<PetRow>(
      `SELECT ${petColumns}
       FROM pets
       WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [ownerId, petId],
    );
    return result.rows[0] ? toPet(result.rows[0]) : undefined;
  }

  async create(ownerId: string, input: CreatePetInput): Promise<Pet> {
    const result = await this.database.query<PetRow>(
      `INSERT INTO pets
        (owner_id, name, species, breed, sex, birth_date, approximate_age_months,
         weight_kg, color, notes, photo_storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${petColumns}`,
      [
        ownerId,
        input.name,
        input.species,
        input.breed ?? null,
        input.sex ?? null,
        input.birthDate ?? null,
        input.approximateAgeMonths ?? null,
        input.weightKg ?? null,
        input.color ?? null,
        input.notes ?? null,
        input.photoStorageKey ?? null,
      ],
    );
    return toPet(result.rows[0]);
  }

  async update(
    ownerId: string,
    petId: string,
    input: UpdatePetInput,
  ): Promise<Pet | undefined> {
    const values: unknown[] = [ownerId, petId];
    const assignments: string[] = [];

    for (const key of Object.keys(input) as (keyof UpdatePetInput)[]) {
      const column = inputColumns[key];
      values.push(input[key]);
      assignments.push(`${column} = $${values.length}`);
    }
    if (assignments.length === 0) return this.findById(ownerId, petId);

    const result = await this.database.query<PetRow>(
      `UPDATE pets
       SET ${assignments.join(", ")}, version = version + 1, updated_at = now()
       WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING ${petColumns}`,
      values,
    );
    return result.rows[0] ? toPet(result.rows[0]) : undefined;
  }

  async softDelete(ownerId: string, petId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE pets
       SET deleted_at = now(), updated_at = now(), version = version + 1
       WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [ownerId, petId],
    );
    return result.rows.length > 0;
  }
}
