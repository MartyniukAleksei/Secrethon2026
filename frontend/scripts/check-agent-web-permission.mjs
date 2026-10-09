// Real map records and deterministic agent replies verify the consent UI and request policy.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.AGENT_PREVIEW_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://mapgl.2gis.com/**', route => route.abort())
  const employers = await (await page.request.get(`${base}/api/employers`)).json()
  const company = employers.find(e => e.name.includes('Алабуга.'))
  assert.ok(company)
  const calls = []
  let failOnce = false
  await page.route('**/api/agent/chat', async route => {
    const payload = route.request().postDataJSON()
    calls.push(payload)
    if (payload.web_access === 'ask') {
      await route.fulfill({ json: {
        text: 'Потрібен пошук', web_permission: { company: company.name, days: 7 },
        sources: [], artifacts: [], as_of: null, tools_used: [], map_action: null,
      } })
      return
    }
    if (failOnce) {
      failOnce = false
      await route.fulfill({ status: 503, json: { detail: 'Тестова тимчасова помилка' } })
      return
    }
    const online = payload.web_access === 'allowed'
    await route.fulfill({ json: {
      text: online ? 'Матеріал із відкритих джерел [s1]' : 'Відповідь лише з бази [s1]',
      sections: [{ kind: online ? 'public_web' : 'database', text: online ? 'Матеріал із відкритих джерел [s1]' : 'Відповідь лише з бази [s1]', source_ids: ['s1'] }],
      sources: [{ id: 's1', title: 'Джерело', url: online ? 'https://example.com/news' : `/companies/${company.id}`, origin: online ? 'public_web' : 'database' }],
      artifacts: [], as_of: null, tools_used: online ? ['search_mentions'] : ['company_profile'], context: payload.context,
      map_action: { kind: 'focus_company', employer_id: company.id },
    } })
  })
  await page.goto(`${base}/map?co=${company.id}`)
  await page.locator('.map-agent-launch').click()
  async function ask(question) {
    await page.getByLabel('Питання агенту', { exact: true }).fill(question)
    await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
    await page.getByRole('group', { name: 'Дозвіл на пошук в інтернеті' }).waitFor()
    await page.locator('.typing-msg').waitFor({ state: 'hidden' })
  }
  await ask('Знайди свіжі згадки Алабуги')
  assert.equal(calls.length, 1, 'Must wait for an explicit choice')
  assert.equal(calls[0].web_access, 'ask')
  assert.equal(await page.locator('.ag-research-draft').count(), 0, 'A permission request is not research')
  assert.equal(await page.getByLabel('Питання агенту', { exact: true }).isDisabled(), true)
  await mkdir('node_modules/.tmp', { recursive: true })
  await page.screenshot({ path: 'node_modules/.tmp/agent-web-permission-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Шукати в базі', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'node_modules/.tmp/agent-web-permission-mobile.png' })
  assert.ok((await page.getByRole('button', { name: 'Шукати в базі', exact: true }).boundingBox()).width < 390)
  await page.setViewportSize({ width: 1600, height: 1000 })
  const first = calls[0]
  await page.getByRole('button', { name: 'Шукати в базі та інтернеті', exact: true }).click()
  await page.getByText('Матеріал із відкритих джерел [s1]', { exact: true }).waitFor()
  assert.equal(calls[1].web_access, 'allowed')
  assert.deepEqual(calls[1].context, first.context)
  assert.deepEqual(calls[1].history, first.history)
  assert.equal(calls[1].message, first.message)
  assert.equal(await page.locator('.msg.user').count(), 1, 'Approval must not duplicate the question')
  assert.equal(await page.locator('.ag-web-consent').count(), 0)

  await ask('Знайди ще новини Алабуги')
  assert.equal(calls[2].web_access, 'ask', 'Previous permission must not carry over')
  const second = calls[2]
  await page.getByRole('link', { name: 'Підприємства', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/companies')
  failOnce = true
  await page.getByRole('button', { name: 'Шукати в базі', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Тестова тимчасова помилка' }).waitFor()
  assert.equal(calls[3].web_access, 'db_only')
  assert.deepEqual(calls[3].context, second.context, 'Keep the original map context after permission')
  await page.getByRole('button', { name: 'Повторити', exact: true }).click()
  await page.getByText('Відповідь лише з бази [s1]', { exact: true }).waitFor()
  assert.equal(calls[4].web_access, 'db_only', 'Retry must respect the refusal')
  assert.equal(new URL(page.url()).pathname, '/companies', 'Delayed approval must not override navigation')
  assert.equal(await page.locator('.msg.user').count(), 2)
  assert.deepEqual(errors, [])
  console.log('Browser: consent, approval, refusal, per-question permission, frozen context, retry and mobile: OK')
} finally {
  await browser.close()
}
