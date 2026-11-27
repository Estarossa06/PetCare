import type { RequestHandler, Response } from "express";
import { requirePrincipal } from "./middleware/authenticate.js";
import { AuthService } from "./service.js";
import {
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidRequestError,
} from "./errors.js";

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    error: {
      code,
      message,
      requestId: String(response.getHeader("X-Request-Id") ?? ""),
    },
  });
}

function handleValidationError(error: unknown, response: Response): boolean {
  if (!(error instanceof InvalidRequestError)) return false;
  sendError(response, 400, error.code, error.message);
  return true;
}

export class AuthController {
  constructor(private readonly service: AuthService) {}

  readonly register: RequestHandler = async (request, response, next) => {
    try {
      response.status(201).json(await this.service.register(request.body));
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        sendError(
          response,
          409,
          "REGISTRATION_FAILED",
          "Unable to create an account with the provided details.",
        );
      } else if (!handleValidationError(error, response)) {
        next(error);
      }
    }
  };

  readonly login: RequestHandler = async (request, response, next) => {
    try {
      response.status(200).json(await this.service.login(request.body));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        sendError(response, 401, "INVALID_CREDENTIALS", error.message);
      } else if (!handleValidationError(error, response)) {
        next(error);
      }
    }
  };

  readonly refresh: RequestHandler = async (request, response, next) => {
    try {
      response.status(200).json(await this.service.refresh(request.body?.refreshToken));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        sendError(
          response,
          401,
          "INVALID_REFRESH_TOKEN",
          "Refresh token is invalid or expired.",
        );
      } else if (!handleValidationError(error, response)) {
        next(error);
      }
    }
  };

  readonly currentUser: RequestHandler = async (request, response, next) => {
    try {
      const user = await this.service.getUser(requirePrincipal(request).userId);
      if (!user) {
        sendError(response, 401, "UNAUTHENTICATED", "Authentication is required.");
        return;
      }
      response.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

  readonly updateProfile: RequestHandler = async (request, response, next) => {
    try {
      const user = await this.service.updateProfile(requirePrincipal(request).userId, request.body);
      response.status(200).json({ user });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        sendError(response, 401, "INVALID_CREDENTIALS", "The current password is incorrect.");
      } else if (handleValidationError(error, response)) {
        return;
      } else if (error instanceof DuplicateEmailError) {
        sendError(response, 409, "EMAIL_ALREADY_IN_USE", "This email is already in use.");
      } else next(error);
    }
  };

  readonly changePassword: RequestHandler = async (request, response, next) => {
    try {
      await this.service.changePassword(requirePrincipal(request), request.body);
      response.sendStatus(204);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        sendError(response, 401, "INVALID_CREDENTIALS", "The current password is incorrect.");
      } else if (!handleValidationError(error, response)) next(error);
    }
  };

  readonly deactivateAccount: RequestHandler = async (request, response, next) => {
    try {
      await this.service.deactivateAccount(requirePrincipal(request), request.body);
      response.sendStatus(204);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        sendError(response, 401, "INVALID_CREDENTIALS", "The current password is incorrect.");
      } else if (!handleValidationError(error, response)) next(error);
    }
  };

  readonly requestPermanentDeletion: RequestHandler = async (request, response, next) => {
    try {
      await this.service.requestPermanentDeletion(requirePrincipal(request), request.body);
      response.status(202).json({ status: "pending_permanent_deletion" });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        sendError(response, 401, "INVALID_CREDENTIALS", "The current password is incorrect.");
      } else if (!handleValidationError(error, response)) next(error);
    }
  };

  readonly logout: RequestHandler = async (request, response, next) => {
    try {
      await this.service.logout(requirePrincipal(request));
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  };
}
