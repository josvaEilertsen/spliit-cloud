import type { JobWithMetadata } from 'pg-boss'

import type { SpliitBoss } from './boss'
import type { JobHandler, JobHandlerContext } from './lifecycle'
import { jobPayloadSchema, type JobName, type JobPayload } from './registry'

export type DrainOptions = {
  /** Jobs pulled per fetch call. */
  batchSize?: number
  /** Safety cap on fetch iterations, in case a queue never empties. */
  maxBatches?: number
  /** Stop fetching further batches once this much time has elapsed. */
  timeBudgetMs?: number
}

export type DrainResult = {
  queue: JobName
  fetched: number
  completed: number
  failed: number
}

/**
 * Pull and process everything currently queued for `name`, once, using
 * pg-boss's low-level fetch/complete/fail primitives instead of `boss.work()`'s
 * persistent subscription loop. Reuses the same handler shape as
 * `registerHandlers` so existing job handlers are unchanged; only the
 * invocation model differs, so retry/DLQ/singleton-key behavior configured in
 * `boss.ts` still applies.
 */
export async function drainQueueOnce<Name extends JobName>(
  boss: SpliitBoss,
  name: Name,
  handler: JobHandler<Name>,
  options: DrainOptions = {},
): Promise<DrainResult> {
  const batchSize = options.batchSize ?? 10
  const maxBatches = options.maxBatches ?? 50
  const deadline = options.timeBudgetMs
    ? Date.now() + options.timeBudgetMs
    : undefined

  let fetched = 0
  let completed = 0
  let failed = 0

  for (let batch = 0; batch < maxBatches; batch++) {
    if (deadline && Date.now() > deadline) break

    const jobs: JobWithMetadata<JobPayload<Name>>[] = await boss.fetch(name, {
      batchSize,
      includeMetadata: true,
    })
    if (jobs.length === 0) break
    fetched += jobs.length

    for (const job of jobs) {
      try {
        const payload = jobPayloadSchema(name).parse(job.data)
        await handler(
          payload as never,
          {
            boss,
            name,
            jobId: job.id,
            signal: job.signal,
            retryCount: job.retryCount,
            retryLimit: job.retryLimit,
          } as JobHandlerContext<Name>,
        )
        await boss.complete(name, job.id)
        completed++
      } catch (error) {
        await boss.fail(name, job.id, {
          message: error instanceof Error ? error.message : String(error),
        })
        failed++
      }
    }

    if (jobs.length < batchSize) break
  }

  return { queue: name, fetched, completed, failed }
}
