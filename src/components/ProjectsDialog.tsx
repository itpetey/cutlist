import { useEffect, useRef, useState, type FormEvent } from 'react'
import { formatTime } from '../lib/format'
import type { ProjectSummary } from '../lib/projects'
import { CheckIcon, CopyIcon, PencilIcon, PlusIcon, TrashIcon } from './icons'

interface ProjectsDialogProps {
  open: boolean
  projects: ProjectSummary[]
  activeId: string
  lastSavedAt: number | null
  storageWarning: string | null
  onClose: () => void
  onOpenProject: (id: string) => void
  onNewProject: () => void
  onSaveAsProject: (name: string) => void
  onRenameProject: (id: string, name: string) => void
  onDeleteProject: (id: string) => void
  onSaveNow: () => void
}

export function ProjectsDialog({
  open,
  projects,
  activeId,
  lastSavedAt,
  storageWarning,
  onClose,
  onOpenProject,
  onNewProject,
  onSaveAsProject,
  onRenameProject,
  onDeleteProject,
  onSaveNow,
}: ProjectsDialogProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const cancelRename = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const activeProject = projects.find((project) => project.id === activeId)

  useEffect(() => {
    if (!open) return
    setRenamingId(null)
    setSaveAsOpen(false)
    setSaveAsName('')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => dialogRef.current?.focus())
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  const startRename = (project: ProjectSummary) => {
    cancelRename.current = false
    setRenamingId(project.id)
    setRenameDraft(project.name)
  }

  const commitRename = () => {
    if (cancelRename.current) {
      cancelRename.current = false
      return
    }
    if (!renamingId) return
    const name = renameDraft.trim()
    if (name) onRenameProject(renamingId, name)
    setRenamingId(null)
  }

  const startSaveAs = () => {
    setSaveAsOpen(true)
    setSaveAsName(activeProject ? `${activeProject.name} copy` : 'New project')
  }

  const submitSaveAs = (event: FormEvent) => {
    event.preventDefault()
    const name = saveAsName.trim()
    if (!name) return
    onSaveAsProject(name)
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="modal projects-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="projects-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="modal-head">
          <div>
            <h2 id="projects-title">Projects</h2>
            <p>Each project keeps its open job tabs and solved plans in this browser.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close projects" title="Close">
            ×
          </button>
        </header>

        <div className="modal-body">
          {storageWarning && (
            <div className="banner warn modal-warning">
              <span>{storageWarning}</span>
            </div>
          )}

          <div className="save-line">
            <span className="save-status">
              <span className={`save-dot${lastSavedAt ? ' saved' : ''}`} aria-hidden="true" />
              {lastSavedAt ? (
                <>
                  <CheckIcon /> Saved at {formatTime(lastSavedAt)}
                </>
              ) : (
                <>
                  <span className="save-dot" aria-hidden="true" /> Changes save automatically
                </>
              )}
            </span>
            <button type="button" className="ghost small" onClick={onSaveNow}>
              Save now
            </button>
          </div>

          <ul className="project-list">
            {projects.map((project) => {
              const active = project.id === activeId
              return (
                <li className={`project-row${active ? ' active' : ''}`} key={project.id}>
                  {renamingId === project.id ? (
                    <input
                      className="field project-rename"
                      value={renameDraft}
                      autoFocus
                      aria-label="Project name"
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setRenameDraft(event.target.value)}
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
                      className="project-open"
                      onClick={() => onOpenProject(project.id)}
                      title={active ? 'Close projects' : `Open ${project.name}`}
                    >
                      <span className="project-row-name">{project.name}</span>
                      <span className="project-meta">
                        {project.tabCount} job{project.tabCount === 1 ? '' : 's'} ·{' '}
                        {project.solvedCount} solved · edited {formatTime(project.updatedAt)}
                      </span>
                    </button>
                  )}

                  {active && <span className="project-current">Current</span>}

                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => startRename(project)}
                    aria-label={`Rename ${project.name}`}
                    title="Rename project"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => onDeleteProject(project.id)}
                    disabled={projects.length <= 1}
                    aria-label={`Delete ${project.name}`}
                    title={
                      projects.length <= 1 ? 'Keep at least one project' : 'Delete project'
                    }
                  >
                    <TrashIcon />
                  </button>
                </li>
              )
            })}
          </ul>

          {saveAsOpen && (
            <form className="save-as-panel" onSubmit={submitSaveAs}>
              <label className="stack save-as-label">
                <span>New project name</span>
                <input
                  className="field"
                  value={saveAsName}
                  autoFocus
                  aria-label="New project name"
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setSaveAsName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      setSaveAsOpen(false)
                    }
                  }}
                />
              </label>
              <div className="save-as-actions">
                <button type="submit" className="primary small" disabled={!saveAsName.trim()}>
                  Save project
                </button>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => setSaveAsOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        <footer className="modal-foot">
          <div className="modal-foot-actions">
            <button type="button" className="ghost small" onClick={onNewProject}>
              <PlusIcon /> New project
            </button>
            {!saveAsOpen && (
              <button type="button" className="primary small" onClick={startSaveAs}>
                <CopyIcon /> Save current tabs as…
              </button>
            )}
          </div>
          <span className="micro">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </span>
        </footer>
      </div>
    </div>
  )
}
