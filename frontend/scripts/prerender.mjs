// Pre-renders the public site (landing page, docs, privacy) to static HTML after `vite build`.
//   dist/index.html            the landing page (was the app shell, which moves to dist/app.html)
//   dist/docs/<slug>/index.html one file per docs page
//   dist/sitemap.xml, dist/robots.txt
// Servers send "/" and the site paths to these files, and every other path to app.html.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist")
const serverEntry = path.join(root, "dist-ssr", "entry-server.js")

const { render, PRERENDER_PATHS, sitemapXml, robotsTxt } = await import(pathToFileURL(serverEntry).href)

const template = fs.readFileSync(path.join(dist, "site.html"), "utf8")
if (!template.includes("<!--site-head-->") || !template.includes("<!--site-html-->")) {
  throw new Error("site.html is missing the <!--site-head--> / <!--site-html--> placeholders")
}

// The app shell keeps working for every non-site path.
fs.renameSync(path.join(dist, "index.html"), path.join(dist, "app.html"))

for (const url of PRERENDER_PATHS) {
  const page = await render(url)
  const head = `${page.head}\n    <script type="application/ld+json">${page.jsonLd}</script>`
  const html = template
    .replace("<!--site-head-->", () => head)
    .replace("<!--site-html-->", () => page.html)
    .replace("</body>", () => `  <script type="application/json" id="__site-data">${page.data}</script>\n  </body>`)
  const file = url === "/" ? path.join(dist, "index.html") : path.join(dist, url.slice(1), "index.html")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, html)
  console.log(`  prerendered ${url.padEnd(34)} ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`)
}

fs.rmSync(path.join(dist, "site.html"))
fs.writeFileSync(path.join(dist, "robots.txt"), robotsTxt())
const sitemap = sitemapXml()
if (sitemap) fs.writeFileSync(path.join(dist, "sitemap.xml"), sitemap)
else console.log("  (set VITE_SITE_URL to also generate sitemap.xml and canonical URLs)")
fs.rmSync(path.join(root, "dist-ssr"), { recursive: true, force: true })
