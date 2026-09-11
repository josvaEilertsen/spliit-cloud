import type { JobWithMetadata, PgBoss } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'

import { drainQueueOnce } from './drain'
import { JOB_NAMES } from './registry'

function makeJob<T extends object>(
  id: string,
  data: T,
  overrides: Partial<JobWithMetadata<T>> = {},
): JobWithMetadata<T> {
  const controller = new AbortController()
  return {
    id,
    name: JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
    data,
    expireInSeconds: 300,
    heartbeatSeconds: null,
    signal: controller.signal,
    groupId: null,
    groupTier: null,
    priority: 0,
    state: 'active',
    retryLimit: 5,
    retryCount: 0,
    retryDelay: 30,
    retryBackoff: true,
    startAfter: new Date(),
    startedOn: new Date(),
    singletonKey: null,
    singletonOn: null,
    deleteAfterSeconds: 86_400,
    createdOn: new Date(),
    completedOn: null,
    keepUntil: new Date(),
    policy: 'exclusive',
    heartbeatOn: null,
    blocked: false,
    blocking: false,
    pendingDependencies: 0,
    deadLetter: null,
    output: {},
    sourceName: null,
    sourceId: null,
    sourceCreatedOn: null,
    sourceRetryCount: null,
    ...overrides,
  } as JobWithMetadata<T>
}

function createBossMock(batches: JobWithMetadata<object>[][]) {
  const fetch = vi.fn(async () => batches.shift() ?? [])
  const complete = vi.fn(async () => undefined)
  const fail = vi.fn(async () => undefined)
  return {
    boss: { fetch, complete, fail } as unknown as PgBoss,
    fetch,
    complete,
    fail,
  }
}

const payload = {
  seriesId: 'series-1',
  sequence: 1,
  occurrenceDate: '2026-01-01',
}

describe('drainQueueOnce', () => {
  it('fetches until the queue is empty and completes each job', async () => {
    const jobs = [makeJob('job-1', payload), makeJob('job-2', payload)]
    const { boss, fetch, complete } = createBossMock([jobs, []])
    const handler = vi.fn(async () => undefined)

    const result = await drainQueueOnce(
      boss as never,
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      handler,
    )

    expect(fetch).toHaveBeenCalledWith(
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      expect.objectContaining({ includeMetadata: true }),
    )
    expect(handler).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      queue: JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      fetched: 2,
      completed: 2,
      failed: 0,
    })
  })

  it('stops as soon as a fetch returns fewer jobs than batchSize', async () => {
    const jobs = [makeJob('job-1', payload)]
    const { boss, fetch } = createBossMock([jobs])
    const handler = vi.fn(async () => undefined)

    await drainQueueOnce(
      boss as never,
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      handler,
      { batchSize: 10 },
    )

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fails a job whose handler throws, and continues with the rest of the batch', async () => {
    const jobs = [makeJob('job-1', payload), makeJob('job-2', payload)]
    const { boss, complete, fail } = createBossMock([jobs, []])
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)

    const result = await drainQueueOnce(
      boss as never,
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      handler,
    )

    expect(fail).toHaveBeenCalledWith(
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      'job-1',
      expect.objectContaining({ message: 'boom' }),
    )
    expect(complete).toHaveBeenCalledWith(
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      'job-2',
    )
    expect(result).toEqual({
      queue: JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      fetched: 2,
      completed: 1,
      failed: 1,
    })
  })

  it('respects maxBatches as a safety cap', async () => {
    const { boss, fetch } = createBossMock([
      [makeJob('job-1', payload)],
      [makeJob('job-2', payload)],
      [makeJob('job-3', payload)],
    ])
    const handler = vi.fn(async () => undefined)

    await drainQueueOnce(
      boss as never,
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      handler,
      { batchSize: 1, maxBatches: 2 },
    )

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops fetching new batches once the time budget has elapsed', async () => {
    const { boss, fetch } = createBossMock([[makeJob('job-1', payload)]])
    const handler = vi.fn(async () => undefined)

    await drainQueueOnce(
      boss as never,
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      handler,
      { timeBudgetMs: -1 },
    )

    expect(fetch).not.toHaveBeenCalled()
  })
})
