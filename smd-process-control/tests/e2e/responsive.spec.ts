import { expect, test, type Page } from "@playwright/test";

async function assertNoPageWideOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}

for (const viewport of [
  { name: "desktop", width: 1366, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
] as const) {
  test(`${viewport.name} shell, KPI, yield table, and entry form remain usable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?responsive-test=dashboard&language=vi");

    await expect(page.locator("[data-responsive-fixture='true']")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    await expect(page.getByLabel("Chỉ số chính")).toBeVisible();
    await expect(page.getByRole("table", { name: "Tỷ lệ đạt theo công đoạn và chuyền" })).toBeVisible();
    await assertNoPageWideOverflow(page);

    if (viewport.width === 768) {
      const toggle = page.getByRole("button", { name: "Đóng menu" });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Mở menu" })).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeVisible();
    }

    await page.goto("/entry?responsive-test=entry&language=vi");
    await expect(page.getByRole("heading", { name: "Nhập sản lượng" })).toBeVisible();
    await expect(page.getByLabel("Ngày sản xuất")).toBeVisible();
    await assertNoPageWideOverflow(page);
  });
}
