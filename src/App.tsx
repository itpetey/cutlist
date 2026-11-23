import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InputPanel } from './components/InputPanel'
import { Results } from './components/Results'
import { BoltIcon, Logo, StopIcon } from './components/icons'
import {
  blankJob,
  buildSolverInput,
  jobKey,
  loadJob,
  sampleJob,
  saveJob,
  type Job,
} from './lib/job'
import type { Objective, SolveResult, SolverInput, SolverWorkerReply } from './lib/solverTypes'

interface Packet {
  price: SolveResult | null
  waste: SolveResult | null
  job: Job
  key: string
}

function runSolve(input: SolverInput, register: (worker: Worker) => void): Promise<SolveResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./lib/solver.worker.ts', import.meta.url), {
      type: 'module',
    })
    register(worker)
    const finish = () => worker.terminate()
    worker.onmessage = (event: MessageEvent<SolverWorkerReply>) => {
      finish()
      if (event.data.ok) {
        resolve(event.data.result)
      } else {
        reject(new Error(event.data.error))
      }
    }
    worker.onerror = (event) => {
      finish()
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

export function App() {
  const initialRef = useRef<Job | null>(null)
  if (!initialRef.current) initialRef.current = loadJob()

  const [job, setJob] = useState<Job>(initialRef.current)
  const [view, setView] = useState<Objective>('price')
  const [solving, setSolving] = useState(false)
  const [packet, setPacket] = useState<Packet | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workers = useRef<Set<Worker>>(new Set())
  const tokenRef = useRef(0)
  const startedRef = useRef(false)

  const optimise = useCallback(async (target: Job, scrollToResults = false) => {
    const token = ++tokenRef.current
    for (const worker of workers.current) worker.terminate()
    workers.current.clear()
    setError(null)

    if (!hasSomethingToCut(target)) {
      setPacket(null)
      setSolving(false)
      return
    }

    setSolving(true)
    const register = (worker: Worker) => workers.current.add(worker)
    const [priceSettled, wasteSettled] = await Promise.allSettled([
      runSolve(buildSolverInput(target, 'price'), register),
      runSolve(buildSolverInput(target, 'waste'), register),
    ])

    if (token !== tokenRef.current) return

    const price = priceSettled.status === 'fulfilled' ? priceSettled.value : null
    const waste = wasteSettled.status === 'fulfilled' ? wasteSettled.value : null

    if (!price && !waste) {
      const reason =
        priceSettled.status === 'rejected'
          ? priceSettled.reason
          : wasteSettled.status === 'rejected'
            ? wasteSettled.reason
            : null
      setError(reason instanceof Error ? reason.message : 'The optimiser could not run.')
      setSolving(false)
      return
    }

    setPacket({ price, waste, job: target, key: jobKey(target) })
    setSolving(false)
    setView((current) => {
      if (current === 'price' && !price) return 'waste'
      if (current === 'waste' && !waste) return 'price'
      return current
    })
    if (scrollToResults && window.matchMedia('(max-width: 1040px)').matches) {
      window.requestAnimationFrame(() => {
        document.querySelector('.results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (initialRef.current && hasSomethingToCut(initialRef.current)) {
      void optimise(initialRef.current)
    }
  }, [optimise])

  useEffect(() => {
    const timer = window.setTimeout(() => saveJob(job), 250)
    return () => window.clearTimeout(timer)
  }, [job])

  const stale = useMemo(() => (packet ? jobKey(job) !== packet.key : false), [job, packet])

  const cancel = useCallback(() => {
    tokenRef.current++
    for (const worker of workers.current) worker.terminate()
    workers.current.clear()
    setSolving(false)
  }, [])

  const loadSample = () => {
    const next = sampleJob()
    setJob(next)
    void optimise(next, true)
  }

  const startNew = () => {
    tokenRef.current++
    for (const worker of workers.current) worker.terminate()
    workers.current.clear()
    setSolving(false)
    setPacket(null)
    setError(null)
    setView('price')
    setJob(blankJob())
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo />
            <div className="brand-text">
              <span className="brand-name">Cutlist</span>
              <span className="brand-tag">Price-aware 1D cutting optimiser</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button type="button" className="ghost" onClick={loadSample}>
              Sample job
            </button>
            <button type="button" className="ghost" onClick={startNew}>
              New job
            </button>
            <button
              type="button"
              className={solving ? 'primary stop' : 'primary'}
              onClick={solving ? cancel : () => void optimise(job, true)}
            >
              {solving ? (
                <>
                  <StopIcon /> Stop search
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

      <div className="app">
        <InputPanel
          job={job}
          onChange={setJob}
          onOptimise={() => void optimise(job, true)}
          onCancel={cancel}
          solving={solving}
        />
        <Results
          price={packet?.price ?? null}
          waste={packet?.waste ?? null}
          job={packet?.job ?? null}
          view={view}
          onView={setView}
          solving={solving}
          stale={stale}
          error={error}
          onOptimise={() => void optimise(job, true)}
        />
      </div>

      <footer className="app-footer">
        <span>Prices in AUD per stock piece.</span>
        <span>Your cut list is saved in this browser only.</span>
      </footer>
    </>
  )
}
