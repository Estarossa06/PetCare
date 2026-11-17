import type {
  NotificationContentInput,
  NotificationRequest,
} from "expo-notifications";
import type { CalendarReminder } from "../types";

export type NotificationPlatform = "android" | "ios" | "web" | "unsupported";

export interface NotificationPermission {
  granted: boolean;
  canAskAgain: boolean;
}

export interface ScheduledNotificationState {
  reminder_id: string;
  operating_system_id: string | null;
  scheduled_version: number;
  scheduled_for: string | null;
  scheduling_status: CalendarReminder["scheduling_status"];
}

export interface CalendarNotificationStore {
  listReminders(): Promise<CalendarReminder[]>;
  listNotificationStates(): Promise<ScheduledNotificationState[]>;
  getNotificationId(reminderId: string): Promise<string | null>;
  setNotificationState(
    reminderId: string,
    state: CalendarReminder["scheduling_status"],
    error?: string | null,
  ): Promise<void>;
  setScheduledNotification(
    reminderId: string,
    operatingSystemId: string,
    version: number,
    scheduledFor: string,
  ): Promise<void>;
}

export interface CalendarNotificationPlatform {
  platform: NotificationPlatform;
  ensureAndroidChannel(): Promise<void>;
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  getExactAlarmPermission(): Promise<boolean>;
  schedule(request: {
    identifier: string;
    content: NotificationContentInput;
    triggerDate: Date;
    channelId?: string;
  }): Promise<string>;
  getScheduled(): Promise<NotificationRequest[]>;
  cancel(identifier: string): Promise<void>;
  openSettings(): Promise<void>;
}

export type ScheduleResult = CalendarReminder["scheduling_status"];
