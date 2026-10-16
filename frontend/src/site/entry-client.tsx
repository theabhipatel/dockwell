import { StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { RouterProvider, createBrowserRouter, matchRoutes } from "react-router"
import type { HydrationState } from "react-router"

import { siteRoutes } from "./routes"

import "./site.css"

async function start() {
  const root = document.getElementById("root")
  if (!root) throw new Error("Missing #root element")
  // Loader data from the pre-rendered page (a JSON data block: the CSP forbids inline scripts).
  const dataBlock = document.getElementById("__site-data")
  const hydrationData = dataBlock ? (JSON.parse(dataBlock.textContent || "{}") as HydrationState) : undefined

  // Resolve the lazy route modules for this URL first, so hydration renders the same markup.
  const matches = matchRoutes(siteRoutes, window.location) ?? []
  await Promise.all(
    matches.map(async ({ route }) => {
      if (typeof route.lazy !== "function") return
      const module = await route.lazy()
      Object.assign(route, { ...module, lazy: undefined })
    }),
  )

  const router = createBrowserRouter(siteRoutes, { hydrationData })
  const app = (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
  if (dataBlock) hydrateRoot(root, app)
  else createRoot(root).render(app)
}

void start()
