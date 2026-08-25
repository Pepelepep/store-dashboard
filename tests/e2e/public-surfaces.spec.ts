// The package intentionally exposes AxeBuilder as its default export.
// eslint-disable-next-line import/no-named-as-default
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicRoutes = [
  { path: "/", name: "landing" },
  { path: "/privacy", name: "privacy" },
  { path: "/terms", name: "terms" },
  { path: "/support", name: "support" },
] as const;

for (const route of publicRoutes) {
  test(`${route.name} is reachable and accessible`, async ({ page }, testInfo) => {
    const response = await page.goto(route.path, { waitUntil: "networkidle" });

    expect(response?.status(), `${route.path} should return HTTP 200`).toBe(200);
    await expect(page.locator("body")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);

    await testInfo.attach(`${route.name}-${testInfo.project.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

test("public legal and support navigation has no dead end", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  for (const path of ["/privacy", "/terms", "/support"]) {
    const response = await page.request.get(path);
    expect(response.status(), `${path} should be public`).toBe(200);
  }
});
