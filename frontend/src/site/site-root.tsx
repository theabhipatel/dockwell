import { createContext, useContext, useEffect, useState } from "react"
import { Outlet, useLocation } from "react-router"

import { SITE_URL } from "./config"
import { pageKeywords, pageMeta } from "./seo"

/** Whether a session cookie is present (checked in the browser only, after the page is shown). */
const SignedInContext = createContext(false)

export function useSignedIn(): boolean {
  return useContext(SignedInContext)
}

function setMeta(selector: string, attribute: string, value: string) {
  const el = document.head.querySelector(selector)
  if (el) el.setAttribute(attribute, value)
}

export function SiteRoot() {
  const location = useLocation()
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then(async (res) => (res.ok ? ((await res.json()) as { signed_in?: boolean }) : null))
      .then((status) => !cancelled && setSignedIn(status?.signed_in === true))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the title and meta tags right during in-site navigation.
  useEffect(() => {
    const meta = pageMeta(location.pathname)
    document.title = meta.title
    setMeta('meta[name="description"]', "content", meta.description)
    setMeta('meta[property="og:title"]', "content", meta.title)
    setMeta('meta[property="og:description"]', "content", meta.description)
    setMeta('meta[name="twitter:title"]', "content", meta.title)
    setMeta('meta[name="twitter:description"]', "content", meta.description)
    setMeta('meta[name="keywords"]', "content", pageKeywords(meta))
    if (SITE_URL) {
      const url = `${SITE_URL}${meta.path === "/" ? "/" : meta.path}`
      setMeta('link[rel="canonical"]', "href", url)
      setMeta('meta[property="og:url"]', "content", url)
    }
  }, [location.pathname])

  // New page: start at the top, or at the linked heading.
  useEffect(() => {
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
      if (target) {
        target.scrollIntoView()
        return
      }
    }
    window.scrollTo(0, 0)
  }, [location.pathname, location.hash])

  return (
    <SignedInContext.Provider value={signedIn}>
      <Outlet />
    </SignedInContext.Provider>
  )
}
