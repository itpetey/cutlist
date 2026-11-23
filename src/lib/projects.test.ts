import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blankJob, jobKey } from './job'
import {
  blankWorkspace,
  cloneWorkspaceForProject,
  createProject,
  loadProjects,
  nextProjectName,
  saveProjects,
  uniqueProjectName,
} from './projects'
import { createTab, type JobTab, type Workspace } from './workspace'
import type { SolveResult } from './solverTypes'

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  } as Storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function solvedTab(): JobTab {
  const tab = createTab(blankJob(), 'Job 1')
  const result: SolveResult = {
    mode: 'price',
    boards: [],
    totalPriceCents: 0,
    totalStockUm: 0,
    totalPartsUm: 0,
    totalKerfUm: 0,
    totalTrimUm: 0,
    wasteUm: 0,
    offcutUm: 0,
    offcutCount: 0,
    boardCounts: {},
    proven: true,
    timedOut: false,
    patternsIncomplete: false,
    nodes: 0,
    elapsedMs: 0,
    unmakeable: [],
    notes: [],
    infeasible: false,
  }
  return {
    ...tab,
    price: result,
    solvedJob: tab.job,
    solvedKey: jobKey(tab.job),
  }
}

describe('project library', () => {
  it('saves and restores projects and their solved plans', () => {
    const workspace: Workspace = { tabs: [solvedTab()], activeTabId: '' }
    workspace.activeTabId = workspace.tabs[0].id
    const project = createProject('Site A', workspace)
    expect(saveProjects({ activeProjectId: project.id, projects: [project] })).toBe('full')

    const loaded = loadProjects()
    expect(loaded.projects).toHaveLength(1)
    expect(loaded.projects[0].name).toBe('Site A')
    expect(loaded.activeProjectId).toBe(project.id)
    expect(loaded.projects[0].workspace.tabs[0].price?.mode).toBe('price')
    expect(loaded.projects[0].workspace.tabs[0].solvedKey).toBe(
      jobKey(loaded.projects[0].workspace.tabs[0].job),
    )
  })

  it('migrates the previous single workspace into Project 1', () => {
    const tab = createTab(blankJob(), 'Carried over')
    const workspace = { tabs: [tab], activeTabId: tab.id }
    localStorage.setItem('cutlist.workspace.v1', JSON.stringify({ version: 1, ...workspace }))

    const loaded = loadProjects()
    expect(loaded.projects[0].name).toBe('Project 1')
    expect(loaded.projects[0].workspace.tabs[0].name).toBe('Carried over')
  })

  it('gives copied projects fresh tab ids but keeps jobs and results', () => {
    const original = blankWorkspace()
    const sourceTab = original.tabs[0]
    const copy = cloneWorkspaceForProject(original)
    expect(copy.tabs).toHaveLength(1)
    expect(copy.tabs[0].id).not.toBe(sourceTab.id)
    expect(copy.activeTabId).toBe(copy.tabs[0].id)
    expect(copy.tabs[0].job).toEqual(sourceTab.job)
  })

  it('generates unique project names', () => {
    const first = createProject('Project 1', blankWorkspace())
    expect(nextProjectName([first])).toBe('Project 2')
    expect(uniqueProjectName([first], 'Project 1')).toBe('Project 1 2')
  })
})
