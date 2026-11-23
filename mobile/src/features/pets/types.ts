export type PetSex = "female" | "male" | "unknown";

export type Pet = {
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
};

export type PetInput = {
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
};

export type PetFilters = {
  search?: string;
  species?: string;
};
