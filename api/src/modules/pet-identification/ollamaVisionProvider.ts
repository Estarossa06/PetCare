import type { PetIdentificationResult, PetVisionProvider } from "./types.js";
import type { PetVisionConfig } from "./config.js";

function parseEstimate(value: unknown): { value: string | null; confidence: number | null } {
  if (typeof value === "string") return { value: value.trim() ? value.trim().slice(0, 240) : null, confidence: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, confidence: null };
  const item = value as Record<string, unknown>;
  const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1 ? item.confidence : null;
  return { value: typeof item.value === "string" && item.value.trim() ? item.value.trim().slice(0, 240) : null, confidence };
}

export class OllamaPetVisionProvider implements PetVisionProvider {
  constructor(private readonly config: PetVisionConfig, private readonly fetcher: typeof fetch = fetch) {}

  async identify(image: { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string }): Promise<PetIdentificationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ model: this.config.model, stream: false, format: "json", options: { temperature: 0.1, num_predict: 450 },
          messages: [{ role: "user", content: "Analiza los animales visibles en esta fotografía y responde únicamente un objeto JSON válido con estas claves: animalDetected (boolean o null); species, breed, approximateAge, weightKg, size, coatColor, traits (cada uno un objeto {value: string|null, confidence: number|null}, confidence entre 0 y 1); uncertainty (texto breve). Escribe todos los valores y uncertainty en español. Usa nombres comunes en español para la especie (perro, gato, ave, conejo, etc.). Si ves un perro, species.value debe ser perro; si ves un gato, debe ser gato. No dejes species en null solo porque la raza no sea clara. Para todo perro o gato visible, breed.value debe contener la mejor estimación visual de raza; no lo dejes null por baja confianza. Si no puedes distinguir una raza concreta, usa una descripción honesta y amplia como 'perro mestizo', 'gato doméstico de pelo corto' o 'raza no distinguible visualmente', indicando baja confianza. No afirmes un pedigree preciso solo por la apariencia. Aproxima approximateAge como rango en español, por ejemplo '4–8 meses' o '2–4 años'; nunca calcules una fecha de nacimiento. Estima weightKg en kilogramos como rango amplio y prudente según el tamaño corporal visible, por ejemplo '2–4 kg'; considera que el tamaño aparente no revela el peso real, usa baja confianza y null si no hay base visual suficiente. Describe size, coatColor y traits en español. No inventes datos no visibles. En los demás campos usa null y baja confianza si hay incertidumbre. Si no hay un animal visible, usa animalDetected false y deja todas las estimaciones en null. Devuelve solo JSON, sin Markdown ni texto adicional.", images: [image.data] }] }),
      });
      if (!response.ok) throw new Error("El servicio visual local no está disponible.");
      const body: unknown = await response.json();
      const content = body && typeof body === "object" && "message" in body && (body as { message?: { content?: unknown } }).message?.content;
      if (typeof content !== "string") throw new Error("El modelo visual devolvió una respuesta inválida.");
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("El modelo visual devolvió una respuesta inválida.");
      const record = parsed as Record<string, unknown>;
      return { animalDetected: typeof record.animalDetected === "boolean" ? record.animalDetected : null,
        species: parseEstimate(record.species), breed: parseEstimate(record.breed), approximateAge: parseEstimate(record.approximateAge), weightKg: parseEstimate(record.weightKg),
        size: parseEstimate(record.size), coatColor: parseEstimate(record.coatColor), traits: parseEstimate(record.traits),
        uncertainty: typeof record.uncertainty === "string" ? record.uncertainty.slice(0, 500) : "La estimación visual puede ser inexacta." };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw Object.assign(new Error("El análisis visual agotó el tiempo de espera."), { statusCode: 504, code: "VISION_TIMEOUT" });
      if (error instanceof SyntaxError) throw Object.assign(new Error("El modelo visual devolvió un resultado no interpretable."), { statusCode: 503, code: "VISION_INVALID_RESPONSE" });
      throw error;
    } finally { clearTimeout(timeout); }
  }
}
