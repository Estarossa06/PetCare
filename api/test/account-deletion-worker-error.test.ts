import assert from "node:assert/strict";
import test from "node:test";
import { safeFailureCode } from "../src/modules/auth/accountDeletionWorker.js";

test("worker failures retain safe database or transport codes for diagnosis", () => {
  assert.equal(safeFailureCode(Object.assign(new Error("relation missing"), { code: "42P01" })), "42P01");
  assert.equal(safeFailureCode(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })), "ECONNREFUSED");
});

test("worker failure logging falls back without exposing messages or unsafe codes", () => {
  assert.equal(safeFailureCode(new Error("sensitive connection string")), "ACCOUNT_DELETION_RETRY");
  assert.equal(safeFailureCode(Object.assign(new Error("details"), { code: "bad code; secret" })), "ACCOUNT_DELETION_RETRY");
});
