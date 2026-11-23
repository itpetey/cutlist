/**
 * Browser smoke test for the dev server.
 *
 *   npm run dev
 *   node scripts/check.mjs
 *
 * Uses an installed Chrome (override with CHROME_PATH) and writes screenshots
 * to the OS temp directory.
 */
import { chromium } from 'playwright-core'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const executablePath =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const out = tmpdir()

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

const waitForPlan = () =>
  page.waitForFunction(
    () => !!document.querySelector('.stat.hero') && !document.querySelector('.progress-line'),
    null,
    { timeout: 120_000 },
  )

await page.goto(base, { waitUntil: 'networkidle' })
await waitForPlan()

const price = await page.locator('.stat.hero .stat-value').innerText()
const search = await page.locator('.stat.status .stat-sub').innerText()
const status = await page.locator('.stat.status .stat-value').innerText()
const shoppingTotal = await page.locator('.shop-total strong').innerText()
console.log(`plan: ${price} · ${status} · ${search}`)
console.log(`shopping list total: ${shoppingTotal}`)
if (!search.includes('WASM')) errors.push('The WASM engine was not reported.')
if (price !== shoppingTotal) errors.push('Plan total and shopping-list total differ.')
await page.screenshot({ path: join(out, 'cutlist-light.png'), fullPage: true })

await page.getByRole('tab', { name: 'Least waste' }).click()
const wastePrice = await page.locator('.stat.hero .stat-value').innerText()
console.log(`least-waste plan: ${wastePrice}`)
await page.getByRole('tab', { name: 'Cheapest' }).click()

// Editing an input marks the plan stale, then re-optimising clears it.
await page.getByLabel('Kerf or blade thickness in millimetres').fill('4')
await page.locator('.banner.warn').waitFor({ timeout: 5_000 })
await page.getByRole('button', { name: 'Re-optimise' }).click()
await waitForPlan()
if (await page.locator('.banner.warn').count()) errors.push('Stale banner survived re-optimise.')
await page.getByLabel('Kerf or blade thickness in millimetres').fill('3')
await page.getByRole('button', { name: 'Optimise', exact: true }).click()
await waitForPlan()

await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(200)
await page.screenshot({ path: join(out, 'cutlist-dark.png'), fullPage: false })

await page.emulateMedia({ colorScheme: 'light', media: 'print' })
await page.waitForTimeout(200)
await page.screenshot({ path: join(out, 'cutlist-print.png'), fullPage: true })
await page.emulateMedia({ media: 'screen' })

await page.getByRole('button', { name: 'New job' }).click()
await page.locator('.empty-state h2').waitFor({ timeout: 5_000 })
console.log(`new job state: ${await page.locator('.empty-state h2').innerText()}`)

await page.setViewportSize({ width: 390, height: 844 })
await page.getByRole('button', { name: 'Sample job' }).click()
await waitForPlan()
await page.waitForTimeout(700)
const scrollY = await page.evaluate(() => Math.round(window.scrollY))
if (scrollY < 200) errors.push('Mobile view did not scroll to the results.')
console.log(`mobile scroll after solve: ${scrollY}px`)
await page.screenshot({ path: join(out, 'cutlist-mobile.png'), fullPage: false })

console.log(`screenshots: ${out}`)
await browser.close()

if (errors.length > 0) {
  console.error('\nSmoke test failed:')
  for (const error of errors) console.error(` - ${error}`)
  process.exitCode = 1
} else {
  console.log('Smoke test passed.')
}
