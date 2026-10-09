// Verify history reset, permission reset and cancellation without provider calls.
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
  const calls = []
  const releases = new Map()
  const final = text => ({ text, sources: [], artifacts: [], as_of: null, tools_used: [] })
  await page.route('**/api/agent/chat', async route => {
    const payload = route.request().postDataJSON()
    calls.push(payload)
    if (payload.message === 'Пошук у вебі') {
      await route.fulfill({ json: { ...final('Потрібен дозвіл'), web_permission: { company: 'Підприємство', days: 7 } } })
      return
    }
    if (payload.message.startsWith('Очікування')) {
      await new Promise(resolve => releases.set(payload.message, resolve))
      // A cancelled request may already have been detached by the browser.
      await route.fulfill({ json: final(`Пізня відповідь: ${payload.message}`) }).catch(() => {})
      return
    }
    await route.fulfill({ json: final(`Відповідь: ${payload.message}`) })
  })
  await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' })
  await page.locator('.map-agent-launch').click()
  await page.locator('.ag-context-tools > summary').click()
  await page.getByLabel('Область запитання').selectOption('company')
  const input = page.getByLabel('Питання агенту', { exact: true })
  const newChat = page.getByRole('button', { name: 'Новий чат', exact: true })
  async function submit(question) {
    const sent = page.waitForRequest(r => r.url().endsWith('/api/agent/chat') && r.postDataJSON().message === question)
    await input.fill(question)
    await page.getByRole('button', { name: 'Надіслати', exact: true }).click()
    await sent
  }
  const researchKey = 'secrethon.approved-research.v1'
  const saved = JSON.stringify([{ schema_version: 1, id: 'saved', title: 'Збережене дослідження', approved_at: '2026-10-09T12:00:00Z', question: 'Питання', context: { days: 30 }, response: final('Схвалена відповідь') }])
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: researchKey, value: saved })

  await submit('Перше питання')
  await page.getByText('Відповідь: Перше питання', { exact: true }).waitFor()
  await submit('Уточнення')
  await page.getByText('Відповідь: Уточнення', { exact: true }).waitFor()
  assert.equal(calls[1].history.length, 2)
  await input.fill('Ненадіслана чернетка')
  await newChat.click()
  assert.equal(await page.locator('.msg.user').count(), 0)
  assert.equal(await page.locator('.ag-research-draft').count(), 0)
  assert.equal(await input.inputValue(), '')
  await submit('Нове питання')
  await page.getByText('Відповідь: Нове питання', { exact: true }).waitFor()
  assert.deepEqual(calls[2].history, [])

  await submit('Пошук у вебі')
  await page.locator('.ag-web-consent').waitFor()
  await newChat.click()
  assert.equal(await page.locator('.ag-web-consent').count(), 0)
  assert.equal(await input.isDisabled(), false)
  await submit('Очікування старого чату')
  await page.locator('.typing-msg').waitFor()
  await newChat.click()
  await submit('Очікування нового чату')
  assert.deepEqual(calls.at(-1).history, [])
  assert.equal(calls.at(-1).web_access, 'ask')
  await page.waitForFunction(() => document.querySelector('.typing-msg'))
  releases.get('Очікування старого чату')()
  releases.get('Очікування нового чату')()
  await page.getByText('Пізня відповідь: Очікування нового чату', { exact: true }).waitFor()
  assert.equal(await page.getByText('Пізня відповідь: Очікування старого чату', { exact: true }).count(), 0)
  assert.equal(await page.locator('.msg.user').count(), 1)
  await page.getByRole('button', { name: 'Збережені дослідження', exact: true }).click()
  await page.getByRole('button', { name: 'Збережене дослідження', exact: true }).waitFor()
  await newChat.click()
  assert.equal(await input.isVisible(), true)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), researchKey), saved)
  await page.setViewportSize({ width: 390, height: 844 })
  await mkdir('node_modules/.tmp', { recursive: true })
  await page.screenshot({ path: 'node_modules/.tmp/agent-new-chat-mobile.png' })
  const button = await newChat.boundingBox()
  assert.ok(button && button.x >= 0 && button.x + button.width <= 390)
  assert.deepEqual(errors, [])
  console.log('Browser: new chat clears history/draft/permission, cancels old replies, keeps research and fits mobile: OK')
} finally {
  await browser.close()
}
