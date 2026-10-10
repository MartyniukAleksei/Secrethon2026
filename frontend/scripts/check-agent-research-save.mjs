// All API responses are fixtures: this test never reads or writes a production database.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5175'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const company = { id: 41, name: 'Тестове підприємство', source: 'hh', inn: null,
  focus: [], profiles: 1, vpk_vacancies: 1, confirmed_vacancies: 1, on_review_vacancies: 0,
  total_vacancies: 1, agency_vacancies: 0, new_30d: 1, median_salary: null, category: null,
  locality: null, region: null, region_id: null, human_review: null,
  gur_company_id: null, sanctions_count: 0, classification: null, agency: null }
const answer = { text: 'Заява джерела [s1]', as_of: null, tools_used: ['search_mentions'], artifacts: [],
  sources: [{ id: 's1', title: 'Вебматеріал', url: 'https://example.com/news', origin: 'public_web', verification: 'unverified' }],
  sections: [{ kind: 'public_web', text: 'Заява джерела [s1]', source_ids: ['s1'] }] }
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  const requests = []
  const saves = []
  const records = []
  let failSave = true
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://mapgl.2gis.com/**', route => route.abort())
  await page.route('https://tile.openstreetmap.org/**', route => route.abort())
  await page.route(`${base}/api/**`, async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/agent/chat') {
      const payload = request.postDataJSON()
      requests.push(payload)
      if (payload.web_access === 'ask') return route.fulfill({ json: {
        ...answer, sources: [], sections: [], web_permission: { company: company.name, days: 7 },
      } })
      return route.fulfill({ json: { ...answer, context: payload.context } })
    }
    if (path === '/api/agent/research') {
      if (request.method() === 'GET') return route.fulfill({ json: records })
      const payload = request.postDataJSON()
      saves.push(payload)
      if (failSave) { failSave = false; return route.fulfill({ status: 503, json: { detail: 'Тестова помилка БД' } }) }
      const record = { ...payload, approved_at: new Date().toISOString(), schema_version: 1 }
      records.push(record)
      return route.fulfill({ status: 201, json: record })
    }
    const fixtures = {
      '/api/stats': { regions_list: [], as_of: '2026-10-10T12:00:00Z' },
      '/api/employers': [company],
      '/api/employers/map-points': [], '/api/employers/map-sites': [],
      '/api/employers/map-network': { relations: [], company_tags: [] },
      '/api/agent/status': { enabled: true, model: 'gpt-6-luna', web_search: true },
    }
    return route.fulfill({ json: fixtures[path] ?? {} })
  })
  await page.goto(`${base}/map?co=41`)
  await page.locator('.map-agent-launch').click()
  async function ask(question) {
    await page.getByLabel('Питання агенту', { exact: true }).fill(question)
    await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
    await page.getByRole('group', { name: 'Дозвіл на пошук в інтернеті' }).waitFor()
  }
  await ask('Знайди вебматеріал')
  assert.equal(requests.at(-1).web_access, 'ask')
  await page.getByRole('button', { name: 'Шукати в базі та інтернеті', exact: true }).click()
  await page.getByRole('button', { name: 'Переглянути перед збереженням', exact: true }).click()
  const approve = page.getByRole('button', { name: 'Схвалити й зберегти', exact: true })
  const acknowledgement = page.getByLabel('Я переглянув відповідь і джерела та схвалюю збереження цієї версії.')
  await acknowledgement.check()
  assert.equal(await approve.isDisabled(), true, 'Web verification must be selected explicitly')
  assert.equal(saves.length, 0, 'Reviewing does not save')
  await page.getByLabel('Перевірка джерела s1', { exact: true }).selectOption('unverified')
  await page.getByLabel('Зберегти в БД для наступних досліджень', { exact: true }).check()
  await acknowledgement.check()
  await approve.click()
  await page.getByRole('alert').filter({ hasText: 'Тестова помилка БД' }).waitFor()
  assert.equal(await page.getByRole('status').filter({ hasText: 'Додано до контексту чату' }).count(), 0)
  await approve.click()
  await page.getByRole('status').filter({ hasText: 'збережено в БД' }).waitFor()
  assert.equal(saves.length, 2)
  assert.equal(saves[0].id, saves[1].id, 'Retry reuses its UUID')
  assert.equal(saves[1].approved, true)
  assert.equal(saves[1].employer_id, 41)
  assert.equal(saves[1].response.sources[0].verification, 'unverified')
  await ask('Уточни відповідь')
  const pinned = JSON.parse(requests.at(-1).approved_context[0])
  assert.match(pinned.text, /Заява джерела/)
  assert.equal(pinned.sources[0].verification, 'unverified')
  assert.equal(requests.at(-1).web_access, 'ask', 'Saved context does not authorize another web search')
  await page.getByRole('button', { name: 'Новий чат', exact: true }).click()
  await ask('Новий запит')
  assert.deepEqual(requests.at(-1).approved_context, [])
  await page.getByRole('button', { name: 'Новий чат', exact: true }).click()
  await page.getByRole('button', { name: 'Збережені дослідження', exact: true }).click()
  await page.getByRole('button', { name: 'Знайди вебматеріал', exact: true }).click()
  await page.getByText('Не перевірено', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Додати до контексту чату', exact: true }).click()
  await ask('Використай збережене')
  assert.equal(requests.at(-1).approved_context.length, 1)
  assert.deepEqual(errors, [])
  console.log('Web consent, explicit verification, approval, DB retry, chat context, reset and shared library: OK')
} finally { await browser.close() }
