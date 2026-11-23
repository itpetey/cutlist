const money = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const moneyCompact = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const decimal0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const decimal1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 })
const decimal2 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 })

export function formatMoney(cents: number): string {
  return money.format(cents / 100)
}

export function formatMoneyValue(dollars: number): string {
  return moneyCompact.format(Number.isFinite(dollars) ? dollars : 0)
}

/** e.g. "1,800 mm" */
export function formatLength(um: number): string {
  const mm = um / 1000
  const digits = Math.abs(mm - Math.round(mm)) < 0.05 ? 0 : 1
  return `${digits === 0 ? decimal0.format(mm) : decimal1.format(mm)} mm`
}

/** e.g. "1,800" — no unit */
export function formatLengthValue(um: number): string {
  const mm = um / 1000
  return Math.abs(mm - Math.round(mm)) < 0.05 ? decimal0.format(mm) : decimal1.format(mm)
}

/** e.g. "22.4 m" */
export function formatMetres(um: number): string {
  return `${decimal2.format(um / 1_000_000)} m`
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${decimal1.format(ms / 1000)} s`
}
