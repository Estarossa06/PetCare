export type PetSex = "female" | "male" | "unknown";

export interface Pet {
  id: string;
  owner_id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: PetSex | null;
  birth_date: string | null;
  approximate_age_months: number | null;
  weight_kg: number | null;
  color: string | null;
  notes: string | null;
  photo_storage_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PetFields {
  name: string;
  species: string;
  breed: string | null;
  sex: PetSex | null;
  birthDate: string | null;
  approximateAgeMonths: number | null;
  weightKg: number | null;
  color: string | null;
  notes: string | null;
  photoStorageKey: string | null;
}

export type CreatePetInput = Pick<PetFields, "name" | "species"> &
  Partial<Omit<PetFields, "name" | "species">>;
export type UpdatePetInput = Partial<PetFields>;

export interface PetFilters {
  search?: string;
  species?: string;
  limit: number;
  offset: number;
}

export interface PetPage {
  pets: Pet[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface PetRepository {
  list(ownerId: string, filters: PetFilters): Promise<PetPage>;
  findById(ownerId: string, petId: string): Promise<Pet | undefined>;
  create(ownerId: string, input: CreatePetInput): Promise<Pet>;
  update(
    ownerId: string,
    petId: string,
    input: UpdatePetInput,
  ): Promise<Pet | undefined>;
  softDelete(ownerId: string, petId: string): Promise<boolean>;
}
