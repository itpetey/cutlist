import { Fragment } from 'react'
import type { BoardPlan } from '../lib/solverTypes'
import { formatLength, formatLengthValue } from '../lib/format'
import type { Job } from '../lib/job'

interface BoardRowProps {
  board: BoardPlan
  number: number
  job: Job
  partName: (partId: string, lengthUm: number) => string
}

const LABEL_THRESHOLD = 0.075

export function BoardRow({ board, number, job, partName }: BoardRowProps) {
  const leftTrimUm = Math.max(0, Math.round(job.settings.leftTrim * 1000))
  const rightTrimUm = Math.max(0, Math.round(job.settings.rightTrim * 1000))
  const kerfUm = Math.max(0, Math.round(job.settings.kerf * 1000))
  const minRemnantUm = Math.max(0, Math.round(job.settings.minRemnant * 1000))
  const total = board.stockLengthUm || 1
  const share = (um: number) => um / total
  const usableOffcut = board.offcutUm >= minRemnantUm && board.offcutUm > 0

  const label = board.cuts
    .map((cut) => `${partName(cut.partId, cut.lengthUm)} ${formatLength(cut.lengthUm)}`)
    .join(', ')

  return (
    <div className="board">
      <div className="board-index" aria-hidden="true">
        {String(number).padStart(2, '0')}
      </div>
      <div className="board-main">
        <div
          className="bar"
          role="img"
          aria-label={`Board ${number}: ${label}. ${
            usableOffcut ? 'Reusable offcut' : 'Waste'
          } ${formatLength(board.offcutUm)}.`}
        >
          {leftTrimUm > 0 && (
            <div
              className="seg trim"
              style={{ flexGrow: leftTrimUm }}
              title={`Left trim ${formatLength(leftTrimUm)}`}
              aria-hidden="true"
            />
          )}

          {board.cuts.map((cut, i) => (
            <Fragment key={`${cut.partId}-${i}`}>
              <div
                className={`seg cut${i % 2 === 1 ? ' shade-b' : ''}`}
                style={{ flexGrow: cut.lengthUm }}
                title={`${partName(cut.partId, cut.lengthUm)} · ${formatLength(cut.lengthUm)}`}
                aria-hidden="true"
              >
                {share(cut.lengthUm) >= 0.18 ? (
                  <span className="seg-label">
                    {partName(cut.partId, cut.lengthUm)} · {formatLengthValue(cut.lengthUm)}
                  </span>
                ) : (
                  share(cut.lengthUm) >= LABEL_THRESHOLD && (
                    <span className="seg-label">{formatLengthValue(cut.lengthUm)}</span>
                  )
                )}
              </div>
              {i < board.cuts.length - 1 && kerfUm > 0 && (
                <div
                  className="seg kerf"
                  style={{ flexGrow: kerfUm }}
                  title={`Saw kerf ${formatLength(kerfUm)}`}
                  aria-hidden="true"
                />
              )}
            </Fragment>
          ))}

          {rightTrimUm > 0 && (
            <div
              className="seg trim"
              style={{ flexGrow: rightTrimUm }}
              title={`Right trim ${formatLength(rightTrimUm)}`}
              aria-hidden="true"
            />
          )}

          {board.offcutUm > 0 && (
            <div
              className={`seg offcut${usableOffcut ? ' usable' : ' scrap'}`}
              style={{ flexGrow: board.offcutUm }}
              title={`${usableOffcut ? 'Reusable offcut' : 'Waste'} ${formatLength(board.offcutUm)}`}
              aria-hidden="true"
            >
              {share(board.offcutUm) >= LABEL_THRESHOLD && (
                <span className="seg-label">{formatLengthValue(board.offcutUm)}</span>
              )}
            </div>
          )}
        </div>

        <div className="board-meta">
          <code className="sequence">
            {board.cuts.map((cut) => formatLengthValue(cut.lengthUm)).join(' + ')}
          </code>
          <span className={`offcut-pill${usableOffcut ? ' good' : ''}`}>
            {board.offcutUm <= 0
              ? 'No offcut'
              : `${usableOffcut ? 'Offcut' : 'Waste'} ${formatLength(board.offcutUm)}`}
          </span>
        </div>
      </div>
    </div>
  )
}
