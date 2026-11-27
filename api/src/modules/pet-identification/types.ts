export interface PetVisualEstimate {
  value: string | null;
  confidence: number | null;
}

export interface PetIdentificationResult {
  animalDetected: boolean | null;
  species: PetVisualEstimate;
  breed: PetVisualEstimate;
  approximateAge: PetVisualEstimate;
  weightKg: PetVisualEstimate;
  size: PetVisualEstimate;
  coatColor: PetVisualEstimate;
  traits: PetVisualEstimate;
  uncertainty: string;
}

export interface PetVisionProvider {
  identify(image: { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string }): Promise<PetIdentificationResult>;
}
