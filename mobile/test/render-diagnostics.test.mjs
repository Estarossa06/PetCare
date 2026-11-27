import assert from "node:assert/strict";
import test from "node:test";

process.env.EXPO_PUBLIC_RENDER_DIAGNOSTICS = "true";
const diagnostics = await import("../src/diagnostics/renderDiagnostics.ts");

test("staging diagnostics include screen state and error codes without user data", () => {
  const originalInfo = console.info;
  const records = [];
  console.info = (line) => records.push(String(line));

  try {
    diagnostics.reportScreenOpened("pets");
    diagnostics.reportRuntimeInfo("android", false);
    diagnostics.reportThemeMode("dark");
    diagnostics.reportComponentState("pets", "pet_list", {
      loading: false,
      dataCount: 2,
      filtersCount: 4,
      renderBranch: "data",
      name: "PRIVATE PET NAME",
      email: "person@example.test",
    });
    const apiError = Object.assign(new Error("PRIVATE SERVER BODY"), {
      status: 503,
      token: "PRIVATE TOKEN",
    });
    diagnostics.reportClientError("kirai", "api_client", apiError);
    diagnostics.reportRenderError("calendar", new Error("PRIVATE RENDER DATA"));
  } finally {
    console.info = originalInfo;
    delete process.env.EXPO_PUBLIC_RENDER_DIAGNOSTICS;
  }

  assert.equal(records.length, 6);
  const serialized = records.join("\n");
  assert.match(serialized, /\[PetCareDiag\]/);
  assert.match(serialized, /"event":"screen_open"/);
  assert.match(serialized, /"event":"runtime_info"/);
  assert.match(serialized, /"development":false/);
  assert.match(serialized, /"event":"theme_mode"/);
  assert.match(serialized, /"dataCount":2/);
  assert.match(serialized, /"filtersCount":4/);
  assert.match(serialized, /"httpStatus":503/);
  assert.match(serialized, /"event":"render_error"/);
  assert.doesNotMatch(serialized, /PRIVATE|person@example\.test|token/);
});
