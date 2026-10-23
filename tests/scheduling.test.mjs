import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dateInZone,
  validDate,
  localDateTimeToUTC,
  generateDoses,
  projectedStatus,
} from "../server/scheduling.mjs";

test("calendar day and scheduled medication times honor the patient timezone across UTC midnight", () => {
  assert.equal(
    dateInZone(new Date("2026-10-22T20:00:00Z"), "Asia/Kolkata"),
    "2026-10-23",
  );
  assert.equal(
    localDateTimeToUTC("2026-10-23", "08:30", "Asia/Kolkata"),
    "2026-10-23T03:00:00.000Z",
  );
  const doses = generateDoses(
    {
      id: "m",
      householdId: "h",
      name: "MED-A",
      strength: "10 mg",
      dose: "1 tablet",
      times: ["08:30", "20:00"],
      startDate: "2026-10-23",
      durationDays: 3,
    },
    "Asia/Kolkata",
  );
  assert.equal(doses.length, 6);
  assert.equal(new Set(doses.map((d) => d.id)).size, 6);
  assert.equal(doses[5].scheduledAt, "2026-10-25T14:30:00.000Z");
});

test("wall-clock dose schedule adjusts across daylight saving transitions", () => {
  assert.equal(
    localDateTimeToUTC("2026-03-07", "08:00", "America/New_York"),
    "2026-03-07T13:00:00.000Z",
  );
  assert.equal(
    localDateTimeToUTC("2026-03-08", "08:00", "America/New_York"),
    "2026-03-08T12:00:00.000Z",
  );
  assert.throws(
    () => localDateTimeToUTC("2026-03-08", "02:30", "America/New_York"),
    /does not exist/,
  );
});

test("dose status uses exact grace boundaries and preserves completed reports", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(
    projectedStatus(
      { scheduledAt: "2026-10-23T12:01:00Z", status: "upcoming" },
      60,
      now,
    ),
    "upcoming",
  );
  assert.equal(
    projectedStatus(
      { scheduledAt: "2026-10-23T11:00:00Z", status: "upcoming" },
      60,
      now,
    ),
    "due",
  );
  assert.equal(
    projectedStatus(
      { scheduledAt: "2026-10-23T10:59:59Z", status: "upcoming" },
      60,
      now,
    ),
    "missed",
  );
  assert.equal(
    projectedStatus(
      { scheduledAt: "2026-10-20T12:00:00Z", status: "taken" },
      60,
      now,
    ),
    "taken",
  );
});

test("course dates cross month/year boundaries without accepting impossible dates", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2028-02-29"), true);
});
