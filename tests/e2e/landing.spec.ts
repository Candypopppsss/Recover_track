import { test, expect } from "@playwright/test";

test("the scrolling landing page has working section links, FAQ and responsive layouts", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".landing h1")).toContainText("Recovery at home.");
  const targets = await page
    .locator('.landing a[href^="#"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => Boolean(href)),
    );
  for (const target of new Set(targets))
    await expect(page.locator(target)).toHaveCount(1);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight * 2,
    ),
  ).toBeTruthy();
  await page
    .getByText("Product preview · fictional example", { exact: true })
    .waitFor();
  await page.locator(".landing-nav-access").click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await page.getByText("How do I add a prescription?", { exact: true }).click();
  await expect(page.locator("#questions details[open]")).toHaveCount(1);
  await page.locator(".landing-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".landing-footer")).toBeVisible();
});

test("an API outage leaves the landing usable, shows one error and retries without losing form input", async ({
  page,
}) => {
  let unavailable = true;
  const failure = {
    error: "Sign-in is temporarily unavailable.",
    code: "database_unreachable",
  };
  for (const endpoint of ["state", "health", "auth/login"]) {
    await page.route(`**/api/${endpoint}`, (route) =>
      unavailable
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify(failure),
          })
        : route.continue(),
    );
  }
  await page.goto("/");
  await expect(page.locator(".landing h1")).toBeVisible();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("fictional-outage@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-outage-passphrase");
  await page
    .getByRole("button", { name: "Sign in to RecoverTrack", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText(failure.error);
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
    "fictional-outage@example.test",
  );
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1, exact: true }),
  ).toBeVisible();
});

test("a non-JSON API response produces a recoverable message instead of breaking the page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<p>Gateway unavailable</p>",
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("fictional-gateway@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-gateway-passphrase");
  await page
    .getByRole("button", { name: "Sign in to RecoverTrack", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "The server returned an unexpected response.",
  );
  await page.unroute("**/api/auth/login");
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: "null",
    }),
  );
  await page
    .getByRole("button", { name: "Sign in to RecoverTrack", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "The server returned an unexpected response.",
  );
  await expect(page.locator(".landing h1")).toHaveCount(1);
  expect(errors).toEqual([]);
});
