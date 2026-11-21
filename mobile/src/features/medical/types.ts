export const medicalCategories = [
  "consultation",
  "vaccination",
  "deworming",
  "medication",
  "treatment",
  "surgery",
  "allergy",
  "diagnosis",
  "examination",
  "observation",
] as const;

export type MedicalCategory = (typeof medicalCategories)[number];

export type MedicalDetails = {
  medicationName?: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  vaccineName?: string;
  applicationDate?: string;
  nextDoseDate?: string;
  dewormingProduct?: string;
  nextApplicationDate?: string;
  consultationReason?: string;
  recommendations?: string;
  procedure?: string;
  postoperativeObservations?: string;
  examType?: string;
  examResults?: string;
};

export type MedicalRecord = {
  id: string;
  owner_id: string;
  pet_id: string;
  category: MedicalCategory;
  title: string;
  description: string | null;
  occurred_at: string;
  professional_name: string | null;
  clinic_name: string | null;
  observations: string | null;
  details: MedicalDetails;
  next_event_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MedicalRecordInput = {
  category: MedicalCategory;
  title: string;
  description: string;
  occurredAt: string;
  professionalName: string;
  clinicName: string;
  observations: string;
  details: MedicalDetails;
};

export type MedicalAttachment = {
  id: string;
  owner_id: string;
  pet_id: string;
  health_record_id: string;
  storage_key: string;
  local_uri: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PickedMedicalFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export type PreparedMedicalFile = PickedMedicalFile & {
  id: string;
  storageKey: string;
};
