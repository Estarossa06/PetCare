export const careCategories = [
  "feeding",
  "walk",
  "bath",
  "hygiene",
  "medication",
  "vaccination",
  "deworming",
  "exercise",
  "custom",
] as const;

export type CareCategory = (typeof careCategories)[number];
export type CareFrequency = "once" | "daily" | "weekly" | "monthly" | "custom";
export type RecurrenceUnit = "days" | "weeks" | "months";
export type ExecutionStatus = "completed" | "omitted" | "cancelled";

export type CareSchedule = {
  frequency: CareFrequency;
  interval: number;
  unit: RecurrenceUnit;
};

export type CareTask = {
  id: string;
  owner_id: string;
  pet_id: string;
  category: CareCategory;
  title: string;
  description: string | null;
  observations: string | null;
  notes: string | null;
  schedule: CareSchedule;
  timezone: string;
  starts_at: string;
  ends_at: string | null;
  next_run_at: string | null;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CareTaskInput = {
  category: CareCategory;
  title: string;
  description: string;
  observations: string;
  schedule: CareSchedule;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  enabled: boolean;
};

export type CareExecution = {
  id: string;
  owner_id: string;
  task_id: string;
  pet_id: string;
  scheduled_for: string;
  executed_at: string | null;
  status: ExecutionStatus;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
