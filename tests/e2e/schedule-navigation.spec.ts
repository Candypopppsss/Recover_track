import { test, expect } from "@playwright/test";

test("the schedule covers a complete 90-day course and stops at the available history", async ({
  page,
}) => {
  const session = await page.request.post("/api/auth/demo", {
    data: { role: "caregiver" },
  });
  expect(session.status()).toBe(201);
  const initial = await (await page.request.get("/api/state")).json();
  const timeZone = initial.patient.timeZone;
  const dateInZone = (value: string | Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  const prescription = await page.request.post("/api/medications", {
    data: {
      name: "MED-LONG-COURSE",
      strength: "5 mg",
      dose: "1 tablet",
      instructions: "Fictional course navigation test",
      times: ["00:00"],
      startDate: dateInZone(new Date()),
      durationDays: 90,
      color: "green",
      reviewed: true,
    },
  });
  expect(prescription.status()).toBe(201);
  const state = await (await page.request.get("/api/state")).json();
  const courseDoses = state.doses.filter(
    (dose: { medicationName: string }) =>
      dose.medicationName === "MED-LONG-COURSE",
  );
  expect(courseDoses).toHaveLength(8);
  expect(state.doseRange.from).toBeTruthy();
  const expectedEnd = new Date(`${dateInZone(new Date())}T12:00:00Z`);
  expectedEnd.setUTCDate(expectedEnd.getUTCDate() + 89);
  expect(state.doseRange.to).toBe(expectedEnd.toISOString().slice(0, 10));
  const lastDate = state.doseRange.to;
  const lastWeekStart = new Date(`${lastDate}T12:00:00Z`);
  lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 6);
  const lastWeek = await page.request.get(
    `/api/doses?from=${lastWeekStart.toISOString().slice(0, 10)}&to=${lastDate}`,
  );
  expect(lastWeek.status()).toBe(200);
  expect(
    (await lastWeek.json()).doses.filter(
      (dose: { medicationName: string }) =>
        dose.medicationName === "MED-LONG-COURSE",
    ),
  ).toHaveLength(7);
  const requestedRanges: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/doses") requestedRanges.push(url);
  });
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(date + "T12:00:00Z"));

  await page.goto("/schedule");
  await expect(
    page.getByRole("heading", {
      name: "Medication schedule",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  const next = page.getByRole("button", { name: "Next week", exact: true });
  for (let weeks = 0; weeks < 20 && (await next.isEnabled()); weeks++)
    await next.click();
  await expect(next).toBeDisabled();
  await page
    .getByRole("button", { name: dateLabel(lastDate), exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "MED-LONG-COURSE 5 mg", exact: true }),
  ).toBeVisible();

  const previous = page.getByRole("button", {
    name: "Previous week",
    exact: true,
  });
  for (let weeks = 0; weeks < 25 && (await previous.isEnabled()); weeks++)
    await previous.click();
  await expect(previous).toBeDisabled();
  const first = page.getByRole("button", {
    name: dateLabel(state.doseRange.from),
    exact: true,
  });
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const courseRow = page.locator(".dose-row").filter({
    has: page.getByRole("heading", {
      name: "MED-LONG-COURSE 5 mg",
      exact: true,
    }),
  });
  await courseRow
    .getByRole("button", { name: /^Mark MED-LONG-COURSE .* as taken$/ })
    .click();
  await expect(courseRow.getByText("Taken", { exact: true })).toBeVisible();
  expect(requestedRanges.length).toBeGreaterThan(1);
  expect(
    requestedRanges.every(
      (url) =>
        (Date.parse(url.searchParams.get("to")!) -
          Date.parse(url.searchParams.get("from")!)) /
          86400000 ===
        6,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
