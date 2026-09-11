import type { Context } from 'hono'

import {
  drainQueueOnce,
  enqueueReconciliation,
  JOB_NAMES,
  sendJob,
} from '@spliit/jobs'

import { getApiBossForWrite } from '../lib/api/boss'
import { env } from '../lib/env'
import { survivingJobHandlers } from '../lib/jobs/drain-handlers'

/** Vercel sends this on its own cron-triggered requests; reject anything else. */
function requireCronSecret(c: Context): Response | null {
  const auth = c.req.header('authorization')
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return null
}

const DRAIN_TIME_BUDGET_MS = 45_000

export async function runMaterializeDrain(c: Context) {
  const denied = requireCronSecret(c)
  if (denied) return denied

  const boss = await getApiBossForWrite()
  const result = await drainQueueOnce(
    boss,
    JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
    survivingJobHandlers[JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]!,
    { timeBudgetMs: DRAIN_TIME_BUDGET_MS },
  )
  return c.json(result)
}

export async function runReconcileDrain(c: Context) {
  const denied = requireCronSecret(c)
  if (denied) return denied

  const boss = await getApiBossForWrite()
  // Seeds a fresh reconcile pass; singletonKey makes this a safe no-op if one
  // is already queued.
  await enqueueReconciliation(boss)
  const result = await drainQueueOnce(
    boss,
    JOB_NAMES.RECONCILE_RECURRING_EXPENSES,
    survivingJobHandlers[JOB_NAMES.RECONCILE_RECURRING_EXPENSES]!,
    { timeBudgetMs: DRAIN_TIME_BUDGET_MS },
  )
  return c.json(result)
}

export async function runAnonymousCleanupDrain(c: Context) {
  const denied = requireCronSecret(c)
  if (denied) return denied

  const boss = await getApiBossForWrite()
  // Nothing else enqueues this job now that pg-boss's own cron scheduler
  // (boss.schedule) is unused; seed one run per invocation. singletonKey
  // makes this a safe no-op if one is already queued/active.
  await sendJob(
    boss,
    JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP,
    {},
    { singletonKey: 'anonymous-account-cleanup' },
  )
  const result = await drainQueueOnce(
    boss,
    JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP,
    survivingJobHandlers[JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP]!,
    { timeBudgetMs: DRAIN_TIME_BUDGET_MS },
  )
  return c.json(result)
}
