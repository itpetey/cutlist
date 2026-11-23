import { readFileSync } from 'node:fs'
import { initSync, solve } from '../src/wasm/pkg/cutlist_solver.js'

initSync({ module: readFileSync(new URL('../src/wasm/pkg/cutlist_solver_bg.wasm', import.meta.url)) })

const U = (mm) => Math.round(mm * 1000)

function makeJob(kindCount, qty) {
  const lengths = [300, 450, 600, 750, 900, 1200, 1500, 1800, 2100, 2400]
  const parts = Array.from({ length: kindCount }, (_, i) => ({
    id: `p${i}`,
    lengthUm: U(lengths[i % lengths.length] + (i % 7) * 10),
    qty,
  }))
  const stocks = [
    { id: 's1', lengthUm: U(2400), priceCents: 990, qty: null },
    { id: 's2', lengthUm: U(3600), priceCents: 1390, qty: null },
    { id: 's3', lengthUm: U(4800), priceCents: 1750, qty: null },
    { id: 's4', lengthUm: U(5400), priceCents: 2060, qty: null },
    { id: 's5', lengthUm: U(6000), priceCents: 2290, qty: null },
    { id: 's6', lengthUm: U(1200), priceCents: 150, qty: 8 },
  ]
  return { parts, stocks }
}

for (const [kinds, qty] of [
  [6, 3],
  [10, 3],
  [15, 2],
  [20, 2],
  [25, 2],
  [30, 2],
]) {
  const { parts, stocks } = makeJob(kinds, qty)
  for (const mode of ['price', 'waste']) {
    const t = performance.now()
    const result = JSON.parse(
      solve(
        JSON.stringify({
          parts,
          stocks,
          options: {
            mode,
            kerfUm: U(3),
            leftTrimUm: 0,
            rightTrimUm: 0,
            minRemnantUm: U(300),
            timeLimitMs: 10_000,
          },
        }),
      ),
    )
    console.log(
      `${String(kinds).padStart(2)} kinds × ${qty} = ${kinds * qty} parts, ${mode.padEnd(5)} -> ` +
        `${(result.proven ? 'OPTIMAL' : result.timedOut ? 'timeout' : 'pruned').padEnd(7)} ` +
        `${(performance.now() - t).toFixed(0).padStart(5)} ms  ` +
        `$${(result.totalPriceCents / 100).toFixed(2)}  ` +
        `${result.boards.length} boards  waste ${(result.wasteUm / 1000).toFixed(0)} mm  ` +
        `nodes ${result.nodes.toLocaleString()}`,
    )
  }
}
