// Read-only browser regression: a hiring city far from headquarters must not zoom out the company view.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const use2gis = process.env.COMPANY_MAP_ENGINE === '2gis'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  if (!use2gis) await page.route('https://mapgl.2gis.com/**', route => route.abort())
  const companies = await (await context.request.get(`${base}/api/employers`)).json()
  const company = companies.find(e => e.name.includes('Ленинградский Металлический'))
  assert.ok(company, 'The reported company exists')
  const sites = await (await context.request.get(`${base}/api/employers/map-sites`)).json()
  const points = await (await context.request.get(`${base}/api/employers/map-points`)).json()
  const headquarters = sites.find(s => s.employer_id === company.id && s.kind === 'head_office')
  assert.ok(headquarters)
  const noHead = companies.find(e => points.some(p => p.employer_id === e.id) && !sites.some(s => s.employer_id === e.id && s.kind === 'head_office'))
  assert.ok(noHead, 'Hiring fallback can be verified')
  let captured
  await page.route('**/api/agent/chat', async route => {
    captured = route.request().postDataJSON()
    await route.fulfill({ json: { text: 'Перевірено.', tools_used: [], sources: [], artifacts: [], actions: [], sections: [], context: captured.context } })
  })
  // Registry data arrives after hiring data; the final camera still needs to prefer headquarters.
  await page.route('**/api/employers/map-sites', async route => {
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.fulfill({ json: sites })
  })
  async function checkFocus(target) {
    await page.locator(use2gis ? '.map-canvas canvas' : '.map-leaflet').first().waitFor()
    await page.waitForTimeout(1400)
    await page.locator('.map-agent-launch').click()
    await page.locator('.ag-context-tools > summary').click()
    await page.getByLabel('Область запитання').selectOption('viewport')
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Огляд області')?.disabled)
    captured = undefined
    await page.getByLabel('Питання агенту', { exact: true }).fill('Перевір область')
    await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
    await page.locator('.typing-msg').waitFor({ state: 'hidden' })
    assert.ok(captured?.context.map_scope.bounds)
    const bounds = captured.context.map_scope.bounds
    assert.ok(bounds.east - bounds.west < 0.3, 'Company camera must use a close city/street scale')
    assert.ok(target.lng > bounds.west && target.lng < bounds.east && target.lat > bounds.south && target.lat < bounds.north)
    const map = await page.locator('.map-slot').boundingBox()
    const card = await page.locator('.map-pop').boundingBox()
    const x = map.x + (target.lng - bounds.west) / (bounds.east - bounds.west) * map.width
    const mercator = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
    const y = map.y + (mercator(bounds.north) - mercator(target.lat)) / (mercator(bounds.north) - mercator(bounds.south)) * map.height
    assert.ok(x < card.x || x > card.x + card.width || y < card.y || y > card.y + card.height, 'Company card must not cover the camera target')
    await page.getByRole('button', { name: 'Закрити агента', exact: true }).click()
    console.log(`Company ${target.employer_id}: primary location in view, zoomed in and visible beside card: OK`)
  }
  await page.goto(`${base}/companies/${company.id}`)
  await page.locator('a.btn').filter({ hasText: 'На карті' }).click()
  await page.waitForURL(url => url.pathname === '/map' && url.searchParams.get('co') === String(company.id))
  await checkFocus(headquarters)
  await page.goto(`${base}/map?co=${noHead.id}`)
  await checkFocus(points.filter(p => p.employer_id === noHead.id).sort((a, b) => b.vacancies - a.vacancies)[0])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/map?co=${company.id}`)
  await checkFocus(headquarters)
  assert.deepEqual(errors, [])
} finally { await browser.close() }
