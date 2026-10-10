// Fixture APIs only: no production DB reads/writes or web-search requests.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const card = (id, name) => ({ id, name, source: 'hh', focus: [], profiles: 1,
  vpk_vacancies: 1, total_vacancies: 1, confirmed_vacancies: 1,
  on_review_vacancies: 0, agency_vacancies: 0, new_30d: 0, sanctions_count: 0,
  region_id: null, locality: null, category: null, human_review: null })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const requests = []
  await page.route('**/mapgl.2gis.com/**', route => route.abort())
  await page.route('**/tile.openstreetmap.org/**', route => route.abort())
  await page.route(`${base}/api/**`, route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/agent/chat') {
      const payload = route.request().postDataJSON()
      requests.push(payload)
      const answer = { text: 'Відповідь про Калашников', artifacts: [], sources: [],
        tools_used: ['company_profile', 'show_on_map'],
        map_action: { kind: 'focus_company', employer_id: 42 }, context: payload.context }
      if (payload.web_access === 'ask') answer.web_permission = { company: 'Калашников', days: 7 }
      return route.fulfill({ json: answer })
    }
    const fixtures = {
      '/api/stats': { regions_list: [], as_of: '2026-10-10T12:00:00Z' },
      '/api/employers': [card(41, 'Алабуга'), card(42, 'Калашников')],
      '/api/employers/map-points': [], '/api/employers/map-sites': [],
      '/api/employers/map-network': { relations: [], company_tags: [] },
      '/api/agent/status': { enabled: true, web_search: true, model: 'gpt-6-luna' },
    }
    return route.fulfill({ json: fixtures[path] ?? {} })
  })
  await page.goto(`${base}/map?co=41`)
  await page.locator('.map-agent-launch').click()
  await page.getByLabel('Питання агенту', { exact: true }).fill('Що виробляє Калашников?')
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
  await page.getByRole('group', { name: 'Дозвіл на пошук в інтернеті' }).waitFor()
  await page.waitForURL(url => url.searchParams.get('co') === '42')
  assert.equal(requests.length, 1, 'No search before user choice')
  await page.getByRole('button', { name: 'Шукати в базі', exact: true }).click()
  await page.getByText('Відповідь про Калашников', { exact: true }).waitFor()
  assert.equal(requests.at(-1).web_access, 'db_only')
  assert.equal(requests.at(-1).message, 'Що виробляє Калашников?')
  assert.equal(new URL(page.url()).searchParams.get('co'), '42')
  console.log('Company switch before web consent; database-only continuation: OK')
} finally { await browser.close() }
