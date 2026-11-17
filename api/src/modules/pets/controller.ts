import type { RequestHandler } from "express";
import { requirePrincipal } from "../auth/middleware/authenticate.js";
import { PetService } from "./service.js";
import {
  validateCreatePet,
  validatePetId,
  validatePetListQuery,
  validateUpdatePet,
} from "./validation.js";

export class PetController {
  constructor(private readonly service: PetService) {}

  readonly list: RequestHandler = async (request, response, next) => {
    try {
      const filters = validatePetListQuery(request.query);
      response
        .status(200)
        .json(await this.service.list(requirePrincipal(request).userId, filters));
    } catch (error) {
      next(error);
    }
  };

  readonly getById: RequestHandler = async (request, response, next) => {
    try {
      const petId = validatePetId(request.params.petId);
      const pet = await this.service.getById(
        requirePrincipal(request).userId,
        petId,
      );
      response.status(200).json({ pet });
    } catch (error) {
      next(error);
    }
  };

  readonly create: RequestHandler = async (request, response, next) => {
    try {
      const input = validateCreatePet(request.body);
      const pet = await this.service.create(
        requirePrincipal(request).userId,
        input,
      );
      response.status(201).json({ pet });
    } catch (error) {
      next(error);
    }
  };

  readonly update: RequestHandler = async (request, response, next) => {
    try {
      const petId = validatePetId(request.params.petId);
      const input = validateUpdatePet(request.body);
      const pet = await this.service.update(
        requirePrincipal(request).userId,
        petId,
        input,
      );
      response.status(200).json({ pet });
    } catch (error) {
      next(error);
    }
  };

  readonly delete: RequestHandler = async (request, response, next) => {
    try {
      const petId = validatePetId(request.params.petId);
      await this.service.delete(requirePrincipal(request).userId, petId);
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  };
}
