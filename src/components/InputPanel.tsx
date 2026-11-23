import { NumField } from './NumField'
import { PlusIcon, TrashIcon } from './icons'
import {
  newPart,
  newStock,
  TIME_LIMITS,
  type Job,
  type JobSettings,
  type PartRow,
  type StockRow,
} from '../lib/job'

interface InputPanelProps {
  job: Job
  onChange: (job: Job) => void
  onOptimise: () => void
  onCancel: () => void
  solving: boolean
}

export function InputPanel({ job, onChange, onOptimise, onCancel, solving }: InputPanelProps) {
  const patchSettings = (patch: Partial<JobSettings>) =>
    onChange({ ...job, settings: { ...job.settings, ...patch } })

  const patchStock = (id: string, patch: Partial<StockRow>) =>
    onChange({
      ...job,
      stocks: job.stocks.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })

  const patchPart = (id: string, patch: Partial<PartRow>) =>
    onChange({
      ...job,
      parts: job.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })

  const removeStock = (id: string) =>
    onChange({ ...job, stocks: job.stocks.filter((s) => s.id !== id) })

  const removePart = (id: string) =>
    onChange({ ...job, parts: job.parts.filter((p) => p.id !== id) })

  return (
    <aside className="input-panel">
      <section className="card panel-section">
        <div className="section-head">
          <h2>Cutting setup</h2>
          <span className="micro">Applies to every board</span>
        </div>

        <div className="settings-grid">
          <label className="stack">
            <span>
              Kerf / blade <em>mm</em>
            </span>
            <NumField
              value={job.settings.kerf}
              onChange={(v) => patchSettings({ kerf: v ?? 0 })}
              ariaLabel="Kerf or blade thickness in millimetres"
            />
          </label>
          <label className="stack">
            <span>
              Min. usable offcut <em>mm</em>
            </span>
            <NumField
              value={job.settings.minRemnant}
              onChange={(v) => patchSettings({ minRemnant: v ?? 0 })}
              ariaLabel="Minimum length for an offcut to count as reusable, in millimetres"
            />
          </label>
          <label className="stack">
            <span>
              Left trim <em>mm</em>
            </span>
            <NumField
              value={job.settings.leftTrim}
              onChange={(v) => patchSettings({ leftTrim: v ?? 0 })}
              ariaLabel="Left end trim in millimetres"
            />
          </label>
          <label className="stack">
            <span>
              Right trim <em>mm</em>
            </span>
            <NumField
              value={job.settings.rightTrim}
              onChange={(v) => patchSettings({ rightTrim: v ?? 0 })}
              ariaLabel="Right end trim in millimetres"
            />
          </label>
        </div>

        <label className="stack effort">
          <span>Solve effort</span>
          <select
            className="field select"
            value={job.settings.timeLimitMs}
            onChange={(e) => patchSettings({ timeLimitMs: Number(e.target.value) })}
          >
            {TIME_LIMITS.map((limit) => (
              <option key={limit.value} value={limit.value}>
                {limit.label}
              </option>
            ))}
          </select>
        </label>

        <p className="helper">
          Kerf is charged between parts. Blank stock quantity means unlimited.
        </p>
      </section>

      <section className="card panel-section">
        <div className="section-head">
          <h2>Stock</h2>
          <span className="micro">{job.stocks.length} size{job.stocks.length === 1 ? '' : 's'}</span>
        </div>
        {job.stocks.length === 0 ? (
          <p className="empty-rows">No stock yet. Add the lengths you can buy.</p>
        ) : (
          <table className="rows stock-rows">
            <colgroup>
              <col style={{ width: '39%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '7%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Length mm</th>
                <th scope="col">Price AUD</th>
                <th scope="col">Qty</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {job.stocks.map((stock) => (
                <tr key={stock.id}>
                  <td>
                    <input
                      className="field name"
                      value={stock.name}
                      placeholder="2.4 m pine"
                      aria-label="Stock name"
                      autoComplete="off"
                      onChange={(e) => patchStock(stock.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <NumField
                      value={stock.length}
                      onChange={(v) => patchStock(stock.id, { length: v ?? 0 })}
                      ariaLabel={`Length of ${stock.name || 'stock'} in millimetres`}
                    />
                  </td>
                  <td>
                    <NumField
                      value={stock.price}
                      onChange={(v) => patchStock(stock.id, { price: v ?? 0 })}
                      ariaLabel={`Price of ${stock.name || 'stock'} in Australian dollars`}
                    />
                  </td>
                  <td>
                    <NumField
                      value={stock.qty}
                      nullable
                      placeholder="∞"
                      onChange={(v) => patchStock(stock.id, { qty: v })}
                      ariaLabel={`Quantity of ${stock.name || 'stock'}, blank for unlimited`}
                      title="Blank = unlimited"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => removeStock(stock.id)}
                      aria-label={`Remove ${stock.name || 'stock'}`}
                      title="Remove stock"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button
          type="button"
          className="add-row"
          onClick={() =>
            onChange({
              ...job,
              stocks: [
                ...job.stocks,
                newStock({ length: job.stocks.at(-1)?.length ?? 2400 }),
              ],
            })
          }
        >
          <PlusIcon /> Add stock length
        </button>
      </section>

      <section className="card panel-section">
        <div className="section-head">
          <h2>Required parts</h2>
          <span className="micro">
            {job.parts.reduce((n, p) => n + (p.qty > 0 ? p.qty : 0), 0)} pieces
          </span>
        </div>

        {job.parts.length === 0 ? (
          <p className="empty-rows">No parts yet. Add the pieces you need to cut.</p>
        ) : (
          <table className="rows part-rows">
            <colgroup>
              <col style={{ width: '44%' }} />
              <col style={{ width: '29%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Length mm</th>
                <th scope="col">Qty</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {job.parts.map((part) => (
                <tr key={part.id}>
                  <td>
                    <input
                      className="field name"
                      value={part.label}
                      placeholder="Shelf"
                      aria-label="Part label"
                      autoComplete="off"
                      onChange={(e) => patchPart(part.id, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <NumField
                      value={part.length}
                      onChange={(v) => patchPart(part.id, { length: v ?? 0 })}
                      ariaLabel={`Length of ${part.label || 'part'} in millimetres`}
                    />
                  </td>
                  <td>
                    <NumField
                      value={part.qty}
                      onChange={(v) => patchPart(part.id, { qty: v ?? 0 })}
                      ariaLabel={`Quantity of ${part.label || 'part'}`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => removePart(part.id)}
                      aria-label={`Remove ${part.label || 'part'}`}
                      title="Remove part"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button
          type="button"
          className="add-row"
          onClick={() => onChange({ ...job, parts: [...job.parts, newPart()] })}
        >
          <PlusIcon /> Add part
        </button>
      </section>

      <button
        type="button"
        className={solving ? 'ghost solve-wide' : 'primary solve-wide'}
        onClick={solving ? onCancel : onOptimise}
      >
        {solving ? 'Stop search' : 'Optimise cutting plan'}
      </button>

      <details className="how card">
        <summary>How the optimiser works</summary>
        <div className="how-body">
          <p>
            Every run solves <strong>both</strong> objectives with an exact branch-and-bound search over
            cutting patterns. <strong>Price</strong> minimises the total purchase, then material used.{' '}
            <strong>Waste</strong> minimises material, then price. The best plan is shown with a proof
            badge when the search completes.
          </p>
          <p>
            The search runs in <strong>Rust compiled to WebAssembly</strong> and memoises residual
            cutting states so equivalent board orders are explored only once.
          </p>
          <p>
            Prices are per stock piece, so a single long board is compared fairly against several short
            ones, including limited quantities. Kerf is counted between parts; the final cut comes out
            of the offcut.
          </p>
        </div>
      </details>
    </aside>
  )
}
