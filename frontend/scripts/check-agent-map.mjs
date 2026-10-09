// Browser verification: real map data; deterministic agent responses for approval checks.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, channel: process.env.AGENT_BROWSER_CHANNEL ?? 'chrome' })
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  await page.route('https://mapgl.2gis.com/**', route => route.abort())
  let captured
  let release
  let ids
  const generatedAt = new Date().toISOString()
  await page.route('**/api/agent/chat', async route => {
    captured = route.request().postDataJSON()
    await new Promise(resolve => { release = resolve })
    await route.fulfill({ json: {
      text: 'Тестовий підсумок: 7 вакансій [s1]. Вебматеріал потребує перевірки [s2].',
      sections: [
        { kind: 'database', text: 'Тестовий підсумок: 7 вакансій [s1].', source_ids: ['s1'] },
        { kind: 'public_web', text: 'Вебматеріал потребує перевірки [s2].', source_ids: ['s2'] },
        { kind: 'analysis', text: 'Тестовий висновок на основі даних [s1].', source_ids: ['s1'] },
      ],
      sources: [
        { id: 's1', title: 'Запис платформи', url: `/companies/${ids[0]}`, origin: 'database', retrieved_at: generatedAt, verification: 'database_record' },
        { id: 's2', title: 'Вебматеріал', url: 'https://example.com/research', origin: 'public_web', retrieved_at: generatedAt, excerpt: 'Збережений фрагмент вебматеріалу', verification: 'unverified' },
      ], artifacts: [], as_of: generatedAt, generated_at: generatedAt, tools_used: ['analytics'],
      actions: [{ kind: 'show_companies', employer_ids: ids }], context: captured.context,
      scope_totals: { employers: 2400, vacancies: 7000, salary_samples: 10, median_salary: 90000 },
      evidence: [{ tool: 'analytics', result: { vacancies: 7 } }],
    } })
  })
  const employersResponse = await context.request.get(`${base}/api/employers`)
  assert.equal(employersResponse.status(), 200)
  const employers = await employersResponse.json()
  ids = employers.slice(0, 2).map(e => e.id)
  assert.equal(ids.length, 2)
  await page.goto(`${base}/map`)
  await page.getByRole('button', { name: 'Запитати агента на карті', exact: true }).waitFor({ timeout: 45000 })
  assert.equal(await page.locator('.map-agent-bar').count(), 0)
  assert.equal(await page.locator('.map-settings').getAttribute('open'), null)
  const launcher = await page.locator('.map-agent-launch').boundingBox()
  assert.ok(launcher.y + launcher.height <= 1000, 'Map agent launcher must be visible without scrolling')
  await page.getByRole('button', { name: 'Карта на весь екран', exact: true }).click()
  await page.waitForFunction(() => document.fullscreenElement)
  await page.getByRole('button', { name: 'Запитати агента на карті', exact: true }).click()
  await page.waitForFunction(() => !document.fullscreenElement)
  assert.equal(await page.getByRole('tablist', { name: 'Режим агента' }).count(), 0)
  await page.locator('.ag-context-tools > summary').click()
  await page.getByRole('button', { name: 'Огляд області', exact: true }).waitFor({ timeout: 45000 })
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Огляд області')?.disabled)
  await page.getByRole('button', { name: 'Огляд області', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.typing-msg'))
  assert.equal(captured.context.map_scope.mode, 'viewport')
  assert.ok(captured.context.map_scope.bounds)
  const frozenBounds = structuredClone(captured.context.map_scope.bounds)
  await page.locator('.leaflet-control-zoom-out').click()
  assert.deepEqual(captured.context.map_scope.bounds, frozenBounds)
  release()
  await page.getByRole('button', { name: 'Переглянути перед збереженням', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('secrethon.approved-research.v1')), null)
  assert.equal(await page.locator('.ag-origin-database').count(), 1)
  assert.equal(await page.locator('.ag-origin-public_web').count(), 1)
  await page.getByRole('button', { name: 'Переглянути перед збереженням', exact: true }).click()
  const approve = page.getByRole('button', { name: 'Схвалити й зберегти', exact: true })
  assert.equal(await approve.isDisabled(), true)
  await page.getByLabel('Я переглянув відповідь і джерела та схвалюю збереження цієї версії.').check()
  await approve.click()
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('secrethon.approved-research.v1')))
  assert.equal(records.length, 1)
  assert.equal(records[0].response.sources[1].verification, 'unverified')
  assert.equal(records[0].response.sources[1].excerpt, 'Збережений фрагмент вебматеріалу')
  assert.deepEqual(records[0].context.map_scope.bounds, frozenBounds)
  await page.reload()
  await page.getByRole('button', { name: 'Запитати агента на карті', exact: true }).click()
  await page.getByRole('button', { name: 'Збережені дослідження', exact: true }).click()
  await page.locator('.ag-library-title').click()
  assert.ok(await page.locator('.ag-origin-public_web').innerText())
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Експорт .md', exact: true }).click()
  assert.ok((await downloadPromise).suggestedFilename().endsWith('.md'))
  await page.getByRole('link', { name: 'Показати підприємства на карті', exact: true }).click()
  await page.waitForURL('**/map?agent_ids=*')
  await page.waitForFunction(() => document.querySelectorAll('.map-list .co-row').length === 2)
  assert.equal(await page.locator('.map-list .co-row').count(), 2)
  await page.locator(`.map-list a[href*="co=${ids[0]}"]`).click()
  await page.getByRole('button', { name: 'Запитати агента на карті', exact: true }).click()
  await page.locator('.ag-context-tools > summary').click()
  await page.getByRole('button', { name: 'Додати до порівняння', exact: true }).click()
  assert.equal(await page.locator('.map-list .co-row').count(), 2)
  await page.locator(`.map-list a[href*="co=${ids[1]}"]`).click()
  await page.getByRole('button', { name: 'Додати до порівняння', exact: true }).click()
  await page.getByRole('button', { name: 'Порівняти (2/5)', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.typing-msg'))
  assert.equal(captured.context.map_scope.mode, 'selection')
  assert.deepEqual(captured.context.map_scope.employer_ids, ids)
  release()
  await page.locator('.typing-msg').waitFor({ state: 'hidden' })
  await mkdir('node_modules/.tmp', { recursive: true })
  await page.screenshot({ path: 'node_modules/.tmp/agent-map-preview.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 844 })
  await page.getByRole('button', { name: 'Закрити агента', exact: true }).click()
  await page.getByRole('button', { name: 'Запитати агента на карті', exact: true }).click()
  const mobilePanel = await page.locator('.agent').boundingBox()
  assert.equal(mobilePanel.y, 0)
  assert.equal(mobilePanel.height, 844)
  assert.equal(mobilePanel.width, 375)
  assert.deepEqual(failures, [])
  console.log('Browser checks: visible map launcher, fullscreen, mobile panel, viewport snapshot, evidence sections, manual approval, reload, export, map actions and comparison: OK')
} finally { await browser.close() }
