import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

async function demo(
  page: Page,
  role: "Caregiver" | "Patient" | "Clinician" = "Caregiver",
) {
  await page.goto("/");
  await page.getByRole("button", { name: role, exact: true }).click();
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(
    page.getByText("Fictional patient data", { exact: false }).first(),
  ).toBeVisible();
}
async function state(page: Page) {
  const response = await page.request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("caregiver can navigate, export dose history and read notifications", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await demo(page);
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1, exact: true }),
  ).toBeVisible();
  expect((await state(page)).medications).toHaveLength(4);
  for (const name of [
    "Medication schedule",
    "Medications",
    "Recovery insights",
  ]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, level: 1, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("link", { name: "Medication schedule", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export dose history" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "recovertrack-dose-history.csv",
  );
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect
    .poll(async () =>
      (await state(page)).notifications.every((n: { read: boolean }) => n.read),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(errors).toEqual([]);
});

test("manual prescription requires review, creates exact doses, and supports pause/archive without losing history", async ({
  page,
}) => {
  await demo(page);
  await page
    .getByRole("button", { name: "Add prescription", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Enter details manually" }).click();
  await modal.getByLabel("Medication name", { exact: true }).fill("MED-TEST");
  await modal.getByLabel("Strength", { exact: true }).fill("10 mg");
  await modal.getByLabel("Amount per dose", { exact: true }).fill("1 tablet");
  await modal
    .getByLabel("Instructions", { exact: true })
    .fill("Fictional test entry");
  await modal.getByLabel("Duration in days", { exact: true }).fill("3");
  await modal
    .getByLabel("Dose time 1 for medication 1", { exact: true })
    .fill("00:01");
  await modal
    .getByRole("button", { name: "Confirm & create schedule" })
    .click();
  await expect(modal).toBeVisible();
  expect((await state(page)).medications).toHaveLength(4);
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm & create schedule" })
    .click();
  await expect(modal).not.toBeVisible();
  const added = await state(page);
  const medication = added.medications.find(
    (m: { name: string }) => m.name === "MED-TEST",
  );
  expect(medication.times).toEqual(["00:01"]);
  expect(
    added.doses.filter(
      (d: { medicationId: string }) => d.medicationId === medication.id,
    ),
  ).toHaveLength(3);
  await page.getByRole("button", { name: /^Mark MED-TEST.*as taken$/ }).click();
  await expect
    .poll(async () =>
      (await state(page)).doses.find(
        (d: { medicationId: string; status: string }) =>
          d.medicationId === medication.id && d.status === "taken",
      ),
    )
    .toBeTruthy();
  await page.getByRole("link", { name: "Medications", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause MED-TEST", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await state(page)).medications.find(
          (m: { id: string }) => m.id === medication.id,
        ).status,
    )
    .toBe("paused");
  await page.getByRole("button", { name: /^Paused/ }).click();
  await expect(
    page.getByRole("heading", { name: "MED-TEST", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive MED-TEST" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive medication", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const archived = await state(page);
  expect(
    archived.medications.find((m: { id: string }) => m.id === medication.id),
  ).toBeUndefined();
  expect(
    archived.doses.find(
      (d: { medicationId: string; status: string }) =>
        d.medicationId === medication.id && d.status === "taken",
    ),
  ).toBeTruthy();
});

test("actual image OCR stays draft until every field is reviewed and confirmed", async ({
  page,
}) => {
  await demo(page);
  await page
    .getByRole("button", { name: "Add prescription", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Prescription image", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/prescription-test.png"));
  await expect(
    modal.getByText("Read with tesseract", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
  expect((await state(page)).medications).toHaveLength(4);
  const rows = modal.locator(".review-medication");
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await rows
      .nth(i)
      .getByLabel(`Dose time 1 for medication ${i + 1}`, { exact: true })
      .fill(i === 0 ? "08:00" : "20:00");
    await rows.nth(i).getByRole("checkbox").check();
  }
  await modal
    .getByRole("button", { name: "Confirm & create schedule" })
    .click();
  await expect(modal).not.toBeVisible();
  const updated = await state(page);
  expect(updated.medications).toHaveLength(6);
  expect(updated.prescriptions[0].status).toBe("confirmed");
  expect(
    updated.medications.find((m: { name: string }) => m.name === "MED-A").times,
  ).toEqual(["08:00"]);
});

test("patient can record symptoms and doses but cannot change medication plans", async ({
  page,
}) => {
  await demo(page, "Patient");
  await expect(
    page.getByRole("heading", { name: "Today", level: 1, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("slider", { name: "Pain level from zero to ten" })
    .fill("3");
  await page.getByRole("button", { name: "On my own", exact: true }).click();
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Today's check-in" }),
  ).toBeVisible();
  expect((await state(page)).checkIns.at(-1).pain).toBe(3);
  const response = await page.request.post("/api/medications", { data: {} });
  expect(response.status()).toBe(403);
  await expect(
    page.getByRole("button", { name: "Add prescription", exact: true }),
  ).toHaveCount(0);
});

test("clinician has a separate recovery board and read-only medication access", async ({
  page,
}) => {
  await demo(page, "Clinician");
  await expect(
    page.getByRole("heading", {
      name: "Recovery board",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Follow-up queue", exact: true }),
  ).toBeVisible();
  const response = await page.request.post("/api/checkins", {
    data: { pain: 2, mobility: "independent" },
  });
  expect(response.status()).toBe(403);
  await expect(
    page.getByRole("button", { name: /^Mark .*as taken$/ }),
  ).toHaveCount(0);
});

test("mobile navigation and forms fit the screen and remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "Medications", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Medications", level: 1, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add prescription", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Close dialog" }).click();
});

test("new accounts start empty, can sign back in, and share recovery through a private invitation", async ({
  page,
  browser,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ownerEmail = `owner-${suffix}@example.test`;
  const recipientEmail = `member-${suffix}@example.test`;
  const password = "Fictional-test-passphrase-42!";
  async function register(target: Page, email: string, name: string) {
    await target.goto("/");
    await target
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await target.getByLabel("Your name", { exact: true }).fill(name);
    await target
      .getByLabel("Patient's name", { exact: true })
      .fill("Fictional Test Patient");
    await target.getByLabel("Email address", { exact: true }).fill(email);
    await target.getByLabel("Password", { exact: true }).fill(password);
    await target.getByRole("checkbox").check();
    await target
      .getByRole("button", { name: "Create RecoverTrack account", exact: true })
      .click();
    await expect(target.locator(".page-title")).toBeVisible();
  }
  await register(page, ownerEmail, "Fictional Owner");
  const ownerState = await state(page);
  expect(ownerState.demo).toBe(false);
  expect(ownerState.medications).toHaveLength(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to RecoverTrack", exact: true })
    .click();
  await expect(page.locator(".page-title")).toBeVisible();
  expect((await state(page)).patient.id).toBe(ownerState.patient.id);
  await page.getByRole("link", { name: "Care team", exact: true }).click();
  await page
    .getByRole("button", { name: "Invite a team member", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: /Their role/ })
    .selectOption("caregiver");
  await page.getByLabel("Their email", { exact: false }).fill(recipientEmail);
  await page
    .getByRole("button", { name: "Create invitation code", exact: true })
    .click();
  const code = await page
    .getByLabel("Private invitation code", { exact: true })
    .inputValue();
  expect(code.length).toBeGreaterThan(20);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
  });
  const recipient = await context.newPage();
  await register(recipient, recipientEmail, "Fictional Member");
  await recipient.getByRole("link", { name: "Care team", exact: true }).click();
  await recipient
    .getByRole("button", { name: "Join a household", exact: true })
    .click();
  await recipient.getByLabel("Invitation code", { exact: true }).fill(code);
  await recipient
    .getByRole("button", { name: "Join household", exact: true })
    .click();
  await expect(recipient.getByRole("dialog")).not.toBeVisible();
  const shared = await state(recipient);
  expect(shared.patient.id).toBe(ownerState.patient.id);
  expect(shared.careTeam).toHaveLength(2);
  await context.close();
});

test("reminder preferences persist after a page reload", async ({ page }) => {
  await demo(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("switch", { name: "Dose reminders", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: /Check-in grace period/ })
    .selectOption("30");
  await page
    .getByRole("button", { name: "Save reminder preferences", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).settings.graceMinutes)
    .toBe(30);
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Dose reminders", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("combobox", { name: /Check-in grace period/ }),
  ).toHaveValue("30");
  expect((await state(page)).settings.remindersEnabled).toBe(false);
});
