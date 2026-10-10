// Fixture APIs only: verify navigation and camera framing without production writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const places = [
  { employer_id: 41, lat: 55, lng: 37 },
  { employer_id: 41, lat: 56, lng: 38 },
  { employer_id: 42, lat: 52, lng: 30 },
]
const card = (id, name) => ({ id, name, source: 'hh', focus: [], profiles: 1,
  vpk_vacancies: 1, total_vacancies: 1, confirmed_vacancies: 1,
  on_review_vacancies: 0, agency_vacancies: 0, new_30d: 0, sanctions_count: 0,
  region_id: null, locality: null, category: null, human_review: null })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const requests = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/mapgl.2gis.com/**', route => route.abort())
  await page.route('**/tile.openstreetmap.org/**', route => route.abort())
  await page.route(`${base}/api/**`, route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/agent/chat') {
      const payload = route.request().postDataJSON()
      requests.push(payload)
      return route.fulfill({ json: { text: 'Показано місця найму.', artifacts: [], sources: [], tools_used: [],
        ...(requests.length === 1 ? { map_action: { kind: 'show_hiring_places', employer_id: 41, employer_ids: [41, 42], places } } : {}),
        context: payload.context } })
    }
    const fixtures = {
      '/api/stats': { regions_list: [], as_of: '2026-10-10T12:00:00Z' },
      '/api/employers': [card(41, 'УАЗ'), card(42, 'Калашников')],
      '/api/employers/map-points': places.map(p => ({ ...p, vacancies: 1 })),
      '/api/employers/map-sites': [{ employer_id: 41, kind: 'head_office', lat: 60, lng: 70 }],
      '/api/employers/map-network': { relations: [], company_tags: [] },
      '/api/agent/status': { enabled: true, web_search: false, model: 'gpt-6-luna' },
    }
    return route.fulfill({ json: fixtures[path] ?? {} })
  })
  await page.goto(`${base}/map?co=41`)
  await page.locator('.map-leaflet').waitFor()
  await page.locator('.map-agent-launch').click()
  await page.getByLabel('Питання агенту', { exact: true }).fill('Покажи місця найму УАЗ і Калашникова на карті')
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('hiring_places'))
  assert.deepEqual(JSON.parse(new URL(page.url()).searchParams.get('hiring_places')), places)
  await page.locator('.typing-msg').waitFor({ state: 'hidden' })
  await page.locator('.ag-context-tools > summary').click()
  await page.getByLabel('Область запитання').selectOption('viewport')
  await page.waitForTimeout(1000)
  await page.getByLabel('Питання агенту', { exact: true }).fill('Перевір область')
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.typing-msg'))
  const bounds = requests.at(-1).context.map_scope.bounds
  assert.ok(bounds)
  for (const p of places) assert.ok(p.lng > bounds.west && p.lng < bounds.east && p.lat > bounds.south && p.lat < bounds.north,
    `Hiring location ${p.employer_id}:${p.lat},${p.lng} is in view`)
  assert.ok(bounds.east < 70, 'Distant headquarters must not control hiring-place framing')
  assert.deepEqual(errors, [])
  console.log('Agent navigation: all three hiring places from two employers in view; headquarters excluded: OK')
} finally { await browser.close() }
