import { test, expect } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("deployment owners can generate and copy a local key without network or storage writes", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api"))
      apiRequests.push(request.method());
  });
  await page.goto("/deployment-key.html");
  await page.waitForLoadState("networkidle");
  const field = page.getByLabel("Generated encryption key", { exact: true });
  await expect(
    page.getByRole("heading", { name: "Set the deployment key.", exact: true }),
  ).toBeVisible();
  expect(
    await field.evaluate((input) => (input as HTMLInputElement).value === ""),
  ).toBe(true);
  await expect(field).toHaveAttribute("type", "password");
  await expect(
    page.getByRole("button", { name: "Copy key", exact: true }),
  ).toBeDisabled();
  expect(
    await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content"),
  ).toContain("connect-src 'none'");
  expect(
    await page.locator('meta[name="robots"]').getAttribute("content"),
  ).toContain("noindex");
  expect(
    await page.locator('meta[name="referrer"]').getAttribute("content"),
  ).toBe("no-referrer");
  const networkAfterLoad: string[] = [];
  const trackRequest = (request: { method: () => string }) =>
    networkAfterLoad.push(request.method());
  page.on("request", trackRequest);

  const isCanonicalKey = () =>
    field.evaluate((input) => {
      const value = (input as HTMLInputElement).value;
      try {
        const binary = atob(value);
        return (
          /^[A-Za-z0-9+/]{43}=$/.test(value) &&
          binary.length === 32 &&
          btoa(binary) === value
        );
      } catch {
        return false;
      }
    });
  const fingerprint = () =>
    field.evaluate(async (input) => {
      const value = (input as HTMLInputElement).value;
      const bytes = new TextEncoder().encode(value);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      bytes.fill(0);
      return [...new Uint8Array(digest)].join(",");
    });

  await page
    .getByRole("button", { name: "Generate a new key", exact: true })
    .click();
  expect(await isCanonicalKey()).toBe(true);
  const first = await fingerprint();
  await page.getByRole("button", { name: "Show key", exact: true }).click();
  const revealed = (await field.getAttribute("type")) === "text";
  await page.getByRole("button", { name: "Hide key", exact: true }).click();
  expect(revealed).toBe(true);
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Copied.");
  expect(
    await page.evaluate(async () => {
      const input = document.getElementById(
        "generated-key",
      ) as HTMLInputElement;
      return (await navigator.clipboard.readText()) === input.value;
    }),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Generate a new key", exact: true })
    .click();
  expect(await isCanonicalKey()).toBe(true);
  expect((await fingerprint()) !== first).toBe(true);
  expect(
    await page.evaluate(async () => {
      const input = document.getElementById(
        "generated-key",
      ) as HTMLInputElement;
      return (await navigator.clipboard.readText()) !== input.value;
    }),
  ).toBe(true);

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("Clipboard denied", "NotAllowedError")),
    });
  });
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("copy it manually");
  await expect(field).toHaveAttribute("type", "password");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  expect(
    await field.evaluate((input) => (input as HTMLInputElement).value === ""),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Copy key", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Generate a new key", exact: true })
    .click();
  expect(await isCanonicalKey()).toBe(true);
  expect(networkAfterLoad).toEqual([]);
  page.off("request", trackRequest);
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(
    await field.evaluate((input) => (input as HTMLInputElement).value === ""),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        localStorage.length === 0 &&
        sessionStorage.length === 0 &&
        document.cookie === "",
    ),
  ).toBe(true);
  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
