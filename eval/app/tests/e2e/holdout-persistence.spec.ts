/**
 * Tests-section mutations must be visible on the first render of the views
 * that read them (issue #1605: the "hold out from the skill-improver" toggle
 * read as off again after Save).
 *
 * The write path was never the problem — the file on disk was right. The app
 * writes a file and then reads its own react-query cache, and `TestForm`'s
 * save and the edit page's delete navigated with `router.push` without
 * invalidating `['tests']` / `['test', id]`; with `staleTime: 5_000` the
 * destination painted the pre-save copy for five seconds. The results pages
 * never showed it because they navigate with `window.location.href`, a full
 * document load that discards the cache.
 *
 * Three things this spec has to get right, each measured while designing it:
 *
 * - The cache must be WARM. `TestForm`'s own tag query uses a different key
 *   (`['tests-for-tags']`), so opening the edit page cold never caches
 *   `['tests']` and the pre-fix list fetches fresh. Every flow visits `/tests`
 *   first and then navigates client-side — a `page.goto` is a full load that
 *   would throw the QueryClient away and hide the bug.
 * - `{ timeout: 0 }` is UNBOUNDED in Playwright, not immediate. "First render"
 *   is asserted by holding the list's `GET /api/tests` for 2 s and asserting
 *   with a bounded 1 s timeout: pre-fix, the destination mounts on the cached
 *   pre-save row and nothing arrives in time; fixed, the *awaited* invalidate
 *   refetch is what the hold delays — before `router.push` — so the
 *   destination mounts on fresh data.
 * - The list is empty until a header skill is chosen (`useSelectedSkill`,
 *   Mantine `useLocalStorage`), so every page seeds `eval.selectedSkill`.
 *
 * Data lives only under the temp `EVAL_DIR` tree `create-fixture.ts` builds at
 * config load (workers inherit `process.env`); nothing under the repo's
 * `eval/tests/unit/` is touched — `test.holdout` is grading-relevant and a
 * real-file write would flip a run log inactive.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { SKILL } from './create-fixture';

const SEEDED_ID = `ut_${SKILL.replace(/-/g, '_')}_001`;
const HOLD_MS = 2_000;
const FIRST_RENDER_MS = 1_000;
// The dev server compiles a route on its first hit; only the warm-up steps wait for that.
const COMPILE_MS = 60_000;
const TOGGLE_LABEL = 'Hold out from the skill-improver';

function testsDir(): string {
  const evalDir = process.env.EVAL_DIR;
  if (!evalDir) throw new Error('EVAL_DIR is not set — playwright.config.ts creates the fixture tree');
  return path.join(evalDir, 'tests', 'unit', SKILL);
}

function seedFile(): string {
  return path.join(testsDir(), `${SEEDED_ID}.json`);
}

/** The file whose `test.id` is `id`, or null — `readTest` locates by id, not filename. */
function fileFor(id: string): string | null {
  for (const name of fs.readdirSync(testsDir())) {
    if (!name.endsWith('.json')) continue;
    const p = path.join(testsDir(), name);
    try {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (doc?.test?.id === id) return p;
    } catch {
      // not ours
    }
  }
  return null;
}

/**
 * Hold the LIST fetch so a stale first paint cannot be rescued by a background
 * refetch. Installed per test (each test has its own page) and never removed:
 * a handler still sleeping when the page closes must not throw.
 */
async function holdListFetch(page: Page): Promise<void> {
  await page.route('**/api/tests', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue().catch(() => {});
  });
}

function row(page: Page, id: string) {
  return page.getByRole('row').filter({ hasText: id });
}

/** Mantine's Switch input is visually hidden; the <label for> is what a user clicks. */
async function toggleHoldout(page: Page): Promise<void> {
  await page.getByText(TOGGLE_LABEL, { exact: true }).click();
}

// File order with one worker (playwright.config.ts: workers 1, fullyParallel false) is
// what the create → delete pair relies on; not `serial`, so one failing flow does not
// skip the observations the others record.
test.describe('Tests section — a save or delete is visible on the first render after it', () => {
  // The first navigation compiles the Next.js routes; the bounded waits below
  // are the FIRST_RENDER_MS assertions only.
  test.setTimeout(120_000);

  // Idempotent, and no cleanup hook: Playwright restarts the worker after a
  // failed test and re-runs the describe's hooks, so a cleanup here would
  // delete the file the create flow just wrote before the delete flow looks
  // for it. The whole temp tree is removed by the harness's globalTeardown.
  test.beforeAll(() => {
    fs.mkdirSync(testsDir(), { recursive: true });
    if (fs.existsSync(seedFile())) return;
    // Mirrors TestForm's EMPTY_TEST so the form can save it unchanged: `tags`
    // must exist (the list dereferences it), and exactly one of
    // `user_message` / `delegation` must be non-empty.
    fs.writeFileSync(
      seedFile(),
      JSON.stringify(
        {
          test: {
            id: SEEDED_ID,
            skill: SKILL,
            name: 'Holdout persistence seed',
            description: 'Seeded by holdout-persistence.spec.ts; lives only in the temp EVAL_DIR.',
            type: 'positive',
            tags: [],
          },
          input: { user_message: 'Where was John Smith born?', scenario: null, scenario_notes: null },
          mcp_fixtures: [],
          judge_context: [],
        },
        null,
        2,
      ),
    );
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((skill) => {
      localStorage.setItem('eval.selectedSkill', JSON.stringify(skill));
    }, SKILL);
  });

  test('edit: toggling holdout is on the list badge and the edit page on first render, and on disk', async ({ page }) => {
    // Warm the ['tests'] cache the way a user would — from the list.
    await page.goto('/tests');
    const seeded = row(page, SEEDED_ID);
    await expect(seeded).toBeVisible({ timeout: COMPILE_MS });
    await expect(seeded.getByText('holdout', { exact: true })).toHaveCount(0);

    await seeded.getByRole('link', { name: 'Holdout persistence seed' }).click();
    await page.waitForURL(`**/tests/${SEEDED_ID}`);
    const toggle = page.getByLabel(TOGGLE_LABEL);
    await expect(toggle).not.toBeChecked({ timeout: COMPILE_MS });

    await holdListFetch(page);
    await toggleHoldout(page);
    await expect(toggle).toBeChecked();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL('**/tests');

    // The issue's deciding observation: the write reached disk regardless.
    const onDisk = JSON.parse(fs.readFileSync(seedFile(), 'utf8'));
    expect(onDisk.test.holdout).toBe(true);

    // First render of the list after the save.
    await expect.soft(row(page, SEEDED_ID).getByText('holdout', { exact: true })).toBeVisible({
      timeout: FIRST_RENDER_MS,
    });

    // First render of the edit page after the save (client-side navigation).
    await row(page, SEEDED_ID).getByRole('link', { name: 'Holdout persistence seed' }).click();
    await page.waitForURL(`**/tests/${SEEDED_ID}`);
    await expect.soft(page.getByLabel(TOGGLE_LABEL)).toBeChecked({ timeout: FIRST_RENDER_MS });
  });

  test('create: a new holdout test is on the list on first render, and on disk', async ({ page }) => {
    await page.goto('/tests');
    await expect(row(page, SEEDED_ID)).toBeVisible({ timeout: COMPILE_MS });

    await page.getByRole('link', { name: 'New test' }).click();
    await page.waitForURL('**/tests/new');
    // Mantine's Select/Textarea expose plain textboxes; the header skill pre-fills Skill.
    const skillSelect = page.getByRole('textbox', { name: 'Skill', exact: true });
    await expect(skillSelect).toBeVisible({ timeout: COMPILE_MS });
    if ((await skillSelect.inputValue()) !== SKILL) {
      await skillSelect.click();
      await page.getByRole('option', { name: SKILL }).click();
    }
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Holdout persistence created');
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Created through the UI by the spec.');
    await page.getByRole('textbox', { name: 'User message', exact: true }).fill('Find the 1880 census for Mary Jones.');
    await toggleHoldout(page);
    await expect(page.getByLabel(TOGGLE_LABEL)).toBeChecked();

    await holdListFetch(page);
    await page.getByRole('button', { name: 'Create test' }).click();
    await page.waitForURL(/\/tests\/ut_layout_check_[A-Za-z0-9]+$/);
    const createdId = page.url().split('/').pop()!;
    expect(createdId).not.toBe(SEEDED_ID);

    const created = fileFor(createdId);
    expect(created, `no file under EVAL_DIR carries test.id ${createdId}`).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(created!, 'utf8')).test.holdout).toBe(true);

    await page.getByRole('link', { name: '← back to tests' }).click();
    await page.waitForURL('**/tests');
    const newRow = row(page, createdId);
    await expect.soft(newRow).toBeVisible({ timeout: FIRST_RENDER_MS });
    await expect.soft(newRow.getByText('holdout', { exact: true })).toBeVisible({ timeout: FIRST_RENDER_MS });
  });

  test('delete: the row is gone from the list on first render, and from disk', async ({ page }) => {
    await page.goto('/tests');
    const target = row(page, 'Holdout persistence created');
    await expect(target).toBeVisible({ timeout: COMPILE_MS });
    const createdId = (await target.getByText(/^ut_layout_check_/).textContent())!.trim();
    expect(fileFor(createdId)).not.toBeNull();

    await target.getByRole('link', { name: 'Holdout persistence created' }).click();
    await page.waitForURL(`**/tests/${createdId}`);

    page.once('dialog', (dialog) => dialog.accept());
    await holdListFetch(page);
    await page.getByRole('button', { name: 'Delete test' }).click();
    await page.waitForURL('**/tests');

    expect(fileFor(createdId)).toBeNull();
    await expect.soft(row(page, createdId)).toHaveCount(0, { timeout: FIRST_RENDER_MS });
  });
});
