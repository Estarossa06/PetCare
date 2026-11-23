import { ApiClientError } from "./apiClient";

export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "REGISTRATION_FAILED":
        return "No se pudo crear una cuenta con los datos proporcionados.";
      case "INVALID_CREDENTIALS":
        return "El correo o la contraseña no son correctos.";
      case "INVALID_REFRESH_TOKEN":
        return "La sesión expiró. Inicia sesión nuevamente.";
      case "VALIDATION_ERROR":
        return "Revisa el correo y el nombre; la contraseña debe tener entre 12 y 128 caracteres.";
      default:
        return error.status >= 500
          ? "El servicio de PetCare no pudo completar la solicitud. Inténtalo más tarde."
          : "No se pudo completar la solicitud. Revisa los datos e inténtalo nuevamente.";
    }
  }

  if (error instanceof TypeError) {
    return "No se pudo conectar con PetCare. Comprueba tu conexión e inténtalo nuevamente.";
  }

  if (error instanceof Error) {
    if (error.message.includes("EXPO_PUBLIC_API_URL")) {
      return "La conexión con el servicio de PetCare no está configurada.";
    }
    if (error.message === "Stored authentication data is invalid.") {
      return "La sesión guardada no es válida. Inicia sesión nuevamente.";
    }
    if (error.message === "Session storage is unavailable in this browser.") {
      return "Este navegador no permite guardar la sesión temporal.";
    }
  }

  return "No se pudo completar la solicitud. Inténtalo nuevamente.";
}
