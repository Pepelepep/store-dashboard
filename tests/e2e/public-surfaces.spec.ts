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
  test(`${route.name} is reachable and accessible`, async ({
    page,
  }, testInfo) => {
    const response = await page.goto(route.path, { waitUntil: "networkidle" });

    expect(response?.status(), `${route.path} should return HTTP 200`).toBe(
      200,
    );
    await expect(page.locator("body")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);

    await testInfo.attach(`${route.name}-${testInfo.project.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

test("public legal and support navigation has no dead end", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });

  for (const path of ["/privacy", "/terms", "/support"]) {
    const response = await page.request.get(path);
    expect(response.status(), `${path} should be public`).toBe(200);

    await page.goto(path, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("link", { name: "Back to ShopOps Studio" }),
    ).toHaveAttribute("href", "/");
  }
});

test("pricing and mobile navigation remain reversible", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });

  if (testInfo.project.name === "mobile-chrome") {
    const menuButton = page.getByRole("button", { name: "Open navigation" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Pricing" })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Pricing" })
      .click();
  }

  await expect(page).toHaveURL(/#pricing$/);
  await expect(
    page.getByRole("heading", {
      name: "Start with the operation you have today.",
    }),
  ).toBeInViewport();
  await expect(page.getByRole("link", { name: "Choose Solo" })).toHaveAttribute(
    "href",
    /Solo%20trial/,
  );

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const backToTop = page.getByRole("link", { name: "Back to top" });
  await expect(backToTop).toBeVisible();
  await backToTop.click();
  await expect(page).toHaveURL(/#top$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(80);

  await page.goto("/#pricing", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", {
      name: "Start with the operation you have today.",
    }),
  ).toBeInViewport();
});
