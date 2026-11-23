import type { RequestHandler } from "express";

export const requireJsonBody: RequestHandler = (request, _response, next) => {
  const hasBody =
    request.get("Content-Length") !== undefined ||
    request.get("Transfer-Encoding") !== undefined;
  if (hasBody && !request.is("application/json")) {
    next(
      Object.assign(new Error("Request body must use application/json."), {
        statusCode: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
      }),
    );
    return;
  }
  next();
};
