import type { SolveResult } from './solverTypes'
import { formatLength, formatMetres, formatMoney, formatPercent } from './format'
import { stockLabel, type Job, type PartRow, type StockRow } from './job'

function stockName(job: Job, id: string, lengthUm: number): string {
  return stockLabel(
    job.stocks.find((s) => s.id === id),
    lengthUm,
  )
}

function labelFor(job: Job, partId: string, fallbackLengthUm: number): string {
  const p: PartRow | undefined = job.parts.find((x) => x.id === partId)
  return p?.label?.trim() || `${formatLength(fallbackLengthUm)} part`
}

function groupBoards(result: SolveResult) {
  const groups: { stockId: string; boards: typeof result.boards }[] = []
  const index = new Map<string, number>()
  for (const board of result.boards) {
    const existing = index.get(board.stockId)
    if (existing === undefined) {
      index.set(board.stockId, groups.length)
      groups.push({ stockId: board.stockId, boards: [board] })
    } else {
      groups[existing].boards.push(board)
    }
  }
  return groups
}

export function planToText(job: Job, result: SolveResult): string {
  const title = result.mode === 'price' ? 'CHEAPEST PLAN' : 'LEAST-WASTE PLAN'
  const lines: string[] = []
  const pct = result.totalStockUm > 0 ? result.wasteUm / result.totalStockUm : 0

  lines.push(title)
  lines.push(
    `Kerf ${formatLength(job.settings.kerf * 1000)} · trim ${formatLength(
      job.settings.leftTrim * 1000,
    )} / ${formatLength(job.settings.rightTrim * 1000)}`,
  )
  lines.push(
    `Total ${formatMoney(result.totalPriceCents)} · ${result.boards.length} pieces · ${formatMetres(
      result.totalStockUm,
    )} purchased · waste ${formatLength(result.wasteUm)} (${formatPercent(pct)})`,
  )
  if (!result.proven) lines.push('Plan is the best found; optimality was not proven within the time limit.')
  lines.push('')

  lines.push('SHOPPING LIST')
  const counts = new Map<string, { board: (typeof result.boards)[number]; qty: number }>()
  for (const board of result.boards) {
    const entry = counts.get(board.stockId)
    if (entry) entry.qty++
    else counts.set(board.stockId, { board, qty: 1 })
  }
  for (const { board, qty } of counts.values()) {
    lines.push(
      `  ${qty} × ${stockName(job, board.stockId, board.stockLengthUm)} @ ${formatMoney(
        board.priceCents,
      )} = ${formatMoney(board.priceCents * qty)}`,
    )
  }
  lines.push(`  TOTAL ${formatMoney(result.totalPriceCents)}`)
  lines.push('')

  lines.push('CUT SEQUENCE')
  let n = 0
  for (const group of groupBoards(result)) {
    const first = group.boards[0]
    lines.push(
      `${stockName(job, first.stockId, first.stockLengthUm)} (× ${group.boards.length})`,
    )
    for (const board of group.boards) {
      n++
      const cuts = board.cuts.map((c) => formatLength(c.lengthUm)).join(' + ')
      const end =
        board.offcutUm >= job.settings.minRemnant * 1000
          ? `offcut ${formatLength(board.offcutUm)}`
          : `waste ${formatLength(board.offcutUm)}`
      lines.push(`  ${String(n).padStart(2, '0')}. ${cuts}   [${end}]`)
    }
  }

  if (result.unmakeable.length > 0) {
    lines.push('')
    lines.push('NOT MADE (too long for any stock)')
    for (const u of result.unmakeable) {
      lines.push(`  ${u.qty} × ${labelFor(job, u.partId, u.lengthUm)} (${formatLength(u.lengthUm)})`)
    }
  }

  return lines.join('\n')
}

export function shoppingList(job: Job, result: SolveResult) {
  const map = new Map<
    string,
    { stock?: StockRow; board: SolveResult['boards'][number]; qty: number }
  >()
  for (const board of result.boards) {
    const entry = map.get(board.stockId)
    if (entry) entry.qty++
    else map.set(board.stockId, { stock: job.stocks.find((s) => s.id === board.stockId), board, qty: 1 })
  }
  return Array.from(map.values())
}

export { groupBoards }
