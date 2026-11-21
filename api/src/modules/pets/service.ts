import { InvalidPetRequestError, PetNotFoundError } from "./errors.js";
import type {
  CreatePetInput,
  PetFilters,
  PetRepository,
  UpdatePetInput,
} from "./types.js";

export class PetService {
  constructor(private readonly repository: PetRepository) {}

  list(ownerId: string, filters: PetFilters) {
    return this.repository.list(ownerId, filters);
  }

  async getById(ownerId: string, petId: string) {
    const pet = await this.repository.findById(ownerId, petId);
    if (!pet) throw new PetNotFoundError();
    return pet;
  }

  async create(ownerId: string, input: CreatePetInput) {
    assertBirthDateAndAge(input.birthDate ?? null, input.approximateAgeMonths ?? null);
    return this.repository.create(ownerId, input);
  }

  async update(ownerId: string, petId: string, input: UpdatePetInput) {
    const existing = await this.repository.findById(ownerId, petId);
    if (!existing) throw new PetNotFoundError();

    const patch = { ...input };
    if (patch.birthDate != null && patch.approximateAgeMonths == null) {
      patch.approximateAgeMonths = null;
    } else if (
      patch.approximateAgeMonths != null &&
      patch.birthDate == null
    ) {
      patch.birthDate = null;
    }

    const nextBirthDate =
      patch.birthDate === undefined ? existing.birth_date : patch.birthDate;
    const nextAge =
      patch.approximateAgeMonths === undefined
        ? existing.approximate_age_months
        : patch.approximateAgeMonths;
    assertBirthDateAndAge(nextBirthDate, nextAge);

    const updated = await this.repository.update(ownerId, petId, patch);
    if (!updated) throw new PetNotFoundError();
    return updated;
  }

  async delete(ownerId: string, petId: string): Promise<void> {
    if (!(await this.repository.softDelete(ownerId, petId))) {
      throw new PetNotFoundError();
    }
  }
}

function assertBirthDateAndAge(
  birthDate: string | null,
  approximateAgeMonths: number | null,
): void {
  if (birthDate !== null && approximateAgeMonths !== null) {
    throw new InvalidPetRequestError(
      "Provide birthDate or approximateAgeMonths, not both.",
    );
  }
}
