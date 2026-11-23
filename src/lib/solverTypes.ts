/**
 * Wire types shared by the app and the Rust/WASM solver.
 *
 * Lengths are integer micrometres (µm) and prices integer cents so that all
 * solver arithmetic is exact.
 */

export type Objective = 'price' | 'waste'

export interface SolverPart {
  id: string
  /** length in µm */
  lengthUm: number
  qty: number
}

export interface SolverStock {
  id: string
  /** full length in µm */
  lengthUm: number
  /** price in cents */
  priceCents: number
  /** null = unlimited */
  qty: number | null
}

export interface SolverOptions {
  mode: Objective
  kerfUm: number
  leftTrimUm: number
  rightTrimUm: number
  minRemnantUm: number
  /** 0 = no limit */
  timeLimitMs: number
  /** cap on enumerated patterns (default 250_000) */
  patternLimit?: number
}

export interface SolverInput {
  parts: SolverPart[]
  stocks: SolverStock[]
  options: SolverOptions
}

export interface CutPlanItem {
  partId: string
  lengthUm: number
}

export interface BoardPlan {
  stockId: string
  stockLengthUm: number
  priceCents: number
  cuts: CutPlanItem[]
  pieces: number
  partsUm: number
  kerfUm: number
  trimUm: number
  offcutUm: number
}

export interface UnmakeablePart {
  partId: string
  qty: number
  lengthUm: number
  reason: 'too-long' | 'invalid'
}

export interface SolveResult {
  mode: Objective
  boards: BoardPlan[]
  totalPriceCents: number
  totalStockUm: number
  totalPartsUm: number
  totalKerfUm: number
  totalTrimUm: number
  /** everything that is not a part: kerf + trim + offcut */
  wasteUm: number
  /** offcuts at least minRemnant long */
  offcutUm: number
  offcutCount: number
  boardCounts: Record<string, number>
  proven: boolean
  timedOut: boolean
  patternsIncomplete: boolean
  nodes: number
  elapsedMs: number
  unmakeable: UnmakeablePart[]
  notes: string[]
  infeasible: boolean
  /** Which engine produced this result (stamped by the worker). */
  engine?: 'wasm'
  error?: string
}

export type SolverWorkerReply =
  | { ok: true; result: SolveResult }
  | { ok: false; error: string }
