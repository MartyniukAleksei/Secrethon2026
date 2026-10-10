// Fixture application APIs; real 2GIS renderer. No production database access.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${base}/api/**`, route => {
    const path = new URL(route.request().url()).pathname
    const fixtures = {
      '/api/stats': { regions_list: [], as_of: '2026-10-10T12:00:00Z' },
      '/api/employers': [], '/api/employers/map-points': [], '/api/employers/map-sites': [],
      '/api/employers/map-network': { relations: [], company_tags: [] },
      '/api/agent/status': { enabled: true, web_search: false, model: 'gpt-6-luna' },
    }
    return route.fulfill({ json: fixtures[path] ?? {} })
  })
  await page.goto(`${base}/map`)
  await page.locator('.map-canvas canvas').first().waitFor({ timeout: 45000 })
  await page.waitForTimeout(1000)
  assert.equal(await page.locator('.map-leaflet').count(), 0, 'Verify the 2GIS renderer')
  async function fillsContainer(label) {
    await page.waitForFunction(() => {
      const container = document.querySelector('.map-canvas')
      const canvas = container?.querySelector('canvas')
      if (!canvas) return false
      const a = container.getBoundingClientRect(), b = canvas.getBoundingClientRect()
      return Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2
    }, null, { timeout: 10000 })
    console.log(`${label}: renderer fills container: OK`)
  }
  await fillsContainer('Initial load')
  await page.evaluate(() => {
    const slot = document.querySelector('.map-slot')
    slot.style.width = `${slot.getBoundingClientRect().width + 40}px`
  })
  await fillsContainer('Container grows 40px without window resize')
  await page.evaluate(() => { document.querySelector('.map-slot').style.width = '' })
  await page.locator('.map-agent-launch').click()
  await fillsContainer('Agent panel opens')
  await page.getByRole('button', { name: 'Закрити агента', exact: true }).click()
  await fillsContainer('Agent panel closes')
  await page.setViewportSize({ width: 850, height: 900 })
  await fillsContainer('Mobile layout')
  assert.deepEqual(errors, [])
} finally { await browser.close() }
