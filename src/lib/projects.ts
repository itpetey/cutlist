import { blankJob, uid } from './job'
import {
  createTab,
  loadWorkspace,
  normaliseWorkspace,
  type Workspace,
} from './workspace'

export interface Project {
  id: string
  name: string
  workspace: Workspace
  createdAt: number
  updatedAt: number
}

export interface ProjectLibrary {
  activeProjectId: string
  projects: Project[]
}

export interface ProjectSummary {
  id: string
  name: string
  tabCount: number
  solvedCount: number
  updatedAt: number
}

export type SaveStatus = 'full' | 'slim' | 'failed'

const PROJECTS_KEY = 'cutlist.projects.v1'
const MAX_PROJECTS = 100

export function createProject(name: string, workspace: Workspace): Project {
  const now = Date.now()
  return {
    id: uid('proj'),
    name,
    workspace,
    createdAt: now,
    updatedAt: now,
  }
}

export function blankWorkspace(): Workspace {
  const tab = createTab(blankJob(), 'Job 1')
  return { tabs: [tab], activeTabId: tab.id }
}

/**
 * Deep copy for a new project. Tab ids are regenerated so transient UI state
 * (errors, solving flags) cannot leak between projects; job and result ids stay
 * intact so solved plans still resolve their parts and stock.
 */
export function cloneWorkspaceForProject(workspace: Workspace): Workspace {
  const copy = JSON.parse(JSON.stringify(workspace)) as Workspace
  const ids = new Map<string, string>()
  copy.tabs = copy.tabs.map((tab) => {
    const id = uid('tab')
    ids.set(tab.id, id)
    return { ...tab, id }
  })
  copy.activeTabId = ids.get(copy.activeTabId) ?? copy.tabs[0]?.id ?? ''
  return copy
}

function slimWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    tabs: workspace.tabs.map((tab) => ({
      ...tab,
      price: null,
      waste: null,
      solvedJob: null,
      solvedKey: null,
    })),
  }
}

function normaliseLibrary(input: unknown): ProjectLibrary | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { activeProjectId?: unknown; projects?: unknown }
  if (!Array.isArray(raw.projects)) return null

  const projects: Project[] = []
  const ids = new Set<string>()
  for (const item of raw.projects) {
    if (projects.length >= MAX_PROJECTS) break
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<Project> & Record<string, unknown>
    const workspace = normaliseWorkspace(candidate.workspace)
    if (!workspace) continue

    let id = typeof candidate.id === 'string' && candidate.id ? candidate.id : uid('proj')
    if (ids.has(id)) id = uid('proj')
    ids.add(id)

    const name =
      typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim().slice(0, 80)
        : 'Project'
    const createdAt =
      typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
        ? candidate.createdAt
        : Date.now()
    const updatedAt =
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : createdAt

    projects.push({ id, name, workspace, createdAt, updatedAt })
  }

  if (projects.length === 0) return null
  const activeProjectId =
    typeof raw.activeProjectId === 'string' &&
    projects.some((project) => project.id === raw.activeProjectId)
      ? raw.activeProjectId
      : projects[0].id
  return { activeProjectId, projects }
}

/**
 * Loads the project library, or creates the first project from the previous
 * single-workspace save (which itself migrates the older single-job save).
 */
export function loadProjects(): ProjectLibrary {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY)
      if (raw) {
        const library = normaliseLibrary(JSON.parse(raw))
        if (library) return library
      }
    } catch {
      // Corrupt or unavailable storage: fall back to migration.
    }
  }

  const project = createProject('Project 1', loadWorkspace())
  return { activeProjectId: project.id, projects: [project] }
}

export function saveProjects(library: ProjectLibrary): SaveStatus {
  if (typeof localStorage === 'undefined') return 'failed'
  const payload = {
    version: 1,
    activeProjectId: library.activeProjectId,
    projects: library.projects,
  }
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(payload))
    return 'full'
  } catch {
    // Solved plans are the bulky part. Keep every project and job first.
    try {
      const slim = {
        ...payload,
        projects: library.projects.map((project) => ({
          ...project,
          workspace: slimWorkspace(project.workspace),
        })),
      }
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(slim))
      return 'slim'
    } catch {
      return 'failed'
    }
  }
}

export function projectSummaries(
  library: ProjectLibrary,
  isSolved: (workspaceTab: Workspace['tabs'][number]) => boolean,
): ProjectSummary[] {
  return library.projects.map((project) => ({
    id: project.id,
    name: project.name,
    tabCount: project.workspace.tabs.length,
    solvedCount: project.workspace.tabs.filter(isSolved).length,
    updatedAt: project.updatedAt,
  }))
}

export function nextProjectName(projects: Project[]): string {
  const names = new Set(projects.map((project) => project.name))
  let n = 1
  while (names.has(`Project ${n}`)) n++
  return `Project ${n}`
}

export function uniqueProjectName(
  projects: Project[],
  base: string,
  excludeId?: string,
): string {
  const names = new Set(
    projects.filter((project) => project.id !== excludeId).map((project) => project.name),
  )
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

