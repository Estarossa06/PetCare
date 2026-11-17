export class InvalidPetRequestError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_REQUEST";

  constructor(message: string) {
    super(message);
    this.name = "InvalidPetRequestError";
  }
}

export class PetNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "PET_NOT_FOUND";

  constructor() {
    super("Pet not found.");
    this.name = "PetNotFoundError";
  }
}
