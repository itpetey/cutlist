import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InputPanel } from './components/InputPanel'
import { ProjectsDialog } from './components/ProjectsDialog'
import { Results } from './components/Results'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { BoltIcon, ChevronDownIcon, FolderIcon, Logo, StopIcon } from './components/icons'
import { blankJob, buildSolverInput, jobKey, sampleJob, uid, type Job } from './lib/job'
import type { Objective, SolveResult, SolverInput, SolverWorkerReply } from './lib/solverTypes'
import {
  blankWorkspace,
  cloneWorkspaceForProject,
  createProject,
  loadProjects,
  nextProjectName,
  projectSummaries,
  saveProjects,
  uniqueProjectName,
  type ProjectLibrary,
} from './lib/projects'
import {
  cloneJob,
  copyName,
  createTab,
  isTabSolved,
  isTabStale,
  nextJobName,
  nextSampleName,
  type JobTab,
  type Workspace,
} from './lib/workspace'

interface WorkerHandle {
  cancel: () => void
}

interface SolveItem {
  id: string
  job: Job
}

function runSolve(input: SolverInput, register: (handle: WorkerHandle) => void): Promise<SolveResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./lib/solver.worker.ts', import.meta.url), {
      type: 'module',
    })
    let settled = false
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      worker.terminate()
      return true
    }
    register({
      cancel: () => {
        if (settled) return
        settled = true
        worker.terminate()
        reject(new Error('Search cancelled.'))
      },
    })
    worker.onmessage = (event: MessageEvent<SolverWorkerReply>) => {
      if (!settle()) return
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => {
      if (!settle()) return
      reject(new Error(event.message || 'The solver worker failed to start.'))
    }
    worker.postMessage(input)
  })
}

function hasSomethingToCut(job: Job): boolean {
  return (
    job.parts.some((p) => p.qty > 0 && p.length > 0) &&
    job.stocks.some((s) => s.length > 0 && s.price >= 0 && (s.qty === null || s.qty > 0))
  )
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason ?? 'Unknown error')
}

export function App() {
  const initialRef = useRef<ProjectLibrary | null>(null)
  if (!initialRef.current) initialRef.current = loadProjects()

  const [library, setLibrary] = useState<ProjectLibrary>(initialRef.current)
  const [solvingIds, setSolvingIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)

  const workersRef = useRef<Set<WorkerHandle>>(new Set())
  const runTokenRef = useRef(0)
  const startedRef = useRef(false)

  const activeProject =
    library.projects.find((project) => project.id === library.activeProjectId) ??
    library.projects[0]
  const workspace = activeProject?.workspace
  const tabs = workspace?.tabs ?? []
  const activeTabId = workspace?.activeTabId ?? ''
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  const anySolving = solvingIds.size > 0
  const activeSolving = activeTab ? solvingIds.has(activeTab.id) : false
  const activeStale = activeTab ? isTabStale(activeTab) : false
  const activeError = activeTab ? (errors[activeTab.id] ?? null) : null

  const runnableCount = useMemo(
    () =>
      tabs.filter((tab) => hasSomethingToCut(tab.job) && (!isTabSolved(tab) || !!errors[tab.id]))
        .length,
    [tabs, errors],
  )

  const summaries = useMemo(() => projectSummaries(library, isTabSolved), [library])

  /**
   * All workspace mutations go through this helper so the active project's
   * tabs are always the single source of truth for the library.
   */
  const updateActiveWorkspace = useCallback(
    (updater: (workspace: Workspace) => Workspace) => {
      setLibrary((prev) => {
        const index = prev.projects.findIndex(
          (project) => project.id === prev.activeProjectId,
        )
        if (index < 0) return prev
        const project = prev.projects[index]
        const nextWorkspace = updater(project.workspace)
        if (nextWorkspace === project.workspace) return prev
        const projects = prev.projects.slice()
        projects[index] = {
          ...project,
          workspace: nextWorkspace,
          updatedAt: Date.now(),
        }
        return { ...prev, projects }
      })
    },
    [],
  )

  const setTabs = useCallback(
    (updater: (tabs: JobTab[]) => JobTab[]) => {
      updateActiveWorkspace((current) => {
        const nextTabs = updater(current.tabs)
        return nextTabs === current.tabs ? current : { ...current, tabs: nextTabs }
      })
    },
    [updateActiveWorkspace],
  )

  const setActiveTabId = useCallback(
    (id: string) => {
      updateActiveWorkspace((current) =>
        current.activeTabId === id ? current : { ...current, activeTabId: id },
      )
    },
    [updateActiveWorkspace],
  )

  const persist = useCallback((libraryToSave: ProjectLibrary) => {
    const status = saveProjects(libraryToSave)
    if (status !== 'failed') setLastSavedAt(Date.now())
    setStorageWarning(
      status === 'full'
        ? null
        : status === 'slim'
          ? 'Browser storage is full. All jobs and tabs were saved, but solved plans may not be restored after a restart.'
          : 'Browser storage is unavailable or full. The latest changes could not be saved.',
    )
  }, [])

  const cancelAll = useCallback(() => {
    runTokenRef.current += 1
    for (const handle of workersRef.current) handle.cancel()
    workersRef.current.clear()
    setSolvingIds(new Set())
  }, [])

  const startRun = useCallback(() => {
    const token = ++runTokenRef.current
    for (const handle of workersRef.current) handle.cancel()
    workersRef.current.clear()
    setSolvingIds(new Set())
    return token
  }, [])

  const solveOne = useCallback(
    async (item: SolveItem, token: number): Promise<boolean> => {
      if (token !== runTokenRef.current) return false

      setErrors((prev) => {
        if (!(item.id in prev)) return prev
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      setSolvingIds((prev) => {
        const next = new Set(prev)
        next.add(item.id)
        return next
      })

      const register = (handle: WorkerHandle) => workersRef.current.add(handle)
      const [priceSettled, wasteSettled] = await Promise.allSettled([
        runSolve(buildSolverInput(item.job, 'price'), register),
        runSolve(buildSolverInput(item.job, 'waste'), register),
      ])

      if (token !== runTokenRef.current) return false

      const price = priceSettled.status === 'fulfilled' ? priceSettled.value : null
      const waste = wasteSettled.status === 'fulfilled' ? wasteSettled.value : null

      const removeSolving = () => {
        setSolvingIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      }

      if (!price && !waste) {
        const reason =
          priceSettled.status === 'rejected'
            ? priceSettled.reason
            : wasteSettled.status === 'rejected'
              ? wasteSettled.reason
              : null
        setErrors((prev) => ({ ...prev, [item.id]: errorMessage(reason) }))
        removeSolving()
        return false
      }

      const failures: string[] = []
      if (priceSettled.status === 'rejected') {
        failures.push(`Cheapest plan failed: ${errorMessage(priceSettled.reason)}`)
      }
      if (wasteSettled.status === 'rejected') {
        failures.push(`Least-waste plan failed: ${errorMessage(wasteSettled.reason)}`)
      }
      if (failures.length > 0) {
        setErrors((prev) => ({ ...prev, [item.id]: failures.join(' ') }))
      }

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== item.id) return tab
          let view = tab.view
          if (view === 'price' && !price) view = 'waste'
          if (view === 'waste' && !waste) view = 'price'
          return {
            ...tab,
            price,
            waste,
            solvedJob: item.job,
            solvedKey: jobKey(item.job),
            view,
          }
        }),
      )
      removeSolving()
      return true
    },
    [setTabs],
  )

  const runSingle = useCallback(
    async (tabId: string, targetJob: Job, scrollToResults: boolean) => {
      const token = startRun()

      if (!hasSomethingToCut(targetJob)) {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? { ...tab, price: null, waste: null, solvedJob: null, solvedKey: null }
              : tab,
          ),
        )
        setErrors((prev) => {
          if (!(tabId in prev)) return prev
          const next = { ...prev }
          delete next[tabId]
          return next
        })
        return
      }

      const ok = await solveOne({ id: tabId, job: targetJob }, token)
      if (!ok || token !== runTokenRef.current) return

      if (scrollToResults && window.matchMedia('(max-width: 1040px)').matches) {
        window.requestAnimationFrame(() => {
          document.querySelector('.results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    },
    [startRun, solveOne, setTabs],
  )

  const solveAll = useCallback(async () => {
    if (solvingIds.size > 0) {
      cancelAll()
      return
    }

    const todo: SolveItem[] = tabs
      .filter((tab) => hasSomethingToCut(tab.job) && (!isTabSolved(tab) || !!errors[tab.id]))
      .map((tab) => ({ id: tab.id, job: tab.job }))
    if (todo.length === 0) return

    const token = startRun()
    setSolvingIds(new Set(todo.map((item) => item.id)))

    let cursor = 0
    const cores =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4
    const concurrency = Math.max(1, Math.min(2, Math.floor(cores / 2)))

    const runner = async () => {
      while (cursor < todo.length) {
        if (token !== runTokenRef.current) return
        const item = todo[cursor++]
        await solveOne(item, token)
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, () => runner()))
    if (token === runTokenRef.current) setSolvingIds(new Set())
  }, [tabs, errors, solvingIds, startRun, solveOne, cancelAll])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const initialLibrary = initialRef.current
    if (!initialLibrary) return
    const project =
      initialLibrary.projects.find((candidate) => candidate.id === initialLibrary.activeProjectId) ??
      initialLibrary.projects[0]
    if (!project) return
    const tab =
      project.workspace.tabs.find((candidate) => candidate.id === project.workspace.activeTabId) ??
      project.workspace.tabs[0]
    if (!tab || isTabSolved(tab)) return
    if (hasSomethingToCut(tab.job)) void runSingle(tab.id, tab.job, false)
  }, [runSingle])

  useEffect(() => {
    const timer = window.setTimeout(() => persist(library), 300)
    return () => window.clearTimeout(timer)
  }, [library, persist])

  const libraryRef = useRef(library)
  libraryRef.current = library
  useEffect(() => {
    const save = () => {
      saveProjects(libraryRef.current)
    }
    window.addEventListener('beforeunload', save)
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('beforeunload', save)
      window.removeEventListener('pagehide', save)
    }
  }, [])

  const updateActiveJob = (next: Job) => {
    if (!activeTab) return
    setTabs((prev) => prev.map((tab) => (tab.id === activeTab.id ? { ...tab, job: next } : tab)))
  }

  const setActiveView = (view: Objective) => {
    if (!activeTab) return
    setTabs((prev) => prev.map((tab) => (tab.id === activeTab.id ? { ...tab, view } : tab)))
  }

  const addTab = () => {
    const tab = createTab(blankJob(), nextJobName(tabs))
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }

  const addSampleTab = () => {
    const tab = createTab(sampleJob(), nextSampleName(tabs))
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    void runSingle(tab.id, tab.job, true)
  }

  const duplicateActive = () => {
    if (!activeTab) return
    const job = cloneJob(activeTab.job)
    const tab: JobTab = {
      ...activeTab,
      id: uid('tab'),
      name: copyName(tabs, activeTab.name),
      job,
      price: activeTab.price,
      waste: activeTab.waste,
      solvedJob: activeTab.solvedJob ? cloneJob(activeTab.solvedJob) : null,
      solvedKey: activeTab.solvedKey,
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return
    if (solvingIds.has(id)) cancelAll()
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const next = tabs.filter((tab) => tab.id !== id)
    setTabs((prev) => prev.filter((tab) => tab.id !== id))
    setErrors((prev) => {
      if (!(id in prev)) return prev
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
    if (id === activeTabId) {
      const neighbour = next[Math.min(index, next.length - 1)]
      setActiveTabId(neighbour.id)
    }
  }

  const renameTab = (id: string, name: string) => {
    const trimmed = name.trim().slice(0, 60)
    if (!trimmed) return
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, name: trimmed } : tab)))
  }

  const openProject = (id: string) => {
    setProjectsOpen(false)
    if (id === library.activeProjectId) return
    cancelAll()
    setLibrary((prev) =>
      prev.projects.some((project) => project.id === id)
        ? { ...prev, activeProjectId: id }
        : prev,
    )
  }

  const newProject = () => {
    cancelAll()
    setLibrary((prev) => {
      const project = createProject(nextProjectName(prev.projects), blankWorkspace())
      return {
        activeProjectId: project.id,
        projects: [...prev.projects, project],
      }
    })
    setProjectsOpen(false)
  }

  const saveAsProject = (name: string) => {
    cancelAll()
    setLibrary((prev) => {
      const source = prev.projects.find((project) => project.id === prev.activeProjectId)
      if (!source) return prev
      const project = createProject(
        uniqueProjectName(prev.projects, name),
        cloneWorkspaceForProject(source.workspace),
      )
      return {
        activeProjectId: project.id,
        projects: [...prev.projects, project],
      }
    })
    setProjectsOpen(false)
  }

  const renameProject = (id: string, name: string) => {
    const trimmed = name.trim().slice(0, 80)
    if (!trimmed) return
    setLibrary((prev) => ({
      ...prev,
      projects: prev.projects.map((project) =>
        project.id === id
          ? { ...project, name: uniqueProjectName(prev.projects, trimmed, id), updatedAt: Date.now() }
          : project,
      ),
    }))
  }

  const deleteProject = (id: string) => {
    if (library.projects.length <= 1) return
    const project = library.projects.find((candidate) => candidate.id === id)
    if (!project) return
    const count = project.workspace.tabs.length
    if (
      !window.confirm(
        `Delete “${project.name}” and its ${count} job tab${count === 1 ? '' : 's'}?`,
      )
    ) {
      return
    }
    if (id === library.activeProjectId) cancelAll()
    setLibrary((prev) => {
      if (prev.projects.length <= 1) return prev
      const index = prev.projects.findIndex((candidate) => candidate.id === id)
      if (index < 0) return prev
      const projects = prev.projects.filter((candidate) => candidate.id !== id)
      const activeProjectId =
        prev.activeProjectId === id
          ? projects[Math.min(index, projects.length - 1)].id
          : prev.activeProjectId
      return { activeProjectId, projects }
    })
    if (id === library.activeProjectId) setProjectsOpen(false)
  }

  const saveNow = useCallback(() => persist(libraryRef.current), [persist])

  return (
    <>
      <div className="sticky-header">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand-group">
              <div className="brand">
                <Logo />
                <div className="brand-text">
                  <span className="brand-name">Cutlist</span>
                  <span className="brand-tag">Price-aware 1D cutting optimiser</span>
                </div>
              </div>

              <button
                type="button"
                className="project-switcher"
                onClick={() => setProjectsOpen(true)}
                aria-label={`Projects: ${activeProject?.name ?? 'Project'}`}
                title="Open projects"
              >
                <FolderIcon />
                <span className="project-switcher-name">
                  {activeProject?.name ?? 'Project'}
                </span>
                <span className="project-chevron" aria-hidden="true">
                  <ChevronDownIcon />
                </span>
              </button>
            </div>

            <div className="topbar-actions">
              <button
                type="button"
                className={anySolving ? 'primary stop' : 'primary'}
                onClick={() => {
                  if (anySolving) cancelAll()
                  else if (activeTab) void runSingle(activeTab.id, activeTab.job, true)
                }}
                disabled={!activeTab}
              >
                {anySolving ? (
                  <>
                    <StopIcon /> Stop all
                  </>
                ) : (
                  <>
                    <BoltIcon /> Optimise
                  </>
                )}
              </button>
            </div>
          </div>
        </header>

        <WorkspaceTabs
          tabs={tabs}
          activeId={activeTab?.id ?? ''}
          solvingIds={solvingIds}
          errors={errors}
          runnableCount={runnableCount}
          anySolving={anySolving}
          onSelect={setActiveTabId}
          onAdd={addTab}
          onClose={closeTab}
          onRename={renameTab}
          onDuplicate={duplicateActive}
          onSample={addSampleTab}
          onSolveAll={() => void solveAll()}
          onStop={cancelAll}
        />
      </div>

      {activeTab && (
        <div
          className="app"
          id="job-panel"
          role="tabpanel"
          aria-labelledby={`job-tab-${activeTab.id}`}
        >
          <InputPanel
            job={activeTab.job}
            onChange={updateActiveJob}
            onOptimise={() => void runSingle(activeTab.id, activeTab.job, true)}
            onCancel={cancelAll}
            solving={activeSolving}
          />

          <Results
            price={activeTab.price}
            waste={activeTab.waste}
            job={activeTab.solvedJob ?? activeTab.job}
            view={activeTab.view}
            onView={setActiveView}
            solving={activeSolving}
            stale={activeStale}
            error={activeError}
            onOptimise={() => void runSingle(activeTab.id, activeTab.job, true)}
          />
        </div>
      )}

      <footer className="app-footer">
        <span>Prices in AUD per stock piece.</span>
        <span>Projects are saved in this browser only.</span>
      </footer>

      <ProjectsDialog
        open={projectsOpen}
        projects={summaries}
        activeId={library.activeProjectId}
        lastSavedAt={lastSavedAt}
        storageWarning={storageWarning}
        onClose={() => setProjectsOpen(false)}
        onOpenProject={openProject}
        onNewProject={newProject}
        onSaveAsProject={saveAsProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onSaveNow={saveNow}
      />
    </>
  )
}
