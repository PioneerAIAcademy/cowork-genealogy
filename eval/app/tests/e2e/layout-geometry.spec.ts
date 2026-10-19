/**
 * Geometry assertions for the eval CRUD UI's dimension cards.
 *
 * jsdom has no layout engine (getBoundingClientRect returns all zeros), and
 * Playwright's toBeVisible() passes on elements pushed outside an
 * overflow:hidden ancestor. Only a boundingBox() comparison catches this
 * class of bug. See docs/specs/eval-crud-ui-spec.md section 7 "Testing".
 */
import { test, expect } from '@playwright/test';

const RUN_LOG_PATH = 'layout-check/v1_2025-01-01_00-00-00';

test.describe('dimension card geometry at default 520px pane width', () => {
  // The first navigation triggers Next.js compilation on CI; 60s covers it.
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(`/results/${RUN_LOG_PATH}`, { waitUntil: 'networkidle' });
    await page.locator('.mantine-Card-root').first().waitFor({ state: 'visible', timeout: 45_000 });
  });

  test('score picker stays within the dimension card clip rect', async ({ page }) => {
    const cards = page.locator('.mantine-Card-root');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    let measured = 0;
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const picker = card.locator('.mantine-SegmentedControl-root');
      if (await picker.count() === 0) continue;

      measured++;
      const cardBox = await card.boundingBox();
      const pickerBox = await picker.boundingBox();
      expect(cardBox).toBeTruthy();
      expect(pickerBox).toBeTruthy();

      const cardRight = cardBox!.x + cardBox!.width;
      const pickerRight = pickerBox!.x + pickerBox!.width;
      expect(pickerRight).toBeLessThanOrEqual(
        cardRight + 1, // 1px tolerance for subpixel rounding
      );
    }
    expect(measured).toBeGreaterThan(0);
  });

  test('long unbroken rationale does not overflow the card', async ({ page }) => {
    const overflowCard = page.locator('.mantine-Card-root').filter({ hasText: 'Overflow' });
    await expect(overflowCard).toBeVisible();

    const rationale = overflowCard.locator('p').filter({ hasText: 'Abcdefghij' });
    const { scrollWidth, clientWidth } = await rationale.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
