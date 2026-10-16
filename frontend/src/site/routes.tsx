import type { RouteObject } from "react-router"

import { SiteNotFound } from "./components/site-not-found"
import { SiteRoot } from "./site-root"

/**
 * Public site routes. Every page is code-split and pre-rendered to static HTML at build time
 * (see scripts/prerender.mjs), then hydrated in the browser.
 */
export const siteRoutes: RouteObject[] = [
  {
    element: <SiteRoot />,
    children: [
      { index: true, lazy: () => import("./landing/landing-page").then((m) => ({ Component: m.LandingPage })) },
      {
        path: "docs",
        lazy: () => import("./docs/docs-layout").then((m) => ({ Component: m.DocsLayout })),
        children: [
          { index: true, lazy: () => import("./docs/docs-home").then((m) => ({ Component: m.DocsHome })) },
          {
            path: ":slug",
            lazy: () => import("./docs/doc-page").then((m) => ({ Component: m.DocPage, loader: m.docLoader })),
          },
        ],
      },
      { path: "pricing", lazy: () => import("./pricing-page").then((m) => ({ Component: m.PricingPage })) },
      { path: "models", lazy: () => import("./models-page").then((m) => ({ Component: m.ModelsPage })) },
      { path: "privacy", lazy: () => import("./privacy-page").then((m) => ({ Component: m.PrivacyPage })) },
      { path: "terms", lazy: () => import("./terms-page").then((m) => ({ Component: m.TermsPage })) },
      { path: "*", Component: SiteNotFound },
    ],
  },
]
