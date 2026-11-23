import { useState } from 'react'
import type { Objective, SolveResult } from '../lib/solverTypes'
import {
  formatDuration,
  formatLength,
  formatMetres,
  formatMoney,
  formatPercent,
} from '../lib/format'
import { groupBoards, planToText, shoppingList } from '../lib/planText'
import { stockLabel, type Job } from '../lib/job'
import { BoardRow } from './BoardRow'
import { AlertIcon, CheckIcon, CopyIcon, InfoIcon, PrintIcon, Spinner } from './icons'

interface ResultsProps {
  price: SolveResult | null
  waste: SolveResult | null
  job: Job | null
  view: Objective
  onView: (view: Objective) => void
  solving: boolean
  stale: boolean
  error: string | null
  onOptimise: () => void
}

function ResultsHeader({
  view,
  onView,
  price,
  waste,
}: Pick<ResultsProps, 'view' | 'onView' | 'price' | 'waste'>) {
  return (
    <div className="results-head">
      <div className="results-title">
        <div className="eyebrow">Cutting plan</div>
        <h1>{view === 'price' ? 'Cheapest plan' : 'Least-waste plan'}</h1>
      </div>
      <div className="mode-tabs" role="tablist" aria-label="Objective shown">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'price'}
          className={view === 'price' ? 'active' : ''}
          onClick={() => onView('price')}
          disabled={!price}
        >
          Cheapest
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'waste'}
          className={view === 'waste' ? 'active' : ''}
          onClick={() => onView('waste')}
          disabled={!waste}
        >
          Least waste
        </button>
      </div>
    </div>
  )
}

function EmptyState({ solving, error }: { solving: boolean; error: string | null }) {
  if (error) {
    return (
      <section className="card callout bad">
        <AlertIcon />
        <div>
          <h3>The optimiser could not run</h3>
          <p>{error}</p>
        </div>
      </section>
    )
  }
  if (solving) {
    return (
      <section className="card empty-state">
        <Spinner />
        <h2>Searching cutting patterns…</h2>
        <p>Comparing stock combinations for price and waste. Large jobs may take a few seconds.</p>
      </section>
    )
  }
  return (
    <section className="card empty-state">
      <div className="empty-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="46" height="46">
          <rect x="4" y="12" width="40" height="7" rx="3.5" fill="currentColor" opacity=".9" />
          <rect x="4" y="22" width="27" height="7" rx="3.5" fill="currentColor" opacity=".55" />
          <rect x="4" y="32" width="34" height="7" rx="3.5" fill="currentColor" opacity=".3" />
        </svg>
      </div>
      <h2>Start with stock and parts</h2>
      <p>
        Add the lengths you can buy, the pieces you need, then press{' '}
        <strong>Optimise cutting plan</strong>. Both the cheapest and the least-waste plans are
        calculated.
      </p>
    </section>
  )
}

function Summary({ result }: { result: SolveResult }) {
  const wastePct = result.totalStockUm > 0 ? result.wasteUm / result.totalStockUm : 0
  const pieces = result.boards.reduce((n, b) => n + b.pieces, 0)

  return (
    <section className="stats" aria-label="Plan summary">
      <article className="stat hero">
        <span className="stat-label">Total price</span>
        <strong className="stat-value">{formatMoney(result.totalPriceCents)}</strong>
        <span className="stat-sub">
          {result.boards.length} stock pieces · {pieces} parts
        </span>
      </article>
      <article className="stat">
        <span className="stat-label">Waste</span>
        <strong className="stat-value">{formatPercent(wastePct)}</strong>
        <span className="stat-sub">
          {formatLength(result.wasteUm)} · {formatLength(result.offcutUm)} reusable
        </span>
      </article>
      <article className="stat">
        <span className="stat-label">Material bought</span>
        <strong className="stat-value">{formatMetres(result.totalStockUm)}</strong>
        <span className="stat-sub">{formatMetres(result.totalPartsUm)} of finished parts</span>
      </article>
      <article className={`stat status ${result.proven ? 'proven' : 'approx'}`}>
        <span className="stat-label">Search</span>
        <strong className="stat-value">
          <span className="dot" aria-hidden="true" />
          {result.proven ? 'Optimal' : 'Best found'}
        </strong>
        <span className="stat-sub">
          {formatDuration(result.elapsedMs)} · {result.nodes.toLocaleString('en-AU')} nodes
          {result.engine ? ' · WASM' : ''}
        </span>
      </article>
    </section>
  )
}

function Tradeoff({
  price,
  waste,
  view,
  onView,
}: {
  price: SolveResult | null
  waste: SolveResult | null
  view: Objective
  onView: (view: Objective) => void
}) {
  if (!price || !waste) return null
  const priceOk = !price.infeasible && price.boards.length > 0
  const wasteOk = !waste.infeasible && waste.boards.length > 0
  if (!priceOk || !wasteOk) return null

  const samePlan =
    price.totalPriceCents === waste.totalPriceCents && price.totalStockUm === waste.totalStockUm
  const costDelta = waste.totalPriceCents - price.totalPriceCents
  const wasteDelta = price.wasteUm - waste.wasteUm

  let note: string
  if (samePlan) {
    note = 'Both objectives agree: this plan is the cheapest and uses the least material.'
  } else if (costDelta === 0) {
    note = `Both cost the same, but the least-waste plan saves ${formatLength(wasteDelta)}.`
  } else if (wasteDelta === 0) {
    note = `The cheapest plan also uses the least material, saving ${formatMoney(costDelta)}.`
  } else {
    note = `Cheapest saves ${formatMoney(
      costDelta,
    )}, but the least-waste plan saves ${formatLength(wasteDelta)} of material.`
  }

  return (
    <section className="card tradeoff">
      <div className="tradeoff-head">
        <div>
          <h2>Price vs waste</h2>
          <p>Both objectives are solved on every run.</p>
        </div>
        <span className={`trade-badge${samePlan ? ' same' : ''}`}>
          {samePlan ? 'Same plan' : 'Trade-off'}
        </span>
      </div>
      <div className="tradeoff-grid">
        <button
          type="button"
          className={`trade-option${view === 'price' ? ' active' : ''}`}
          onClick={() => onView('price')}
          aria-pressed={view === 'price'}
        >
          <span className="trade-label">Cheapest</span>
          <strong>{formatMoney(price.totalPriceCents)}</strong>
          <span className="trade-sub">
            {formatLength(price.wasteUm)} waste · {price.boards.length} pieces
          </span>
        </button>
        <button
          type="button"
          className={`trade-option${view === 'waste' ? ' active' : ''}`}
          onClick={() => onView('waste')}
          aria-pressed={view === 'waste'}
        >
          <span className="trade-label">Least waste</span>
          <strong>{formatMoney(waste.totalPriceCents)}</strong>
          <span className="trade-sub">
            {formatLength(waste.wasteUm)} waste · {waste.boards.length} pieces
          </span>
        </button>
      </div>
      <p className="trade-note">{note}</p>
    </section>
  )
}

function ShoppingList({ job, result }: { job: Job; result: SolveResult }) {
  const rows = shoppingList(job, result)
  return (
    <section className="card analysis-card">
      <div className="card-head">
        <h2>Shopping list</h2>
        <span className="micro">{rows.length} line{rows.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="shop-list">
        {rows.map(({ stock, board, qty }) => (
          <li key={board.stockId}>
            <span className="shop-name">
              {stockLabel(stock, board.stockLengthUm)}
              <em>
                {formatLength(board.stockLengthUm)} · {formatMoney(board.priceCents)} each
                {stock?.qty != null && ` · ${stock.qty} available`}
              </em>
            </span>
            <span className="shop-qty">{qty} ×</span>
            <span className="shop-amount">{formatMoney(board.priceCents * qty)}</span>
          </li>
        ))}
      </ul>
      <div className="shop-total">
        <span>Total</span>
        <strong>{formatMoney(result.totalPriceCents)}</strong>
      </div>
    </section>
  )
}

function MaterialBreakdown({
  result,
  minRemnantUm,
}: {
  result: SolveResult
  minRemnantUm: number
}) {
  const { totalStockUm, totalPartsUm, totalKerfUm, totalTrimUm, offcutUm, wasteUm } = result
  const scrapUm = Math.max(0, wasteUm - totalKerfUm - totalTrimUm - offcutUm)

  const segments = [
    { key: 'parts', label: 'Finished parts', um: totalPartsUm, total: totalStockUm },
    { key: 'kerf', label: 'Saw kerf', um: totalKerfUm, total: totalStockUm },
    { key: 'trim', label: 'End trim', um: totalTrimUm, total: totalStockUm },
    { key: 'offcut', label: 'Reusable offcuts', um: offcutUm, total: totalStockUm },
    { key: 'scrap', label: 'Scrap', um: scrapUm, total: totalStockUm },
  ].filter((s) => s.um > 0)

  return (
    <section className="card analysis-card">
      <div className="card-head">
        <h2>Where the material goes</h2>
        <span className="micro">{formatMetres(totalStockUm)} bought</span>
      </div>
      <div className="material-bar" aria-hidden="true">
        {segments.map((s) => (
          <div
            key={s.key}
            className={`mat-${s.key}`}
            style={{ flexGrow: s.um, flexBasis: 0 }}
            title={`${s.label} ${formatLength(s.um)}`}
          />
        ))}
      </div>
      <ul className="material-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`swatch mat-${s.key}`} aria-hidden="true" />
            <span className="mat-label">{s.label}</span>
            <span className="mat-value">
              {formatLength(s.um)}
              <em>{formatPercent(s.um / totalStockUm)}</em>
            </span>
          </li>
        ))}
      </ul>
      <p className="material-note">
        Offcuts under {formatLength(minRemnantUm)} count as scrap. Raise the minimum offcut in
        setup if you keep shorter pieces.
      </p>
    </section>
  )
}

function CutPlan({ job, result }: { job: Job; result: SolveResult }) {
  const [copied, setCopied] = useState(false)
  const groups = groupBoards(result)

  const partName = (partId: string, lengthUm: number) => {
    const part = job.parts.find((p) => p.id === partId)
    return part?.label?.trim() || `${formatLength(lengthUm)} part`
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planToText(job, result))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  let counter = 0

  return (
    <section className="plan">
      <div className="plan-head">
        <div>
          <h2>Cutting plan</h2>
          <p>
            {result.boards.length} stock pieces · cut from the stock you selected
          </p>
        </div>
        <div className="plan-actions no-print">
          <button type="button" className="ghost small" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy list'}
          </button>
          <button type="button" className="ghost small" onClick={() => window.print()}>
            <PrintIcon /> Print
          </button>
        </div>
      </div>

      <div className="legend" aria-hidden="true">
        <span>
          <i className="swatch cut" /> Part
        </span>
        <span>
          <i className="swatch kerf" /> Kerf
        </span>
        <span>
          <i className="swatch offcut" /> Offcut
        </span>
        <span>
          <i className="swatch scrap" /> Waste
        </span>
      </div>

      <div className="board-groups">
        {groups.map((group) => {
          const first = group.boards[0]
          const stock = job.stocks.find((s) => s.id === group.stockId)
          const name = stockLabel(stock, first.stockLengthUm)
          return (
            <article className="card board-group" key={group.stockId}>
              <header className="group-head">
                <div className="group-title">
                  <h3>{name}</h3>
                  <span className="group-meta">
                    {formatLength(first.stockLengthUm)} · {formatMoney(first.priceCents)} each
                  </span>
                </div>
                <div className="group-cost">
                  {group.boards.length} × <strong>{formatMoney(first.priceCents * group.boards.length)}</strong>
                </div>
              </header>
              <div className="group-boards">
                {group.boards.map((board) => {
                  counter++
                  return (
                    <BoardRow
                      key={`${group.stockId}-${counter}`}
                      board={board}
                      number={counter}
                      job={job}
                      partName={partName}
                    />
                  )
                })}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function Results({
  price,
  waste,
  job,
  view,
  onView,
  solving,
  stale,
  error,
  onOptimise,
}: ResultsProps) {
  const result = view === 'price' ? price : waste

  if (!result || !job) {
    return (
      <main className="results" aria-busy={solving}>
        <ResultsHeader view={view} onView={onView} price={price} waste={waste} />
        <EmptyState solving={solving} error={error} />
      </main>
    )
  }

  const unmakeable = result.unmakeable
  const hasPlan = !result.infeasible && result.boards.length > 0

  return (
    <main className="results" aria-busy={solving}>
      {solving && <div className="progress-line" aria-hidden="true" />}
      <ResultsHeader view={view} onView={onView} price={price} waste={waste} />

      {stale && (
        <div className="banner warn no-print">
          <InfoIcon />
          <span>Inputs changed since this plan was calculated.</span>
          <button type="button" className="link" onClick={onOptimise}>
            Re-optimise
          </button>
        </div>
      )}

      {error && (
        <div className="banner bad">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {!hasPlan ? (
        <section className="card callout bad">
          <AlertIcon />
          <div>
            <h3>No cutting plan</h3>
            <p>{result.error ?? 'None of the required parts fit the available stock.'}</p>
          </div>
        </section>
      ) : (
        <>
          <Summary result={result} />
          <Tradeoff price={price} waste={waste} view={view} onView={onView} />

          {unmakeable.length > 0 && (
            <section className="banner bad">
              <AlertIcon />
              <div>
                <strong>Some parts were left out because they are longer than any usable stock:</strong>
                <ul>
                  {unmakeable.map((u) => (
                    <li key={u.partId}>
                      {u.qty} × {job.parts.find((p) => p.id === u.partId)?.label?.trim() || 'part'} —{' '}
                      {formatLength(u.lengthUm)}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <div className="analysis-grid">
            <ShoppingList job={job} result={result} />
            <MaterialBreakdown
              result={result}
              minRemnantUm={Math.round(job.settings.minRemnant * 1000)}
            />
          </div>

          <CutPlan job={job} result={result} />

          {result.notes.length > 0 && (
            <div className="notes">
              {result.notes.map((note) => (
                <p key={note}>
                  <InfoIcon /> {note}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}
