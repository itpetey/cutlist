import type { Objective, SolverInput } from './solverTypes'

export interface PartRow {
  id: string
  label: string
  /** mm */
  length: number
  qty: number
}

export interface StockRow {
  id: string
  name: string
  /** mm */
  length: number
  /** AUD per piece */
  price: number
  /** null = unlimited */
  qty: number | null
}

export interface JobSettings {
  /** mm */
  kerf: number
  /** mm */
  leftTrim: number
  /** mm */
  rightTrim: number
  /** mm */
  minRemnant: number
  /** ms, 0 = unlimited */
  timeLimitMs: number
}

export interface Job {
  parts: PartRow[]
  stocks: StockRow[]
  settings: JobSettings
}

export const TIME_LIMITS = [
  { value: 2_000, label: 'Fast · 2 s' },
  { value: 10_000, label: 'Balanced · 10 s' },
  { value: 30_000, label: 'Thorough · 30 s' },
  { value: 60_000, label: 'Maximum · 60 s' },
]

export function uid(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `${prefix}_${rand}`
}

export function newPart(overrides: Partial<PartRow> = {}): PartRow {
  return { id: uid('part'), label: '', length: 0, qty: 1, ...overrides }
}

export function newStock(overrides: Partial<StockRow> = {}): StockRow {
  return { id: uid('stock'), name: '', length: 0, price: 0, qty: null, ...overrides }
}

export function sampleJob(): Job {
  return {
    settings: { kerf: 3, leftTrim: 0, rightTrim: 0, minRemnant: 300, timeLimitMs: 10_000 },
    stocks: [
      { id: uid('stock'), name: '1.2 m offcut', length: 1200, price: 1.5, qty: 4 },
      { id: uid('stock'), name: '2.4 m pine', length: 2400, price: 9.9, qty: null },
      { id: uid('stock'), name: '3.6 m pine', length: 3600, price: 13.9, qty: null },
      { id: uid('stock'), name: '4.8 m pine', length: 4800, price: 17.5, qty: null },
      { id: uid('stock'), name: '5.4 m pine', length: 5400, price: 20.6, qty: null },
    ],
    parts: [
      { id: uid('part'), label: 'Side panel', length: 1800, qty: 4 },
      { id: uid('part'), label: 'Shelf', length: 900, qty: 6 },
      { id: uid('part'), label: 'Back rail', length: 1200, qty: 4 },
      { id: uid('part'), label: 'Spacer', length: 450, qty: 8 },
      { id: uid('part'), label: 'Cleat', length: 700, qty: 2 },
    ],
  }
}

export function blankJob(): Job {
  return {
    settings: { kerf: 3, leftTrim: 0, rightTrim: 0, minRemnant: 300, timeLimitMs: 10_000 },
    stocks: [newStock({ name: '', length: 2400, price: 0, qty: null })],
    parts: [newPart({ length: 1000, qty: 1 })],
  }
}

const STORAGE_KEY = 'cutlist.job.v1'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function normaliseJob(input: unknown): Job | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<Job>
  if (!Array.isArray(raw.parts) || !Array.isArray(raw.stocks) || !raw.settings) return null

  const parts: PartRow[] = raw.parts
    .filter((p): p is PartRow => !!p && typeof p === 'object')
    .map((p) => ({
      id: typeof p.id === 'string' ? p.id : uid('part'),
      label: typeof p.label === 'string' ? p.label : '',
      length: isFiniteNumber(p.length) ? p.length : 0,
      qty: isFiniteNumber(p.qty) ? p.qty : 0,
    }))

  const stocks: StockRow[] = raw.stocks
    .filter((s): s is StockRow => !!s && typeof s === 'object')
    .map((s) => ({
      id: typeof s.id === 'string' ? s.id : uid('stock'),
      name: typeof s.name === 'string' ? s.name : '',
      length: isFiniteNumber(s.length) ? s.length : 0,
      price: isFiniteNumber(s.price) ? s.price : 0,
      qty: s.qty === null || !isFiniteNumber(s.qty) ? null : s.qty,
    }))

  const settings = raw.settings as Partial<JobSettings>
  const fallback = sampleJob().settings
  return {
    parts,
    stocks,
    settings: {
      kerf: isFiniteNumber(settings.kerf) ? settings.kerf : fallback.kerf,
      leftTrim: isFiniteNumber(settings.leftTrim) ? settings.leftTrim : fallback.leftTrim,
      rightTrim: isFiniteNumber(settings.rightTrim) ? settings.rightTrim : fallback.rightTrim,
      minRemnant: isFiniteNumber(settings.minRemnant) ? settings.minRemnant : fallback.minRemnant,
      timeLimitMs: isFiniteNumber(settings.timeLimitMs) ? settings.timeLimitMs : fallback.timeLimitMs,
    },
  }
}

export function loadJob(): Job {
  if (typeof localStorage === 'undefined') return sampleJob()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return sampleJob()
    const parsed = normaliseJob(JSON.parse(raw))
    if (!parsed) return sampleJob()
    if (parsed.parts.length === 0 && parsed.stocks.length === 0) return sampleJob()
    return parsed
  } catch {
    return sampleJob()
  }
}

export function saveJob(job: Job): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(job))
  } catch {
    // Storage may be unavailable (private mode); the app still works in memory.
  }
}

export function jobKey(job: Job): string {
  return JSON.stringify(job)
}

const MM_TO_UM = 1000

export function buildSolverInput(job: Job, mode: Objective): SolverInput {
  const parts = job.parts
    .filter((p) => p.qty > 0)
    .map((p) => ({
      id: p.id,
      lengthUm: Math.round(p.length * MM_TO_UM),
      qty: Math.max(1, Math.round(p.qty)),
    }))

  const stocks = job.stocks
    .filter((s) => s.length > 0 && s.price >= 0 && (s.qty === null || s.qty > 0))
    .map((s) => ({
      id: s.id,
      lengthUm: Math.round(s.length * MM_TO_UM),
      priceCents: Math.round(s.price * 100),
      qty: s.qty === null ? null : Math.max(1, Math.round(s.qty)),
    }))

  return {
    parts,
    stocks,
    options: {
      mode,
      kerfUm: Math.round(Math.max(0, job.settings.kerf) * MM_TO_UM),
      leftTrimUm: Math.round(Math.max(0, job.settings.leftTrim) * MM_TO_UM),
      rightTrimUm: Math.round(Math.max(0, job.settings.rightTrim) * MM_TO_UM),
      minRemnantUm: Math.round(Math.max(0, job.settings.minRemnant) * MM_TO_UM),
      timeLimitMs: job.settings.timeLimitMs,
    },
  }
}

export function stockLabel(stock: StockRow | undefined, fallbackLengthUm: number): string {
  if (stock?.name?.trim()) return stock.name.trim()
  const mm = fallbackLengthUm / MM_TO_UM
  return `${formatNumber(mm, 0)} mm stock`
}

export function formatNumber(value: number, maxDigits = 1): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: maxDigits }).format(value)
}
