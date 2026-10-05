import { test, expect } from '@playwright/test';

test('dashboard, contact CRUD, disclosure, consent, style import and date brief', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Хороший день для общения' })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Добавить контакт', exact: true }).first().click();
  await page.getByLabel('Имя', { exact: true }).fill('Тест ' + Date.now());
  const name = await page.getByLabel('Имя', { exact: true }).inputValue();
  await page.getByLabel('Telegram ID или @username').fill(String(Date.now()));
  await page.getByRole('dialog').getByRole('button', { name: 'Добавить контакт', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Контакты', exact: true }).click();
  await page.getByLabel('Поиск контакта').fill(name);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть диалог' }).click();
  await page.getByRole('button', { name: 'Отправить уведомление' }).click();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Уведомление отправлено. Ждём согласия: /agree.')).toBeVisible();
  await page.getByRole('button', { name: 'Входящее в демо' }).click();
  await page.getByLabel('Текст собеседницы').fill('/agree');
  await page.getByRole('button', { name: 'Добавить сообщение' }).click();
  await expect(page.locator('.chat-header .badge')).toHaveText('Автоответы');
  await page.getByRole('button', { name: 'Мой стиль', exact: true }).click();
  await page.getByRole('button', { name: 'Импорт Telegram JSON' }).click();
  const data = {
    id: 111,
    name: 'Style sample',
    type: 'personal_chat',
    messages: Array.from({ length: 8 }, (_, id) => ({
      id,
      type: 'message',
      from: 'Мои примеры',
      from_id: 'user100',
      text: 'Привет! Как прошёл день?',
      date_unixtime: '1700000000',
    })),
  };
  await page.locator('#import-file').setInputFiles({
    name: 'export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByLabel('Кто из авторов — вы?').selectOption('user100');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Проанализировать стиль' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('Тон', { exact: true })).toHaveValue('Тёплый, лёгкий, с мягкой иронией');
  await page.getByRole('button', { name: 'Свидания', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить встречу', exact: true }).click();
  await page.getByRole('combobox', { name: 'С кем', exact: true }).selectOption({ label: name });
  await page.getByLabel('Место', { exact: true }).fill('Тестовая кофейня');
  await page.getByRole('button', { name: 'Сохранить и подготовить' }).click();
  await expect(page.getByRole('heading', { name: 'Тестовая кофейня', exact: true })).toBeVisible();
  await expect(page.getByText('Что важно помнить').first()).toBeVisible();
  await page.getByRole('button', { name: 'Контакты', exact: true }).click();
  await page.getByRole('button', { name: 'Настроить', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить контакт' }).click();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { name: 'Пока никого нет' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile navigation and layout remain within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Хороший день для общения' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Всё под вашим контролем' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
