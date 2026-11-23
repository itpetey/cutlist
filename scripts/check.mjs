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
page.on('dialog', (dialog) => dialog.accept())
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

const waitForBatch = () =>
  page.waitForFunction(
    () =>
      document.querySelectorAll('.job-tab .spinner').length === 0 &&
      [...document.querySelectorAll('button')].some((button) =>
        /^Solve all/.test(button.textContent?.trim() ?? ''),
      ),
    null,
    { timeout: 120_000 },
  )

const solveAll = page.getByRole('button', { name: /^Solve all/ })

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

// --- multiple jobs ---------------------------------------------------------
const tabCount = () => page.locator('.job-tab').count()
const okDots = () => page.locator('.job-tab .tab-dot.ok').count()
const projectSwitch = page.getByRole('button', { name: /^Projects:/ })
const projectRows = () => page.locator('.project-row').count()
const projectName = () => page.locator('.project-switcher-name').innerText()

await page.getByRole('button', { name: 'Duplicate' }).click()
if ((await tabCount()) !== 2) errors.push('Duplicate did not create a second tab.')
if ((await okDots()) !== 2) errors.push('Duplicated job did not inherit its solved result.')

// Make the copy stale, then duplicate the stale copy as well.
await page.getByLabel('Kerf or blade thickness in millimetres').fill('4')
if ((await page.locator('.job-tab .tab-dot.stale').count()) !== 1) {
  errors.push('Editing a duplicated job did not mark it stale.')
}
await page.getByRole('button', { name: 'Duplicate' }).click()
if ((await tabCount()) !== 3) errors.push('Second duplicate did not create a third tab.')
console.log(`tabs before Solve all: ${await tabCount()}, stale: ${await page.locator('.job-tab .tab-dot.stale').count()}`)

await solveAll.click()
await waitForBatch()
const dots = await okDots()
console.log(`tabs after Solve all: ${await tabCount()}, up-to-date: ${dots}`)
if (dots !== 3) errors.push(`Expected 3 solved tabs after Solve all, saw ${dots}.`)
if ((await page.locator('.stat.hero .stat-value').innerText()) !== '$75.50') {
  errors.push('Solve-all did not produce the expected active plan.')
}

await page.locator('.job-tab .tab-main').first().click()
if ((await page.locator('.stat.hero .stat-value').innerText()) !== '$75.50') {
  errors.push('Switching back to the first job lost its plan.')
}

// Rename, then reload and check that tabs, names and solved plans persist.
await page.locator('.workspace-actions').getByRole('button', { name: 'Rename' }).click()
const rename = page.getByRole('textbox', { name: /Rename/ })
await rename.fill('Renamed job')
await rename.press('Enter')
if ((await page.locator('.job-tab .tab-name').first().innerText()) !== 'Renamed job') {
  errors.push('Renaming a tab did not stick.')
}

await page.waitForTimeout(600)
await page.reload({ waitUntil: 'networkidle' })
await waitForPlan()
const persistedTabs = await tabCount()
const persistedDots = await okDots()
console.log(`after reload: tabs ${persistedTabs}, up-to-date ${persistedDots}`)
if (persistedTabs !== 3) errors.push(`Expected 3 tabs after reload, saw ${persistedTabs}.`)
if (persistedDots !== 3) errors.push(`Expected 3 solved tabs after reload, saw ${persistedDots}.`)
if ((await page.locator('.job-tab .tab-name').first().innerText()) !== 'Renamed job') {
  errors.push('Renamed tab did not persist.')
}
if ((await page.locator('.stat.hero .stat-value').innerText()) !== '$75.50') {
  errors.push('Restored tab did not show its saved plan.')
}

// --- projects --------------------------------------------------------------
console.log(`project before rename: ${await projectName()}`)
await projectSwitch.click()
await page.getByRole('dialog', { name: 'Projects' }).waitFor()
if ((await projectRows()) !== 1) errors.push(`Expected 1 project, saw ${await projectRows()}.`)

await page.getByRole('button', { name: 'Rename Project 1' }).click()
const projectRename = page.getByRole('textbox', { name: 'Project name' })
await projectRename.fill('Smoke project')
await projectRename.press('Enter')
if ((await projectName()) !== 'Smoke project') {
  errors.push('Renaming the project did not update the switcher.')
}

await page.getByRole('button', { name: /Save current tabs as/ }).click()
const saveAs = page.getByRole('textbox', { name: 'New project name' })
await saveAs.fill('Copy project')
await page.getByRole('button', { name: 'Save project' }).click()
await page.waitForFunction(
  () => document.querySelector('.project-switcher-name')?.textContent === 'Copy project',
  null,
  { timeout: 5_000 },
)
if ((await tabCount()) !== 3) errors.push('Save-as project did not copy the job tabs.')
if ((await okDots()) !== 3) errors.push('Save-as project did not copy the solved plans.')

await projectSwitch.click()
await page.getByRole('dialog', { name: 'Projects' }).waitFor()
const twoProjects = await projectRows()
if (twoProjects !== 2) errors.push(`Expected 2 projects after save-as, saw ${twoProjects}.`)
await page.locator('.project-open').filter({ hasText: 'Smoke project' }).click()
if ((await projectName()) !== 'Smoke project') {
  errors.push('Opening a saved project did not restore it.')
}
if ((await tabCount()) !== 3) errors.push('Opening a project lost its job tabs.')

// Project library survives a restart.
await page.waitForTimeout(600)
await page.reload({ waitUntil: 'networkidle' })
await waitForPlan()
if ((await projectName()) !== 'Smoke project') errors.push('Project name did not persist.')
if ((await tabCount()) !== 3) errors.push('Project tabs did not persist.')
if ((await okDots()) !== 3) errors.push('Project solved plans did not persist.')

// Delete the copy, then create and open a blank project.
await projectSwitch.click()
await page.getByRole('dialog', { name: 'Projects' }).waitFor()
await page
  .locator('.project-row')
  .filter({ hasText: 'Copy project' })
  .getByRole('button', { name: /^Delete/ })
  .click()
if ((await projectRows()) !== 1) errors.push('Deleting a project did not remove it.')
await page.getByRole('button', { name: 'Close projects' }).click()

await projectSwitch.click()
await page.getByRole('button', { name: 'New project' }).click()
await page.locator('.empty-state h2').waitFor({ timeout: 5_000 })
if ((await tabCount()) !== 1) errors.push('New project should start with one blank tab.')
if (!/^Project/.test(await projectName())) {
  errors.push('New project did not get a default project name.')
}
await projectSwitch.click()
await page.getByRole('dialog', { name: 'Projects' }).waitFor()
await page.locator('.project-open').filter({ hasText: 'Smoke project' }).click()
if ((await projectName()) !== 'Smoke project') {
  errors.push('Switching back to the saved project failed.')
}
if ((await tabCount()) !== 3) errors.push('Switching back lost the saved tabs.')

// New blank job, then add the sample as another tab.
await page.getByRole('button', { name: 'New job' }).click()
await page.locator('.empty-state h2').waitFor({ timeout: 5_000 })
if ((await tabCount()) !== 4) errors.push('New job did not create a fourth tab.')
await page.locator('.workspace-actions').getByRole('button', { name: 'Sample job' }).click()
await waitForPlan()
if ((await tabCount()) !== 5) errors.push('Sample job did not create a fifth tab.')
console.log(`sample tab active: ${await page.locator('.stat.hero .stat-value').innerText()}`)

await page.locator('.job-tab').last().getByRole('button', { name: /^Close / }).click()
if ((await tabCount()) !== 4) errors.push('Closing the sample tab did not remove it.')

// --- mobile ---------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 })
await page.locator('.workspace-actions').getByRole('button', { name: 'Sample job' }).click()
await waitForPlan()
await page.waitForTimeout(700)
const scrollY = await page.evaluate(() => Math.round(window.scrollY))
if (scrollY < 200) errors.push('Mobile view did not scroll to the results.')
console.log(`mobile scroll after solve: ${scrollY}px, tabs: ${await tabCount()}`)
await page.screenshot({ path: join(out, 'cutlist-mobile.png'), fullPage: false })

await projectSwitch.click()
await page.getByRole('dialog', { name: 'Projects' }).waitFor()
if ((await projectRows()) < 2) errors.push('Mobile projects dialog did not list projects.')
await page.getByRole('button', { name: 'Close projects' }).click()

console.log(`screenshots: ${out}`)
await browser.close()

if (errors.length > 0) {
  console.error('\nSmoke test failed:')
  for (const error of errors) console.error(` - ${error}`)
  process.exitCode = 1
} else {
  console.log('Smoke test passed.')
}
