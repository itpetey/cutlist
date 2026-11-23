import { useEffect, useRef, useState } from 'react'
import { hasResults, type JobTab } from '../lib/workspace'
import { jobKey } from '../lib/job'
import { BoltIcon, CopyIcon, PencilIcon, PlusIcon, StopIcon } from './icons'

interface WorkspaceTabsProps {
  tabs: JobTab[]
  activeId: string
  solvingIds: Set<string>
  errors: Record<string, string>
  runnableCount: number
  anySolving: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onDuplicate: () => void
  onSample: () => void
  onSolveAll: () => void
  onStop: () => void
}

export function WorkspaceTabs({
  tabs,
  activeId,
  solvingIds,
  errors,
  runnableCount,
  anySolving,
  onSelect,
  onAdd,
  onClose,
  onRename,
  onDuplicate,
  onSample,
  onSolveAll,
  onStop,
}: WorkspaceTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const cancelRename = useRef(false)
  const activeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const startRename = (tab: JobTab) => {
    cancelRename.current = false
    setRenamingId(tab.id)
    setDraft(tab.name)
  }

  const closeTab = (id: string) => {
    if (renamingId === id) setRenamingId(null)
    onClose(id)
  }

  const commitRename = () => {
    if (cancelRename.current) {
      cancelRename.current = false
      return
    }
    if (!renamingId) return
    const name = draft.trim()
    if (name) onRename(renamingId, name)
    setRenamingId(null)
  }

  return (
    <div className="workspace-bar">
      <div className="tabs-row">
        <div className="tab-scroll" role="tablist" aria-label="Jobs">
          {tabs.map((tab) => {
            const active = tab.id === activeId
            const solving = solvingIds.has(tab.id)
            const error = errors[tab.id]
            const solved = hasResults(tab)
            const stale = solved && tab.solvedKey !== jobKey(tab.job)
            const status = solving
              ? 'solving'
              : error
                ? 'error'
                : stale
                  ? 'stale'
                  : solved
                    ? 'ok'
                    : 'idle'
            const statusText = error
              ? `Error: ${error}`
              : solving
                ? 'Solving…'
                : stale
                  ? 'Inputs changed — re-optimise'
                  : solved
                    ? 'Up to date'
                    : 'Not solved yet'
            const accessibleStatus =
              status === 'error'
                ? ', error'
                : status === 'solving'
                  ? ', solving'
                  : status === 'stale'
                    ? ', inputs changed'
                    : status === 'ok'
                      ? ', solved'
                      : ', not solved'

            return (
              <div
                key={tab.id}
                ref={active ? activeRef : undefined}
                className={`job-tab${active ? ' active' : ''}`}
                role="presentation"
              >
                {renamingId === tab.id ? (
                  <input
                    className="tab-rename"
                    value={draft}
                    autoFocus
                    aria-label={`Rename ${tab.name}`}
                    onChange={(event) => setDraft(event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRename.current = true
                        setRenamingId(null)
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="job-panel"
                    aria-label={`${tab.name}${accessibleStatus}`}
                    id={`job-tab-${tab.id}`}
                    className="tab-main"
                    title={`${tab.name} — ${statusText}. Double-click to rename.`}
                    onClick={() => onSelect(tab.id)}
                    onDoubleClick={() => startRename(tab)}
                  >
                    <span className="tab-name">{tab.name}</span>
                    <span className={`tab-status ${status}`} aria-hidden="true">
                      {solving ? (
                        <span className="spinner tab-spinner" />
                      ) : (
                        <span className={`tab-dot ${status}`} />
                      )}
                    </span>
                  </button>
                )}

                {tabs.length > 1 && (
                  <button
                    type="button"
                    className="tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(tab.id)
                    }}
                    aria-label={`Close ${tab.name}`}
                    title="Close job"
                  >
                    ×
                  </button>
                )}
              </div>
            )
        })}

        </div>
        <button type="button" className="tab-add" onClick={onAdd} aria-label="New job" title="New job">
          <PlusIcon />
        </button>
      </div>

      <div className="workspace-actions">
        <button
          type="button"
          className="ghost small"
          onClick={onSample}
          title="Add the sample job in a new tab"
        >
          <PlusIcon /> Sample job
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            const tab = tabs.find((candidate) => candidate.id === activeId)
            if (tab) startRename(tab)
          }}
          disabled={!tabs.some((candidate) => candidate.id === activeId)}
          title="Rename the active job"
        >
          <PencilIcon /> Rename
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={onDuplicate}
          title="Duplicate the active job in a new tab"
        >
          <CopyIcon /> Duplicate
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={anySolving ? onStop : onSolveAll}
          disabled={!anySolving && runnableCount === 0}
          title={
            anySolving
              ? 'Stop all running solves'
              : runnableCount === 0
                ? 'All jobs are up to date'
                : `Solve ${runnableCount} job${runnableCount === 1 ? '' : 's'} in parallel`
          }
        >
          {anySolving ? (
            <>
              <StopIcon /> Stop all
            </>
          ) : (
            <>
              <BoltIcon /> Solve all{runnableCount > 0 ? ` (${runnableCount})` : ''}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
