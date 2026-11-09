import { expect, test, type Page } from '@playwright/test';

const fixturePath = '/auth-path-fallback';
const fallback = (page: Page) => page.getByRole('link', { name: 'Sign in with ChatGPT' });
const authRoute = (page: Page) =>
  page.getByRole('heading', { name: 'Auth route reached with GET' });

// Playwright disables the back/forward cache by default in Chromium.
test.use({ launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] } });

test('authPath fallback starts sign-in after returning with Back', async ({ page }, testInfo) => {
  await page.goto(fixturePath);
  const button = page.getByRole('button', { name: 'Continue with ChatGPT' });
  await button.click();
  await expect(authRoute(page)).toBeVisible();

  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(new RegExp(`${fixturePath}$`));
  const document = page.locator('html');
  await expect(document).toHaveAttribute('data-restored-from-cache', /^(true|false)$/);
  const restored = (await document.getAttribute('data-restored-from-cache')) === 'true';
  testInfo.annotations.push({
    type: 'history return',
    description: restored ? 'back/forward cache restore' : 'fresh document',
  });
  if (restored) {
    await expect(button).toBeDisabled();
  }

  await fallback(page).click();
  await expect(authRoute(page)).toBeVisible();
});

test.describe('authPath fallback without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('starts sign-in from the initial HTML', async ({ page }) => {
    await page.goto(fixturePath);
    await expect(page.getByRole('button')).toHaveCount(0);
    await fallback(page).click();
    await expect(authRoute(page)).toBeVisible();
  });
});
