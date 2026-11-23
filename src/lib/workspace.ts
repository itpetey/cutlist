import type { Objective, SolveResult } from './solverTypes'
import {
  LEGACY_JOB_KEY,
  jobKey,
  loadJob,
  normaliseJob,
  uid,
  type Job,
} from './job'

/**
 * A workspace tab is one complete job plus the results that belong to the
 * snapshot of that job (`solvedJob`). Editing `job` after a solve leaves the
 * results in place, marked stale, so the previous plan remains inspectable.
 */
export interface JobTab {
  id: string
  name: string
  job: Job
  view: Objective
  price: SolveResult | null
  waste: SolveResult | null
  solvedJob: Job | null
  solvedKey: string | null
}

export interface Workspace {
  tabs: JobTab[]
  activeTabId: string
}

const WORKSPACE_KEY = 'cutlist.workspace.v1'

export function createTab(job: Job, name: string): JobTab {
  return {
    id: uid('tab'),
    name,
    job,
    view: 'price',
    price: null,
    waste: null,
    solvedJob: null,
    solvedKey: null,
  }
}

export function cloneJob(job: Job): Job {
  return JSON.parse(JSON.stringify(job)) as Job
}

export function hasResults(tab: JobTab): boolean {
  return !!(tab.price || tab.waste)
}

export function isTabStale(tab: JobTab): boolean {
  return hasResults(tab) && tab.solvedKey !== jobKey(tab.job)
}

export function isTabSolved(tab: JobTab): boolean {
  return hasResults(tab) && tab.solvedKey === jobKey(tab.job)
}

function isResult(value: unknown, mode: Objective): value is SolveResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<SolveResult>
  return (
    result.mode === mode &&
    Array.isArray(result.boards) &&
    Array.isArray(result.unmakeable) &&
    Array.isArray(result.notes) &&
    typeof result.totalPriceCents === 'number' &&
    typeof result.totalStockUm === 'number'
  )
}

function normaliseTabs(raw: unknown): JobTab[] {
  if (!Array.isArray(raw)) return []
  const tabs: JobTab[] = []
  const ids = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<JobTab> & Record<string, unknown>
    const job = normaliseJob(candidate.job)
    if (!job) continue

    let id = typeof candidate.id === 'string' && candidate.id ? candidate.id : uid('tab')
    if (ids.has(id)) id = uid('tab')
    ids.add(id)

    const name =
      typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim().slice(0, 60)
        : 'Job'
    let view: Objective = candidate.view === 'waste' ? 'waste' : 'price'

    let price = isResult(candidate.price, 'price') ? candidate.price : null
    let waste = isResult(candidate.waste, 'waste') ? candidate.waste : null
    let solvedJob = normaliseJob(candidate.solvedJob)
    let solvedKey = typeof candidate.solvedKey === 'string' ? candidate.solvedKey : null

    if (!price && !waste) {
      solvedJob = null
      solvedKey = null
    } else if (!solvedJob || !solvedKey || jobKey(solvedJob) !== solvedKey) {
      price = null
      waste = null
      solvedJob = null
      solvedKey = null
    } else if (jobKey(job) === solvedKey) {
      // The current job is exactly the snapshot; no need to keep a second copy.
      solvedJob = job
    }

    if (view === 'price' && !price) view = 'waste'
    if (view === 'waste' && !waste) view = 'price'

    tabs.push({ id, name, job, view, price, waste, solvedJob, solvedKey })
  }

  return tabs
}

export function normaliseWorkspace(input: unknown): Workspace | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { activeTabId?: unknown; tabs?: unknown }
  const tabs = normaliseTabs(raw.tabs)
  if (tabs.length === 0) return null
  const activeTabId =
    typeof raw.activeTabId === 'string' && tabs.some((tab) => tab.id === raw.activeTabId)
      ? raw.activeTabId
      : tabs[0].id
  return { tabs, activeTabId }
}

/** Loads the pre-project single workspace, used to seed the first project. */
export function loadWorkspace(): Workspace {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY)
      if (raw) {
        const workspace = normaliseWorkspace(JSON.parse(raw))
        if (workspace) return workspace
      }
    } catch {
      // Corrupt or unavailable storage: fall back to the legacy single job.
    }
  }

  const hadLegacyJob =
    typeof localStorage !== 'undefined' && localStorage.getItem(LEGACY_JOB_KEY) !== null
  const tab = createTab(loadJob(), hadLegacyJob ? 'Job 1' : 'Sample job')
  return { tabs: [tab], activeTabId: tab.id }
}

export function nextJobName(tabs: JobTab[]): string {
  const names = new Set(tabs.map((tab) => tab.name))
  let n = 1
  while (names.has(`Job ${n}`)) n++
  return `Job ${n}`
}

export function nextSampleName(tabs: JobTab[]): string {
  const names = new Set(tabs.map((tab) => tab.name))
  if (!names.has('Sample job')) return 'Sample job'
  let n = 2
  while (names.has(`Sample job ${n}`)) n++
  return `Sample job ${n}`
}

export function uniqueName(tabs: JobTab[], base: string): string {
  const names = new Set(tabs.map((tab) => tab.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * "Job 1" -> "Job 1 copy" -> "Job 1 copy 2" rather than stacking "copy copy".
 */
export function copyName(tabs: JobTab[], sourceName: string): string {
  const root = sourceName.replace(/ copy(?: \d+)?$/, '')
  return uniqueName(tabs, `${root} copy`)
}
