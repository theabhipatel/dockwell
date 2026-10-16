const KEY = "dockwell-last-workspace"

export function getLastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastWorkspace(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Not critical: we fall back to the default workspace.
  }
}
