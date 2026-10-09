// Live integration check: real browser, backend, Gemini and read-only map data.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const consentCheck = process.argv.includes('--web-consent')
  const relationCheck = process.argv.includes('--relations')
  await page.route('https://mapgl.2gis.com/**', route => route.abort())
  let mapUrl = `${base}/map`
  if (consentCheck || relationCheck) {
    const rows = await (await page.request.get(`${base}/api/employers`)).json()
    const company = rows.find(e => e.name.includes('Алабуга.'))
    assert.ok(company)
    mapUrl += `?co=${company.id}`
  }
  await page.goto(mapUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('.map-agent-launch').click()
  await page.getByLabel('Питання агенту', { exact: true }).fill(relationCheck ? 'Покажи звязки алабуги' : consentCheck ? 'Знайди свіжі публічні згадки саме цього підприємства за останні 7 днів.' : 'Розкажи коротко про Алабугу Політех і наблизь на карті.')
  const reply = page.waitForResponse(r => r.url().endsWith('/api/agent/chat'), { timeout: 190000 })
  await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
  console.log('Live browser: submitted request; waiting for Gemini')
  const response = await reply
  assert.equal(response.status(), 200, `Agent returned HTTP ${response.status()}`)
  const data = await response.json()
  if (consentCheck) {
    assert.ok(data.web_permission?.company)
    assert.equal(data.web_permission.days, 7)
    assert.equal(data.sources.length, 0)
    assert.equal(data.map_action, null)
    await page.getByRole('group', { name: 'Дозвіл на пошук в інтернеті' }).waitFor()
    console.log('Live browser: Gemini requests web permission before Tavily; no web evidence or navigation yet: OK')
  } else if (relationCheck) {
    assert.equal(data.map_action?.kind, 'show_relations')
    await page.waitForURL(url => url.searchParams.get('network_other') === '1' && url.searchParams.get('co') === String(data.map_action.employer_id))
    await page.locator('.map-network-status').waitFor()
    console.log('Live browser: Alabuga request opens its recorded network, including related-company links: OK')
  } else {
    assert.equal(data.map_action?.kind, 'focus_company')
    assert.ok(data.sources.some(s => s.origin === 'database'))
    await page.waitForURL(url => url.searchParams.get('co') === String(data.map_action.employer_id))
    await page.locator('.typing-msg').waitFor({ state: 'hidden' })
    assert.equal(await page.getByText('Gemini недоступний.', { exact: false }).count(), 0)
    console.log('Live browser: Gemini HTTP 200, grounded answer and automatic company navigation: OK')
  }
} finally {
  await browser.close()
}
