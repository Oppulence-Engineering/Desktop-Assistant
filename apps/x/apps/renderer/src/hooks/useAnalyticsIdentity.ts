import { useEffect } from 'react'
import posthog from 'posthog-js'
import { identifyUser, resetAnalyticsIdentity } from '@/lib/analytics'

const MAX_NOTE_COUNT_DIRECTORY_READS = 50

function requestIdleTask(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const idleWindow = window as Window & typeof globalThis & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const id = idleWindow.requestIdleCallback(callback, { timeout: 5_000 })
    return () => idleWindow.cancelIdleCallback?.(id)
  }
  const id = globalThis.setTimeout(callback, 1_500)
  return () => globalThis.clearTimeout(id)
}

/**
 * Identifies the user in PostHog when signed into Rowboat,
 * and sets user properties for connected OAuth providers.
 * Call once at the App level.
 */
export function useAnalyticsIdentity() {
  // On mount: check current OAuth state and identify if signed in
  useEffect(() => {
    async function init() {
      try {
        const result = await window.ipc.invoke('oauth:getState', null)
        const config = result.config || {}

        // Identify if Rowboat account is connected
        const rowboat = config.rowboat
        if (rowboat?.connected && rowboat?.userId) {
          identifyUser(rowboat.userId)
        }

        // Set provider connection flags
        const providers = ['gmail', 'calendar', 'slack', 'rowboat']
        const props: Record<string, boolean> = { signed_in: !!rowboat?.connected }
        for (const p of providers) {
          props[`${p}_connected`] = !!config[p]?.connected
        }
        posthog.people.set(props)

      } catch {
        // oauth state unavailable
      }
    }
    init()
  }, [])

  useEffect(() => {
    let cancelled = false
    const cancelIdleTask = requestIdleTask(() => {
      async function countNotes() {
        try {
          const entries = await window.ipc.invoke('workspace:readdir', { path: '' })
          if (cancelled || !entries) return

          let totalNotes = 0
          let directoriesRead = 0
          for (const entry of entries) {
            if (entry.kind !== 'dir') continue
            if (directoriesRead >= MAX_NOTE_COUNT_DIRECTORY_READS) break
            directoriesRead += 1
            try {
              const sub = await window.ipc.invoke('workspace:readdir', { path: `${entry.name}` })
              if (cancelled) return
              totalNotes += sub?.filter((item) => item.kind === 'file').length ?? 0
            } catch {
              // skip inaccessible dirs
            }
          }

          if (!cancelled) {
            posthog.people.set({ total_notes: totalNotes })
          }
        } catch {
          // workspace may not be available
        }
      }

      void countNotes()
    })

    return () => {
      cancelled = true
      cancelIdleTask()
    }
  }, [])

  // Listen for OAuth connect/disconnect events to update identity
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider !== 'rowboat') {
        // Other providers: just toggle the connection flag
        if (event.success) {
          posthog.people.set({ [`${event.provider}_connected`]: true })
        }
        return
      }

      // Rowboat sign-in
      if (event.success) {
        if (event.userId) {
          identifyUser(event.userId)
        }
        posthog.people.set({ signed_in: true, rowboat_connected: true })
        posthog.capture('user_signed_in')
        return
      }

      // Rowboat sign-out — flip flags, capture, and reset distinct_id so
      // future events on this device don't get attributed to the prior user.
      posthog.people.set({ signed_in: false, rowboat_connected: false })
      posthog.capture('user_signed_out')
      resetAnalyticsIdentity()
    })

    return cleanup
  }, [])
}
