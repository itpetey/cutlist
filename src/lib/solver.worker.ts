import init, { solve as solveWasm } from '../wasm/pkg/cutlist_solver.js'
import type { SolveResult, SolverInput, SolverWorkerReply } from './solverTypes'

const ctx = self as unknown as {
  postMessage: (message: SolverWorkerReply) => void
  onmessage: ((event: MessageEvent<SolverInput>) => void) | null
}

let wasmReady: Promise<void> | null = null

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined)
  }
  return wasmReady
}

ctx.onmessage = (event) => {
  const input = event.data
  void ensureWasm()
    .then(() => {
      const result = JSON.parse(solveWasm(JSON.stringify(input))) as SolveResult
      result.engine = 'wasm'
      ctx.postMessage({ ok: true, result })
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.postMessage({ ok: false, error: `The WASM solver could not run: ${message}` })
    })
}
