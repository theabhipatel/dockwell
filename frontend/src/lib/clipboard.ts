const CLEAR_AFTER_MS = 30_000
let clearTimer: number | undefined

/**
 * Copy text to the clipboard. For secrets, the clipboard is cleared after 30 seconds if it
 * still holds what we copied (browsers only allow reading it back while the page is focused).
 */
export async function copyText(text: string, { secret = false } = {}): Promise<void> {
  await navigator.clipboard.writeText(text)
  if (!secret) return
  window.clearTimeout(clearTimer)
  clearTimer = window.setTimeout(() => {
    void (async () => {
      try {
        const current = await navigator.clipboard.readText()
        if (current === text) await navigator.clipboard.writeText("")
      } catch {
        // Reading is not permitted (unfocused tab or denied permission): clear unconditionally.
        try {
          await navigator.clipboard.writeText("")
        } catch {
          // The browser does not allow clearing right now; nothing more we can do.
        }
      }
    })()
  }, CLEAR_AFTER_MS)
}
