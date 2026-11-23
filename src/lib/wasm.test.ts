import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { initSync, solve as solveWasm } from '../wasm/pkg/cutlist_solver.js'
import type { Objective, SolveResult, SolverInput } from './solverTypes'

initSync({ module: readFileSync(new URL('../wasm/pkg/cutlist_solver_bg.wasm', import.meta.url)) })

function solve(input: SolverInput): SolveResult {
  return JSON.parse(solveWasm(JSON.stringify(input))) as SolveResult
}

const U = (mm: number) => Math.round(mm * 1000)

interface BrutePart {
  lengthUm: number
  qty: number
}
interface BruteStock {
  lengthUm: number
  priceCents: number
  qty: number | null
  usableUm: number
}

/**
 * Independent oracle: enumerate stock-count vectors and test feasibility with
 * an exact bin-packing DFS. Small instances only.
 */
function bruteForce(
  parts: BrutePart[],
  stocks: BruteStock[],
  kerfUm: number,
  mode: Objective,
): { price: number; length: number } | null {
  const expanded: number[] = []
  for (const p of parts) for (let i = 0; i < p.qty; i++) expanded.push(p.lengthUm)
  if (expanded.length === 0) return { price: 0, length: 0 }
  expanded.sort((a, b) => b - a)
  // Weight transform: a part costs length+kerf, a used board gains one kerf back.
  const weights = expanded.map((l) => l + kerfUm)

  const maxBoards = expanded.length
  const counts = new Array(stocks.length).fill(0)
  let best: { price: number; length: number } | null = null

  const consider = () => {
    let price = 0
    let length = 0
    const capacities: number[] = []
    for (let s = 0; s < stocks.length; s++) {
      for (let k = 0; k < counts[s]; k++) {
        capacities.push(stocks[s].usableUm + kerfUm)
        price += stocks[s].priceCents
        length += stocks[s].lengthUm
      }
    }
    if (best) {
      if (mode === 'price') {
        if (price > best.price) return
        if (price === best.price && length >= best.length) return
      } else {
        if (length > best.length) return
        if (length === best.length && price >= best.price) return
      }
    }
    const remaining = capacities.slice()
    const place = (idx: number): boolean => {
      if (idx === weights.length) return true
      const w = weights[idx]
      const seen = new Set<number>()
      for (let b = 0; b < remaining.length; b++) {
        const cap = remaining[b]
        if (cap < w || seen.has(cap)) continue
        seen.add(cap)
        remaining[b] = cap - w
        if (place(idx + 1)) {
          remaining[b] = cap
          return true
        }
        remaining[b] = cap
      }
      return false
    }
    if (place(0)) best = { price, length }
  }

  const walk = (s: number, boards: number) => {
    if (boards > maxBoards) return
    if (s === stocks.length) {
      if (boards > 0) consider()
      return
    }
    const cap = stocks[s].qty === null ? maxBoards : Math.min(maxBoards, stocks[s].qty)
    for (let q = 0; q <= cap; q++) {
      counts[s] = q
      walk(s + 1, boards + q)
    }
  }
  walk(0, 0)
  return best
}

function toInput(
  partsMm: number[],
  stocksMm: { length: number; price: number; qty: number | null }[],
  mode: Objective,
  opts: Partial<{ kerf: number; leftTrim: number; rightTrim: number }> = {},
): SolverInput {
  return {
    parts: partsMm.map((mm, i) => ({ id: `p${i}`, lengthUm: U(mm), qty: 1 })),
    stocks: stocksMm.map((s, i) => ({
      id: `s${i}`,
      lengthUm: U(s.length),
      priceCents: Math.round(s.price * 100),
      qty: s.qty,
    })),
    options: {
      mode,
      kerfUm: U(opts.kerf ?? 0),
      leftTrimUm: U(opts.leftTrim ?? 0),
      rightTrimUm: U(opts.rightTrim ?? 0),
      minRemnantUm: U(300),
      timeLimitMs: 0,
    },
  }
}

function bruteFromInput(input: SolverInput) {
  const grouped: BrutePart[] = []
  for (const p of input.parts) {
    if (p.qty > 0 && p.lengthUm > 0) grouped.push({ lengthUm: p.lengthUm, qty: p.qty })
  }
  const stocks: BruteStock[] = input.stocks
    .filter((s) => s.qty === null || s.qty > 0)
    .map((s) => ({
      lengthUm: s.lengthUm,
      priceCents: s.priceCents,
      qty: s.qty,
      usableUm: s.lengthUm - input.options.leftTrimUm - input.options.rightTrimUm,
    }))
  return bruteForce(grouped, stocks, input.options.kerfUm, input.options.mode)
}

describe('solver objective', () => {
  it('finds the cheapest plan, not the least-waste one', () => {
    // $1.00 2 m stock vs $10.00 3 m stock: cheapest is two 2 m boards.
    const input = toInput(
      [1000, 1000, 1000],
      [
        { length: 2000, price: 1, qty: null },
        { length: 3000, price: 10, qty: null },
      ],
      'price',
    )
    const r = solve(input)
    expect(r.infeasible).toBe(false)
    expect(r.proven).toBe(true)
    expect(r.totalPriceCents).toBe(200)
    expect(r.totalStockUm).toBe(U(4000))
    expect(r.boards).toHaveLength(2)
    expect(r.wasteUm).toBe(U(1000))
  })

  it('finds the least-waste plan in waste mode', () => {
    const input = toInput(
      [1000, 1000, 1000],
      [
        { length: 2000, price: 1, qty: null },
        { length: 3000, price: 10, qty: null },
      ],
      'waste',
    )
    const r = solve(input)
    expect(r.totalStockUm).toBe(U(3000))
    expect(r.totalPriceCents).toBe(1000)
    expect(r.wasteUm).toBe(0)
  })

  it('uses the total price as the waste-mode tie-breaker', () => {
    const input = toInput(
      [1500, 1500],
      [
        { length: 3000, price: 5, qty: null },
        { length: 3000, price: 9, qty: null },
      ],
      'waste',
    )
    const r = solve(input)
    expect(r.totalStockUm).toBe(U(3000))
    expect(r.totalPriceCents).toBe(500)
    expect(r.boards).toHaveLength(1)
  })

  it('prefers longer reusable offcuts when price and material tie', () => {
    // Two 2.4 m boards either leave 200 + 200 mm (both scrap) or 0 + 400 mm
    // (one usable offcut at the default 300 mm minimum).
    const input = toInput(
      [1200, 1200, 1000, 1000],
      [{ length: 2400, price: 10, qty: null }],
      'price',
    )
    const r = solve(input)
    expect(r.totalPriceCents).toBe(2000)
    expect(r.totalStockUm).toBe(U(4800))
    expect(r.offcutUm).toBe(U(400))
    expect(r.offcutCount).toBe(1)
  })
})

describe('kerf, trim and limits', () => {
  it('buys an extra board when two parts plus kerf do not fit', () => {
    const input = toInput([1000, 1000], [{ length: 2000, price: 1, qty: null }], 'price', { kerf: 3 })
    const r = solve(input)
    expect(r.infeasible).toBe(false)
    expect(r.boards).toHaveLength(2)
    expect(r.totalStockUm).toBe(U(4000))
    expect(r.totalKerfUm).toBe(0)
  })

  it('accounts for kerf across a borderline fit', () => {
    const input = toInput([997, 997], [{ length: 2000, price: 1, qty: null }], 'price', { kerf: 3 })
    const r = solve(input)
    expect(r.infeasible).toBe(false)
    expect(r.boards).toHaveLength(1)
    expect(r.boards[0].kerfUm).toBe(U(3))
    expect(r.boards[0].offcutUm).toBe(U(3))
  })

  it('respects stock quantity limits', () => {
    const input = toInput(
      [1000, 1000, 1000],
      [
        { length: 2000, price: 1, qty: 1 },
        { length: 1000, price: 2, qty: null },
      ],
      'price',
    )
    const r = solve(input)
    expect(r.boardCounts['s0']).toBe(1)
    expect(r.boardCounts['s1']).toBe(1)
    expect(r.totalPriceCents).toBe(300)
  })

  it('subtracts trims from usable length', () => {
    const input = toInput([1990], [{ length: 2000, price: 1, qty: null }], 'price', {
      leftTrim: 5,
      rightTrim: 5,
    })
    expect(solve(input).boards).toHaveLength(1)

    const tooLong = toInput([1991], [{ length: 2000, price: 1, qty: null }], 'price', {
      leftTrim: 5,
      rightTrim: 5,
    })
    const r = solve(tooLong)
    expect(r.infeasible).toBe(true)
    expect(r.unmakeable).toHaveLength(1)
  })

  it('reports parts that cannot be made', () => {
    const input = toInput(
      [500, 5000],
      [{ length: 2400, price: 3, qty: null }],
      'price',
    )
    const r = solve(input)
    expect(r.unmakeable).toHaveLength(1)
    expect(r.unmakeable[0].partId).toBe('p1')
    expect(r.boards).toHaveLength(1)
    expect(r.totalPartsUm).toBe(U(500))
  })

  it('reports invalid part lengths', () => {
    const input = toInput([500, 0], [{ length: 2400, price: 1, qty: null }], 'price')
    const r = solve(input)
    expect(r.unmakeable).toHaveLength(1)
    expect(r.unmakeable[0].reason).toBe('invalid')
    expect(r.totalPartsUm).toBe(U(500))
  })
})

describe('randomised optimality check vs brute force', () => {
  it('matches the oracle on 120 small instances', () => {
    let seed = 0x2f6e2b1
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]

    let compared = 0
    for (let iter = 0; iter < 120; iter++) {
      const kindCount = 1 + Math.floor(rand() * 3)
      const types: { lengthUm: number; qty: number }[] = []
      for (let k = 0; k < kindCount; k++) {
        types.push({
          lengthUm: U(pick([400, 500, 700, 1000, 1200, 1500, 1800])),
          qty: 1 + Math.floor(rand() * 3),
        })
      }
      const stockCount = 1 + Math.floor(rand() * 2)
      const stocks: { lengthUm: number; priceCents: number; qty: number | null; usableUm: number }[] = []
      const trimUm = U(pick([0, 0, 20, 50]))
      for (let s = 0; s < stockCount; s++) {
        const lengthUm = U(pick([2000, 2400, 3000, 4000, 6000]))
        stocks.push({
          lengthUm,
          priceCents: Math.round((2 + rand() * 30) * 100),
          qty: rand() < 0.3 ? 1 + Math.floor(rand() * 3) : null,
          usableUm: lengthUm - trimUm,
        })
      }
      const kerfUm = U(pick([0, 3, 4]))
      const mode: Objective = rand() < 0.5 ? 'price' : 'waste'

      const input: SolverInput = {
        parts: types.map((t, i) => ({ id: `p${i}`, lengthUm: t.lengthUm, qty: t.qty })),
        stocks: stocks.map((s, i) => ({
          id: `s${i}`,
          lengthUm: s.lengthUm,
          priceCents: s.priceCents,
          qty: s.qty,
        })),
        options: {
          mode,
          kerfUm,
          leftTrimUm: trimUm,
          rightTrimUm: 0,
          minRemnantUm: U(300),
          timeLimitMs: 0,
        },
      }

      const expected = bruteFromInput(input)
      const actual = solve(input)

      if (!expected) {
        expect(actual.infeasible).toBe(true)
        continue
      }
      expect(actual.infeasible, `instance ${iter}`).toBe(false)
      expect(actual.proven, `instance ${iter} should be proven`).toBe(true)
      expect(actual.totalPriceCents, `instance ${iter} price`).toBe(expected.price)
      expect(actual.totalStockUm, `instance ${iter} length`).toBe(expected.length)

      // Plan sanity: parts accounted for, quantities respected.
      const made = new Map<string, number>()
      for (const b of actual.boards) {
        expect(b.pieces).toBe(b.cuts.length)
        expect(b.offcutUm).toBeGreaterThanOrEqual(0)
        for (const c of b.cuts) made.set(c.partId, (made.get(c.partId) ?? 0) + 1)
      }
      for (const p of input.parts) {
        if (p.lengthUm > Math.max(...stocks.map((s) => s.usableUm))) continue
        expect(made.get(p.id) ?? 0).toBe(p.qty)
      }
      for (const s of input.stocks) {
        if (s.qty !== null) expect(actual.boardCounts[s.id] ?? 0).toBeLessThanOrEqual(s.qty)
      }
      compared++
    }
    expect(compared).toBeGreaterThan(60)
  })
})
