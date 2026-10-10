// Real 2GIS tiles with synthetic locations near the date line; no production DB.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const card = id => ({ id, name: `Тест ${id}`, source: 'hh', focus: [], profiles: 1,
    vpk_vacancies: 1, total_vacancies: 1, confirmed_vacancies: 1, on_review_vacancies: 0,
    agency_vacancies: 0, new_30d: 0, sanctions_count: 0, region_id: null, locality: null,
    category: null, human_review: null })
  await page.route(`${base}/api/**`, route => {
    const fixtures = {
      '/api/stats': { regions_list: [], as_of: '2026-10-10T12:00:00Z' },
      '/api/employers': [card(1), card(2)],
      '/api/employers/map-points': [
        { employer_id: 1, lat: 50, lng: 30, vacancies: 1 },
        { employer_id: 2, lat: 65, lng: 179, vacancies: 1 },
      ],
      '/api/employers/map-sites': [], '/api/employers/map-network': { relations: [], company_tags: [] },
      '/api/agent/status': { enabled: true, web_search: false, model: 'gpt-6-luna' },
    }
    return route.fulfill({ json: fixtures[new URL(route.request().url()).pathname] ?? {} })
  })
  await page.goto(`${base}/map`)
  await page.locator('.map-canvas canvas').first().waitFor({ timeout: 45000 })
  await page.waitForTimeout(3000)
  await mkdir('.cache/map-world-edge', { recursive: true })
  const label = process.argv[2] === 'before' ? 'before' : 'after'
  await page.locator('.map-slot').screenshot({ path: `.cache/map-world-edge/${label}-wide.png` })
  await page.locator('.map-agent-launch').click()
  await page.waitForTimeout(2000)
  await page.locator('.map-slot').screenshot({ path: `.cache/map-world-edge/${label}-agent.png` })
  assert.equal(await page.locator('.map-leaflet').count(), 0)
  assert.deepEqual(errors, [])
  console.log(`2GIS wide view and agent-panel screenshots: .cache/map-world-edge/${label}-*.png`)
} finally { await browser.close() }
