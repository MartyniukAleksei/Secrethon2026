// Real map records and deterministic replies verify navigation independently of Gemini.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://mapgl.2gis.com/**', route => route.abort())
  const employers = await (await context.request.get(`${base}/api/employers`)).json()
  const company = employers.find(e => e.name.includes('Алабуга.'))
  const other = employers.find(e => e.id !== company.id)
  assert.ok(company && other)
  const points = (await (await context.request.get(`${base}/api/employers/map-points`)).json())
    .filter(p => p.employer_id === company.id)
  const sites = await (await context.request.get(`${base}/api/employers/map-sites`)).json()
  const ownSites = sites.filter(p => p.employer_id === company.id)
  const target = ownSites.find(s => s.kind === 'head_office') ?? [...points].sort((a, b) => b.vacancies - a.vacancies)[0] ?? ownSites[0]
  let captured
  let release
  let command = { kind: 'focus_company', employer_id: company.id }
  await page.route('**/api/agent/chat', async route => {
    captured = route.request().postDataJSON()
    await new Promise(resolve => { release = resolve })
    await route.fulfill({ json: {
      text: `${company.name} [s1]`, artifacts: [], tools_used: ['company_profile', 'show_on_map'],
      sources: [{ id: 's1', title: company.name, url: `/companies/${company.id}`, origin: 'database' }],
      sections: [{ kind: 'database', text: `${company.name} [s1]`, source_ids: ['s1'] }],
      context: captured.context, actions: [], map_action: command, as_of: null,
    } })
  })
  await page.goto(`${base}/map?co=${other.id}&agent_ids=${other.id}&layers=parent&network=1`)
  await page.locator('.map-agent-launch').click()
  async function submit(question) {
    await page.getByLabel('Питання агенту', { exact: true }).fill(question)
    await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
    await page.locator('.typing-msg').waitFor()
    await page.waitForFunction(() => document.querySelector('.typing-msg'))
    // The intercepted request can start after React displays the typing indicator.
    while (!release) await new Promise(resolve => setTimeout(resolve, 10))
  }
  async function finish() {
    release(); release = undefined
    await page.locator('.typing-msg').waitFor({ state: 'hidden' })
  }
  await submit('Розкажи про Алабугу Політех')
  assert.equal(captured.context.page, 'map')
  assert.equal(captured.context.company_id, other.id)
  await finish()
  await page.waitForURL(url => url.searchParams.get('co') === String(company.id))
  let params = new URL(page.url()).searchParams
  assert.equal(params.get('network'), null)
  assert.equal(params.get('layers'), null)
  assert.equal(params.get('agent_ids'), null)
  const firstMove = params.get('agent_view')
  await page.locator('.map-leaflet').waitFor()
  await page.waitForFunction(count => document.querySelector('.map-info > summary')?.textContent.includes(`${count} роботодавців`), new Set([...(await (await context.request.get(`${base}/api/employers/map-points`)).json()), ...sites].map(p => p.employer_id)).size)
  await page.waitForTimeout(600) // Allow the map's fitBounds animation to publish its final bounds.
  await page.locator('.ag-context-tools > summary').click()
  await page.getByLabel('Область запитання').selectOption('viewport')
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Огляд області')?.disabled)
  command = null
  await submit('Підсумуй область')
  const bounds = captured.context.map_scope.bounds
  console.log('Focused map bounds:', bounds)
  assert.ok(bounds.east - bounds.west < 1, 'Company request must zoom into its primary location')
  assert.ok(target.lng >= bounds.west && target.lng <= bounds.east && target.lat >= bounds.south && target.lat <= bounds.north)
  await finish()
  assert.equal(new URL(page.url()).searchParams.get('agent_view'), firstMove)
  command = { kind: 'show_relations', employer_id: company.id }
  await submit('Покажи зв’язки Алабуги')
  await finish()
  await page.waitForURL(url => url.searchParams.get('network') === '1')
  params = new URL(page.url()).searchParams
  assert.equal(params.get('co'), String(company.id))
  assert.equal(params.get('layers'), 'supplier,parent')
  assert.equal(params.get('network_other'), '1')
  assert.notEqual(params.get('agent_view'), firstMove)
  await page.locator('.map-settings > summary').click()
  await page.getByLabel('Зв’язки обраної компанії').waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.map-focus input')].length === 3 && [...document.querySelectorAll('.map-focus input')].every(el => el.checked))
  assert.equal(await page.getByLabel('Її холдинги', { exact: true }).isChecked(), true)
  assert.equal(await page.getByLabel('Її ланцюги постачання', { exact: true }).isChecked(), true)
  assert.equal(await page.getByLabel('Інші її зв’язки', { exact: true }).isChecked(), true)
  await page.locator('.map-network-status').waitFor()
  await page.locator('.map-leaflet .leaflet-overlay-pane path').first().waitFor()
  assert.ok(await page.locator('.map-leaflet .leaflet-overlay-pane path').count() > 0, 'Recorded related-company links must be drawn on the fallback map')
  command = { kind: 'focus_company', employer_id: company.id }
  await submit('Покажи Алабугу знову')
  await page.getByRole('link', { name: 'Підприємства', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/companies')
  await finish()
  assert.equal(new URL(page.url()).pathname, '/companies', 'A late reply must not override user navigation')
  assert.deepEqual(errors, [])
  console.log('Browser checks: automatic company zoom, correct network root, cleared filters, scoped follow-up and late reply: OK')
} finally { await browser.close() }
