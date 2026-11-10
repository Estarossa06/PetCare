import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestIdMiddleware: RequestHandler = (_request, response, next) => {
  response.setHeader("X-Request-Id", randomUUID());
  next();
};
