import type { CalendarReminder } from "../types";
import { cancelReminderNotifications } from "./cancellation";
import {
  isCalendarNotification,
  reminderIdFromNotification,
  stableNotificationId,
} from "./ids";
import { resolveNotificationPermission } from "./permissions";
import type {
  CalendarNotificationPlatform,
  CalendarNotificationStore,
  ScheduleResult,
  ScheduledNotificationState,
} from "./types";

const genericScheduleError = "No se pudo programar la notificación local.";
const genericCancelError = "No se pudo cancelar la notificación local.";

function isActive(reminder: CalendarReminder): boolean {
  return reminder.status === "pending" &&
    reminder.enabled === 1 &&
    reminder.deleted_at === null;
}

function sameInstant(left: string | null, right: string): boolean {
  if (!left) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && leftTime === rightTime;
}

function hasCurrentSchedule(
  reminder: CalendarReminder,
  state: ScheduledNotificationState | undefined,
  requests: Awaited<ReturnType<CalendarNotificationPlatform["getScheduled"]>>,
): boolean {
  if (
    !state ||
    state.scheduling_status !== "scheduled" ||
    !state.operating_system_id ||
    state.scheduled_version !== reminder.version ||
    !sameInstant(state.scheduled_for, reminder.remind_at) ||
    requests.length !== 1
  ) {
    return false;
  }
  return requests[0].identifier === state.operating_system_id;
}

export function createCalendarNotificationManager(
  platform: CalendarNotificationPlatform,
  store: CalendarNotificationStore,
) {
  const inFlight = new Map<string, Promise<ScheduleResult | void>>();
  let reconciliation: Promise<void> | undefined;

  function exclusive<T extends ScheduleResult | void>(
    reminderId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = inFlight.get(reminderId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    inFlight.set(reminderId, current);
    return current.finally(() => {
      if (inFlight.get(reminderId) === current) {
        inFlight.delete(reminderId);
      }
    });
  }

  async function markInactive(
    reminder: CalendarReminder,
    state: "disabled" | "expired",
  ): Promise<ScheduleResult> {
    try {
      await cancelReminderNotifications(reminder.id, platform, store);
      await store.setNotificationState(reminder.id, state);
      return state;
    } catch {
      await store.setNotificationState(reminder.id, "failed", genericCancelError);
      return "failed";
    }
  }

  async function schedule(
    reminder: CalendarReminder,
    requestPermission: boolean,
  ): Promise<ScheduleResult> {
    if (platform.platform === "web" || platform.platform === "unsupported") {
      const state = isActive(reminder) ? "unsupported" : "disabled";
      await store.setNotificationState(reminder.id, state);
      return state;
    }
    if (!isActive(reminder)) return markInactive(reminder, "disabled");

    const timestamp = new Date(reminder.remind_at).getTime();
    if (!Number.isFinite(timestamp)) {
      await store.setNotificationState(reminder.id, "failed", genericScheduleError);
      return "failed";
    }
    if (timestamp <= Date.now()) return markInactive(reminder, "expired");

    try {
      const permission = await resolveNotificationPermission(
        platform.platform,
        platform,
        requestPermission,
      );
      if (!permission.granted) {
        await cancelReminderNotifications(reminder.id, platform, store);
        await store.setNotificationState(reminder.id, "denied");
        return "denied";
      }

      await cancelReminderNotifications(reminder.id, platform, store);
      const input = {
        identifier: stableNotificationId(reminder.id),
        content: {
          title: reminder.title,
          body: "Tienes un recordatorio de PetCare.",
          data: {
            notificationType: "petcare-calendar-reminder",
            reminderId: reminder.id,
          },
        },
        triggerDate: new Date(timestamp),
        ...(platform.platform === "android" ? { channelId: "petcare-calendar" } : {}),
      };
      const operatingSystemId = await platform.schedule(input);
      await store.setScheduledNotification(
        reminder.id,
        operatingSystemId,
        reminder.version,
        reminder.remind_at,
      );
      return "scheduled";
    } catch {
      await store.setNotificationState(
        reminder.id,
        "failed",
        genericScheduleError,
      );
      return "failed";
    }
  }

  async function syncCalendarNotification(
    reminder: CalendarReminder,
    requestPermission: boolean,
  ): Promise<ScheduleResult> {
    return exclusive(reminder.id, () => schedule(reminder, requestPermission));
  }

  async function cancelCalendarNotification(reminderId: string): Promise<void> {
    if (platform.platform === "web" || platform.platform === "unsupported") return;
    await exclusive(reminderId, async () => {
      try {
        await cancelReminderNotifications(reminderId, platform, store);
      } catch {
        await store.setNotificationState(
          reminderId,
          "failed",
          genericCancelError,
        );
        throw new Error(genericCancelError);
      }
    });
  }

  async function reconcile(): Promise<void> {
    if (reconciliation) return reconciliation;
    reconciliation = reconcileScheduledNotifications().finally(() => {
      reconciliation = undefined;
    });
    return reconciliation;
  }

  async function reconcileScheduledNotifications(): Promise<void> {
    const reminders = await store.listReminders();
    if (platform.platform === "web" || platform.platform === "unsupported") {
      await Promise.all(
        reminders.map((reminder) =>
          store.setNotificationState(
            reminder.id,
            isActive(reminder) ? "unsupported" : "disabled",
          ),
        ),
      );
      return;
    }

    const [scheduled, states] = await Promise.all([
      platform.getScheduled(),
      store.listNotificationStates(),
    ]);
    const activeReminders = new Map(
      reminders.filter(isActive).map((reminder) => [reminder.id, reminder]),
    );
    const statesByReminder = new Map(
      states.map((state) => [state.reminder_id, state]),
    );
    const requestsByReminder = new Map<
      string,
      typeof scheduled
    >();

    for (const request of scheduled) {
      if (!isCalendarNotification(request)) continue;
      const reminderId = reminderIdFromNotification(request);
      const reminder = reminderId ? activeReminders.get(reminderId) : undefined;
      if (!reminder) {
        await platform.cancel(request.identifier);
        continue;
      }
      const existing = requestsByReminder.get(reminder.id) ?? [];
      existing.push(request);
      requestsByReminder.set(reminder.id, existing);
    }

    const permission = await platform.getPermission();
    for (const reminder of activeReminders.values()) {
      const requests = requestsByReminder.get(reminder.id) ?? [];
      if (
        permission.granted &&
        hasCurrentSchedule(reminder, statesByReminder.get(reminder.id), requests)
      ) {
        continue;
      }
      await syncCalendarNotification(reminder, false);
    }
  }

  async function openSettings(): Promise<void> {
    if (platform.platform === "web" || platform.platform === "unsupported") return;
    await platform.openSettings();
  }

  return {
    syncCalendarNotification,
    cancelCalendarNotification,
    reconcileCalendarNotifications: reconcile,
    openSettings,
  };
}
