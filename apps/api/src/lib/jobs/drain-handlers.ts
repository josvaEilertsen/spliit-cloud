import { waitUntil } from '@vercel/functions'

import {
  drainQueueOnce,
  type JobHandlers,
  type JobName,
  JOB_NAMES,
  type SpliitBoss,
} from '@spliit/jobs'

import {
  materializeRecurringExpense,
  reconcileDueRecurringExpenses,
} from '../api/recurrence-series'
import { runAnonymousAccountCleanup } from '../auth/anonymous-account-cleanup'
import { logServerWarn } from '../logging'

/**
 * Handlers for the job types still processed after the worker was retired.
 * Notification-related job types (NOTIFICATION_DELIVER, NOTIFICATION_RECONCILE,
 * NOTIFICATION_CLEANUP) and EVALUATE_BUDGETS are intentionally absent: the
 * notification feature is disabled, not deleted, and its queues are simply
 * never drained (see the Vercel migration plan for details).
 */
export const survivingJobHandlers: JobHandlers = {
  [JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]: async (payload, context) => {
    await materializeRecurringExpense(payload, context.boss)
  },
  [JOB_NAMES.RECONCILE_RECURRING_EXPENSES]: async (payload, context) => {
    await reconcileDueRecurringExpenses(context.boss, payload)
  },
  [JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP]: async () => {
    await runAnonymousAccountCleanup()
  },
}

const IMMEDIATE_DRAIN_TIME_BUDGET_MS = 8_000

/**
 * Fire-and-forget drain of `name`, run after enqueueing an on-demand job so
 * it's processed within the same request instead of waiting for the next Vercel
 * Cron tick. Uses `waitUntil` to extend the invocation's lifetime without
 * blocking the response; outside a Vercel request context (local dev, tests)
 * `waitUntil` is a no-op and the drain still runs, just untracked by the
 * platform.
 */
export function triggerImmediateDrain<Name extends JobName>(
  boss: SpliitBoss,
  name: Name,
): void {
  const handler = survivingJobHandlers[name]
  if (!handler) return
  waitUntil(
    drainQueueOnce(boss, name, handler, {
      timeBudgetMs: IMMEDIATE_DRAIN_TIME_BUDGET_MS,
    }).catch((error) => {
      logServerWarn('jobs.immediate-drain', error, { queue: name })
    }),
  )
}
