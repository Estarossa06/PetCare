import { Router, type Request, type Response } from "express";
import type { Queryable } from "../../db/queryable.js";
import type { AuthStore } from "../auth/types.js";
import { createAuthenticateMiddleware, requirePrincipal } from "../auth/middleware/authenticate.js";
import { PetNotFoundError } from "./errors.js";
import { PetService } from "./service.js";
import {
  loadTraccarConfig,
  TraccarClient,
  TraccarDeviceOwnershipError,
  TraccarUnavailableError,
} from "./traccarClient.js";

type TrackerConfig = { device_id: number; safe_radius_m: number; home_lat: number | null; home_lon: number | null };
const petIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function calculateDistanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * radians;
  const longitudeDelta = (longitudeB - longitudeA) * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA * radians) * Math.cos(latitudeB * radians) * Math.sin(longitudeDelta / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, haversine));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}

function unavailable(response: Response): void {
  response.status(503).json({ error: { code: "TRACKING_UNAVAILABLE", message: "El servicio de rastreo no está disponible en este momento." } });
}

function deviceNotOwned(response: Response): void {
  response.status(404).json({ error: { code: "TRACKING_DEVICE_NOT_FOUND", message: "No se encontró un dispositivo de rastreo autorizado para esta mascota." } });
}

async function ownedPet(request: Request, response: Response, service: PetService): Promise<boolean> {
  const id = request.params.petId;
  if (typeof id !== "string" || !petIdPattern.test(id)) {
    response.status(400).json({ error: { code: "INVALID_PET_ID", message: "El identificador de la mascota no es válido." } });
    return false;
  }
  try {
    await service.getById(requirePrincipal(request).userId, id);
    return true;
  } catch (error) {
    if (error instanceof PetNotFoundError) response.status(404).json({ error: { code: "PET_NOT_FOUND", message: "No se encontró esta mascota." } });
    else response.status(500).json({ error: { code: "TRACKING_UNAVAILABLE", message: "No se pudo consultar el rastreo." } });
    return false;
  }
}

export function createTrackingRouter(db: Queryable, service: PetService, auth: AuthStore, secret: Uint8Array): Router {
  const router = Router();
  router.use(createAuthenticateMiddleware(auth, secret));

  router.get("/:petId", async (request, response) => {
    if (!(await ownedPet(request, response, service))) return;
    try {
      const result = await db.query<TrackerConfig & Record<string, unknown>>(
        "SELECT device_id,safe_radius_m,home_lat,home_lon FROM pet_trackers WHERE pet_id=$1",
        [request.params.petId],
      );
      const config = result.rows[0];
      if (!config) {
        response.json({ configured: false });
        return;
      }

      let traccarConfig;
      try { traccarConfig = loadTraccarConfig(); } catch { unavailable(response); return; }
      if (!traccarConfig) {
        response.json({ configured: true, config, available: false, reason: "El servicio de rastreo no está configurado." });
        return;
      }

      const ownerId = requirePrincipal(request).userId;
      let position;
      try {
        position = await new TraccarClient(traccarConfig).getLatestPosition(Number(config.device_id), ownerId);
      } catch (error) {
        if (error instanceof TraccarDeviceOwnershipError) { deviceNotOwned(response); return; }
        if (error instanceof TraccarUnavailableError) { unavailable(response); return; }
        unavailable(response);
        return;
      }
      if (!position) {
        response.json({ configured: true, config, available: false, reason: "El dispositivo todavía no ha enviado una posición." });
        return;
      }

      const homeDistance = config.home_lat === null || config.home_lon === null
        ? null
        : calculateDistanceMeters(Number(config.home_lat), Number(config.home_lon), position.latitude, position.longitude);
      response.json({
        configured: true,
        config,
        available: true,
        position,
        distanceFromHomeM: homeDistance,
        outsideSafeZone: homeDistance === null ? null : homeDistance > Number(config.safe_radius_m),
      });
    } catch {
      unavailable(response);
    }
  });

  router.put("/:petId", async (request, response) => {
    if (!(await ownedPet(request, response, service))) return;
    const body = request.body;
    const deviceId = body?.deviceId;
    const safeRadiusM = body?.safeRadiusM ?? 1_000;
    const homeLat = body?.homeLat ?? null;
    const homeLon = body?.homeLon ?? null;
    if (!Number.isSafeInteger(deviceId) || deviceId <= 0 || !Number.isInteger(safeRadiusM) || safeRadiusM < 100 || safeRadiusM > 1_000 ||
      ((homeLat === null) !== (homeLon === null)) ||
      (homeLat !== null && (typeof homeLat !== "number" || !Number.isFinite(homeLat) || Math.abs(homeLat) > 90 || typeof homeLon !== "number" || !Number.isFinite(homeLon) || Math.abs(homeLon) > 180))) {
      response.status(400).json({ error: { code: "INVALID_TRACKER_CONFIG", message: "Revisa el ID del dispositivo, el radio y las coordenadas." } });
      return;
    }

    let traccarConfig;
    try { traccarConfig = loadTraccarConfig(); } catch { unavailable(response); return; }
    if (!traccarConfig) { unavailable(response); return; }
    try {
      const ownerId = requirePrincipal(request).userId;
      await new TraccarClient(traccarConfig).assertDeviceOwnedBy(deviceId, ownerId);
    } catch (error) {
      if (error instanceof TraccarDeviceOwnershipError) { deviceNotOwned(response); return; }
      unavailable(response);
      return;
    }

    try {
      await db.query(
        `INSERT INTO pet_trackers(pet_id,device_id,safe_radius_m,home_lat,home_lon)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(pet_id) DO UPDATE SET device_id=$2,safe_radius_m=$3,home_lat=$4,home_lon=$5`,
        [request.params.petId, deviceId, safeRadiusM, homeLat, homeLon],
      );
      response.json({ configured: true });
    } catch {
      unavailable(response);
    }
  });

  router.delete("/:petId", async (request, response) => {
    if (!(await ownedPet(request, response, service))) return;
    try {
      await db.query("DELETE FROM pet_trackers WHERE pet_id=$1", [request.params.petId]);
      response.sendStatus(204);
    } catch {
      unavailable(response);
    }
  });

  return router;
}
