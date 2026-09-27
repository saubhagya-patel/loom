import { useCallback, useSyncExternalStore } from 'react'
import type { Queue, QueueItem, QueueSummary } from './queue.ts'

// Three separate subscriptions on purpose. A single hook returning the whole queue would make
// every row and the header re-render on every chunk of every file — the failure
// docs/process.md §3 predicted when it put a React skill on a phase with no UI in it.

export function useQueueIds(queue: Queue): string[] {
  return useSyncExternalStore(
    useCallback((fn: () => void) => queue.subscribeIds(fn), [queue]),
    useCallback(() => queue.ids(), [queue]),
  )
}

// Subscribes to one file. A chunk landing on file 7 re-renders row 7 and nothing else.
export function useQueueItem(queue: Queue, id: string): QueueItem | undefined {
  return useSyncExternalStore(
    useCallback((fn: () => void) => queue.subscribe(id, fn), [queue, id]),
    useCallback(() => queue.snapshot(id), [queue, id]),
  )
}

// Counts and booleans only, recomputed on state changes and never on progress.
export function useQueueSummary(queue: Queue): QueueSummary {
  return useSyncExternalStore(
    useCallback((fn: () => void) => queue.subscribeSummary(fn), [queue]),
    useCallback(() => queue.summary(), [queue]),
  )
}
