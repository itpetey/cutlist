import { describe, expect, it } from 'vitest'
import { jobKey, normaliseJob, sampleJob, type Job } from './job'

describe('jobKey', () => {
  it('is stable across save, reload and normalisation', () => {
    const job = sampleJob()
    const roundTripped = normaliseJob(JSON.parse(JSON.stringify(job)))
    expect(roundTripped).not.toBeNull()
    // normaliseJob builds the object in a different property order; the key
    // must still match so saved results are not discarded on reload.
    expect(jobKey(roundTripped as Job)).toBe(jobKey(job))
  })

  it('changes when an input changes', () => {
    const job = sampleJob()
    const changed: Job = { ...job, settings: { ...job.settings, kerf: 4 } }
    expect(jobKey(changed)).not.toBe(jobKey(job))
  })
})
