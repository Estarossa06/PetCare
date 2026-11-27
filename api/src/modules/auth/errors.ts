export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

export class GoogleIdentityConflictError extends Error {
  constructor() {
    super("This Google identity cannot be linked to this account.");
    this.name = "GoogleIdentityConflictError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email or password is incorrect.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidRequestError extends Error {
  readonly statusCode = 400;
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}
