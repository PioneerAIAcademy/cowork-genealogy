/**
 * Happy-path E2E for the CRUD UI scoring flow.
 *
 * Exercises the wiki-lookup run log produced by the harness:
 *   - Lands at /results
 *   - Navigates into the latest wiki-lookup run log
 *   - Clicks "Agree All" on the first test
 *   - Verifies the save indicator + the progress sidebar updates
 *   - Visits /results/compare (with a single run log on disk, sees the
 *     graceful empty state for `previous`)
 *   - Visits /results/trend
 *   - Opens the help modal via the ? button
 */
import { test, expect } from '@playwright/test';

test.describe('CRUD UI — scoring flow against real wiki-lookup run log', () => {
  test('list → detail → annotate → compare → trend → help', async ({ page }) => {
    // 1. Land at /results, pick a skill from the sticky header picker,
    //    then see the wiki-lookup run log card appear.
    await page.goto('/results');
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
    await page.getByPlaceholder('(none — pick a skill)').click();
    await page.getByRole('option', { name: 'wiki-lookup' }).click();
    await expect(page.getByRole('heading', { name: 'wiki-lookup' })).toBeVisible();

    // 2. Click into the latest wiki-lookup run log (first row).
    //    The id is wiki-lookup/v1_<timestamp>; we click the link by partial text.
    const runLogLink = page.getByRole('link', { name: /^v1_/ }).first();
    await runLogLink.click();
    await expect(page.getByText('v1 candidate')).toBeVisible();

    // 3. The progress sidebar shows total reviewed; initially 0/N.
    await expect(page.getByText(/Progress: 0\//)).toBeVisible();

    // 4. Click "Agree All" on the first test.
    const agreeButtons = page.getByRole('button', { name: 'Agree All' });
    await agreeButtons.first().click();

    // 5. Wait for the save to land — header status flips to "saved".
    await expect(page.getByText('saved').first()).toBeVisible({ timeout: 5000 });

    // 6. Progress sidebar reflects the corrections.
    //    After agree-with-all on one test, reviewed count should be > 0.
    await expect(page.getByText(/Progress: [1-9]\d*\//)).toBeVisible();

    // 7. Open the help modal via the ? button.
    await page.getByRole('button', { name: '?' }).first().click();
    await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');

    // 8. Visit /results/compare. With one run log on disk, comparison is
    //    not fully populated; just verify the page renders.
    await page.goto('/results/compare');
    await expect(page.getByRole('heading', { name: 'Compare versions' })).toBeVisible();

    // 9. Visit /results/trend?skill=wiki-lookup. No released versions yet,
    //    so the page should render an empty-state message.
    await page.goto('/results/trend?skill=wiki-lookup');
    await expect(page.getByRole('heading', { name: 'Trend' })).toBeVisible();
    await expect(page.getByText(/No released versions/)).toBeVisible();
  });
});
