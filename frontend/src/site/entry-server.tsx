import { StrictMode } from "react"
import { renderToString } from "react-dom/server"
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from "react-router"

import { siteRoutes } from "./routes"
import { PRERENDER_PATHS, pageMeta, renderHead, robotsTxt, sitemapXml, structuredData } from "./seo"

export { PRERENDER_PATHS, robotsTxt, sitemapXml }

/** Renders one public page to static HTML (used by scripts/prerender.mjs at build time). */
export async function render(url: string) {
  const handler = createStaticHandler(siteRoutes)
  const context = await handler.query(new Request(`http://localhost${url}`))
  if (context instanceof Response) throw new Error(`Unexpected redirect while rendering ${url}`)
  const router = createStaticRouter(handler.dataRoutes, context)
  const html = renderToString(
    <StrictMode>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </StrictMode>,
  )
  const meta = pageMeta(url)
  return {
    html,
    head: renderHead(meta),
    jsonLd: structuredData(meta),
    data: JSON.stringify({ loaderData: context.loaderData }).replace(/</g, "\\u003c"),
    status: context.statusCode,
  }
}
