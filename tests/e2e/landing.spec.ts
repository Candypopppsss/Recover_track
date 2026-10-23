import { test, expect } from "@playwright/test";

test("the scrolling homepage has working sections, FAQ and a separate sign-in page", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
  const targets = await page
    .locator('.landing a[href^="#"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => Boolean(href) && href !== "#"),
    );
  for (const target of new Set(targets))
    await expect(page.locator(target)).toHaveCount(1);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBeTruthy();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight * 2,
    ),
  ).toBeTruthy();
  await page.locator("#questions summary").first().click();
  await expect(page.locator("#questions details[open]")).toHaveCount(1);
  await page.locator(".landing-footer").scrollIntoViewIfNeeded();
  await expect(page.locator(".landing-footer")).toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.locator(".landing")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
});

test("the public homepage works without contacting an unavailable API", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    apiRequests.push(new URL(route.request().url()).pathname);
    await route.abort("timedout");
  });
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("link", { name: "How it works", exact: true })
    .click();
  await expect(page.locator("#how-it-works")).toBeInViewport();
  await page.locator("#questions summary").first().click();
  await expect(page.locator("#questions details[open]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("main h1")).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
});

test("the old access link opens the homepage from the top without an auth form", async ({
  page,
}) => {
  await page.goto("/#access");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("main h1")).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("main h1")).toBeInViewport();
  await expect(page.locator("form")).toHaveCount(0);
});

test("a sign-in outage shows one error and retries without losing credentials", async ({
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
  await page.goto("/signin");
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
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "fictional-outage-passphrase",
  );
  await page.locator('a[href="/demo"]').first().click();
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1, exact: true }),
  ).toBeVisible();
});

test("a non-JSON API response produces a recoverable sign-in message", async ({
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
  await page.goto("/signin");
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
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator(".landing")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sign-in returns to a requested workspace page while the homepage stays public", async ({
  page,
}) => {
  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await page.locator('a[href="/demo"]').first().click();
  await page.getByRole("button", { name: "Caregiver", exact: true }).click();
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(
    page.getByRole("heading", {
      name: "Medication schedule",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Medication schedule",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  const session = await page.request.get("/api/state");
  expect(session.status()).toBe(200);
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1, exact: true }),
  ).toBeVisible();
});

test("successful sign-in is not blocked or undone by an older delayed session request", async ({
  page,
}) => {
  let stateRequests = 0;
  let authenticationStarted = false;
  let releaseInitial = () => {};
  const initialRequestHeld = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  await page.route("**/api/auth/demo", async (route) => {
    authenticationStarted = true;
    await route.continue();
  });
  await page.route("**/api/state", async (route) => {
    stateRequests++;
    if (!authenticationStarted) {
      await initialRequestHeld;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Sign in to continue." }),
      });
      return;
    }
    await route.continue();
  });
  try {
    await page.goto("/demo");
    await expect.poll(() => stateRequests).toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "Caregiver", exact: true }).click();
    await page.getByRole("button", { name: "Explore demo", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1, exact: true }),
    ).toBeVisible({ timeout: 5000 });
    const staleResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/state" &&
        response.status() === 401,
    );
    releaseInitial();
    await staleResponse;
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1, exact: true }),
    ).toBeVisible();
    expect(stateRequests).toBeGreaterThanOrEqual(2);
  } finally {
    releaseInitial();
  }
});
