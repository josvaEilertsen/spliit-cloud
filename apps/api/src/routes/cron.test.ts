import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JOB_NAMES } from '@spliit/jobs'

import '../test/mocks'
import {
  runAnonymousCleanupDrain,
  runMaterializeDrain,
  runReconcileDrain,
} from './cron'

vi.mock('../lib/api/boss', () => ({
  getApiBossForWrite: vi.fn(async () => ({})),
}))

const { drainQueueOnceMock, sendJobMock, enqueueReconciliationMock } =
  vi.hoisted(() => ({
    drainQueueOnceMock: vi.fn(async () => ({
      queue: 'recurring-expense.materialize',
      fetched: 0,
      completed: 0,
      failed: 0,
    })),
    sendJobMock: vi.fn(async () => 'job-id'),
    enqueueReconciliationMock: vi.fn(async () => 'job-id'),
  }))

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    drainQueueOnce: drainQueueOnceMock,
    sendJob: sendJobMock,
    enqueueReconciliation: enqueueReconciliationMock,
  }
})

function routeApp() {
  const app = new Hono()
  app.get('/api/cron/materialize', runMaterializeDrain)
  app.get('/api/cron/reconcile', runReconcileDrain)
  app.get('/api/cron/anonymous-cleanup', runAnonymousCleanupDrain)
  return app
}

const AUTH_HEADER = { authorization: 'Bearer spliit-test-cron-secret' }

describe('cron routes', () => {
  beforeEach(() => {
    drainQueueOnceMock.mockClear()
    sendJobMock.mockClear()
    enqueueReconciliationMock.mockClear()
  })

  it('rejects a request with no authorization header', async () => {
    const response = await routeApp().request('/api/cron/materialize')

    expect(response.status).toBe(401)
    expect(drainQueueOnceMock).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong bearer token', async () => {
    const response = await routeApp().request('/api/cron/materialize', {
      headers: { authorization: 'Bearer wrong' },
    })

    expect(response.status).toBe(401)
    expect(drainQueueOnceMock).not.toHaveBeenCalled()
  })

  it('drains the materialize queue when authorized', async () => {
    const response = await routeApp().request('/api/cron/materialize', {
      headers: AUTH_HEADER,
    })

    expect(response.status).toBe(200)
    expect(drainQueueOnceMock).toHaveBeenCalledWith(
      expect.anything(),
      JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
      expect.any(Function),
      expect.objectContaining({ timeBudgetMs: expect.any(Number) }),
    )
  })

  it('seeds a reconcile pass before draining the reconcile queue', async () => {
    const response = await routeApp().request('/api/cron/reconcile', {
      headers: AUTH_HEADER,
    })

    expect(response.status).toBe(200)
    expect(enqueueReconciliationMock).toHaveBeenCalledTimes(1)
    expect(drainQueueOnceMock).toHaveBeenCalledWith(
      expect.anything(),
      JOB_NAMES.RECONCILE_RECURRING_EXPENSES,
      expect.any(Function),
      expect.anything(),
    )
  })

  it('seeds an anonymous-cleanup job before draining that queue', async () => {
    const response = await routeApp().request('/api/cron/anonymous-cleanup', {
      headers: AUTH_HEADER,
    })

    expect(response.status).toBe(200)
    expect(sendJobMock).toHaveBeenCalledWith(
      expect.anything(),
      JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP,
      {},
      expect.objectContaining({ singletonKey: 'anonymous-account-cleanup' }),
    )
    expect(drainQueueOnceMock).toHaveBeenCalledWith(
      expect.anything(),
      JOB_NAMES.ANONYMOUS_ACCOUNT_CLEANUP,
      expect.any(Function),
      expect.anything(),
    )
  })
})
