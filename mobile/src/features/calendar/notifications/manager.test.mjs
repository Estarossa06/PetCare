import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendarNotificationManager } from "./manager.ts";

const reminderId = "1b7a3d8e-7dc7-4e8e-9dc8-4edbb31e90e7";

function makeReminder() {
  return {
    id: reminderId,
    owner_id: "owner",
    pet_id: null,
    calendar_event_id: "event",
    care_task_id: null,
    appointment_id: null,
    health_record_id: null,
    title: "Medicamento",
    remind_at: new Date(Date.now() + 60_000).toISOString(),
    lead_minutes: null,
    timezone: "America/Mexico_City",
    status: "pending",
    enabled: 1,
    notes: null,
    version: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    scheduling_status: "pending",
    last_error: null,
  };
}

function notification(identifier, id) {
  return {
    identifier,
    content: {
      data: {
        notificationType: "petcare-calendar-reminder",
        reminderId: id,
      },
    },
    trigger: null,
  };
}

function createHarness(permissionGranted = true, platformName = "ios") {
  const reminder = makeReminder();
  let scheduled = [];
  const triggerDates = [];
  const scheduleInputs = [];
  let androidChannelCreations = 0;
  let state = {
    reminder_id: reminder.id,
    operating_system_id: null,
    scheduled_version: 0,
    scheduled_for: null,
    scheduling_status: "pending",
  };
  let permissionRequests = 0;
  let notificationsEnabled = true;
  const platform = {
    platform: platformName,
    ensureAndroidChannel: async () => {
      androidChannelCreations += 1;
    },
    getPermission: async () => ({
      granted: permissionGranted,
      canAskAgain: false,
    }),
    requestPermission: async () => {
      permissionRequests += 1;
      return { granted: permissionGranted, canAskAgain: false };
    },
    getExactAlarmPermission: async () => true,
    schedule: async (input) => {
      scheduled.push(notification(input.identifier, reminder.id));
      triggerDates.push(input.triggerDate.getTime());
      scheduleInputs.push(input);
      return input.identifier;
    },
    getScheduled: async () => {
      if (platformName === "web") {
        throw new Error("Native scheduling API must not be used on Web.");
      }
      return [...scheduled];
    },
    cancel: async (identifier) => {
      scheduled = scheduled.filter((item) => item.identifier !== identifier);
    },
    openSettings: async () => {},
  };
  const store = {
    listReminders: async () => [reminder],
    listNotificationStates: async () => [state],
    getNotificationId: async (id) =>
      id === reminder.id ? state.operating_system_id : null,
    setNotificationState: async (id, status) => {
      if (id === reminder.id) {
        state = {
          ...state,
          operating_system_id: null,
          scheduled_version: 0,
          scheduled_for: null,
          scheduling_status: status,
        };
      }
    },
    setScheduledNotification: async (id, operatingSystemId, version, at) => {
      if (id === reminder.id) {
        state = {
          reminder_id: id,
          operating_system_id: operatingSystemId,
          scheduled_version: version,
          scheduled_for: at,
          scheduling_status: "scheduled",
        };
      }
    },
  };
  return {
    reminder,
    state: () => state,
    scheduled: () => scheduled,
    scheduleInputs: () => scheduleInputs,
    triggerDates: () => triggerDates,
    androidChannelCreations: () => androidChannelCreations,
    permissionRequests: () => permissionRequests,
    setNotificationsEnabled: (enabled) => { notificationsEnabled = enabled; },
    manager: createCalendarNotificationManager(platform, store, async () => notificationsEnabled),
  };
}

test("schedules a reminder once using its absolute reminder time", async () => {
  const harness = createHarness();

  const result = await harness.manager.syncCalendarNotification(
    harness.reminder,
    true,
  );

  assert.equal(result, "scheduled");
  assert.equal(harness.scheduled().length, 1);
  assert.equal(harness.scheduled()[0].identifier, reminderId);
  assert.equal(harness.scheduleInputs()[0].content.title, "Medicamento");
  assert.equal(
    harness.scheduleInputs()[0].content.body,
    "Tienes un recordatorio de PetCare.",
  );
  assert.equal(
    harness.scheduleInputs()[0].content.data.reminderId,
    reminderId,
  );
  assert.equal(harness.state().scheduled_version, harness.reminder.version);
  assert.equal(
    harness.triggerDates()[0],
    new Date(harness.reminder.remind_at).getTime(),
  );
});

test("Android creates its channel and schedules on that channel", async () => {
  const harness = createHarness(true, "android");

  const result = await harness.manager.syncCalendarNotification(
    harness.reminder,
    true,
  );

  assert.equal(result, "scheduled");
  assert.equal(harness.androidChannelCreations(), 1);
  assert.equal(harness.scheduleInputs()[0].channelId, "petcare-calendar");
});

test("editing a reminder replaces its previous scheduled time", async () => {
  const harness = createHarness();
  await harness.manager.syncCalendarNotification(harness.reminder, true);
  const updatedReminder = {
    ...harness.reminder,
    remind_at: new Date(Date.now() + 120_000).toISOString(),
    version: harness.reminder.version + 1,
  };

  const result = await harness.manager.syncCalendarNotification(
    updatedReminder,
    false,
  );

  assert.equal(result, "scheduled");
  assert.equal(harness.scheduled().length, 1);
  assert.deepEqual(harness.triggerDates(), [
    new Date(harness.reminder.remind_at).getTime(),
    new Date(updatedReminder.remind_at).getTime(),
  ]);
  assert.equal(harness.state().scheduled_for, updatedReminder.remind_at);
});

test("denied permissions are reported without scheduling or repeated prompts", async () => {
  const harness = createHarness(false);

  const result = await harness.manager.syncCalendarNotification(
    harness.reminder,
    true,
  );

  assert.equal(result, "denied");
  assert.equal(harness.permissionRequests(), 0);
  assert.equal(harness.scheduled().length, 0);
});

test("reconciliation removes duplicate OS requests and restores one current schedule", async () => {
  const harness = createHarness();
  harness.scheduled().push(
    notification(`${reminderId}-old`, reminderId),
    notification(`${reminderId}-current`, reminderId),
  );
  await harness.manager.reconcileCalendarNotifications();

  assert.equal(harness.scheduled().length, 1);
  assert.equal(harness.scheduled()[0].identifier, reminderId);
  assert.equal(harness.state().scheduling_status, "scheduled");
});

test("cancellation finds requests by reminder metadata if the stored OS id is stale", async () => {
  const harness = createHarness();
  harness.scheduled().push(notification("os-rewritten-id", reminderId));

  await harness.manager.cancelCalendarNotification(reminderId);

  assert.equal(harness.scheduled().length, 0);
});

test("web reports local notifications as unsupported without calling native APIs", async () => {
  const harness = createHarness(true, "web");

  const result = await harness.manager.syncCalendarNotification(
    harness.reminder,
    true,
  );

  assert.equal(result, "unsupported");
  assert.equal(harness.state().scheduling_status, "unsupported");
  assert.equal(harness.scheduled().length, 0);
});

test("disabling the device preference cancels scheduled PetCare reminders", async () => {
  const harness = createHarness();
  await harness.manager.syncCalendarNotification(harness.reminder, true);
  assert.equal(harness.scheduled().length, 1);

  harness.setNotificationsEnabled(false);
  await harness.manager.reconcileCalendarNotifications();

  assert.equal(harness.scheduled().length, 0);
  assert.equal(harness.state().scheduling_status, "disabled");
});
