/** Per-page titles and meta tags, rendered into the pre-built HTML and kept in sync in the browser. */
import { ALL_DOCS, findDoc } from "./docs/catalog"
import { AUTHOR, GITHUB_URL, GOOGLE_SITE_VERIFICATION, SITE_NAME, SITE_URL } from "./config"

export interface PageMeta {
  title: string
  description: string
  path: string
  type: "website" | "article"
  /** Page-specific search keywords, added to the site-wide ones. */
  keywords?: string[]
  /** Docs pages: the docs section, for breadcrumbs and article:section. */
  section?: string
}

/** "DockWell by TheAbhiPatel": the name people search for, used in titles and descriptions. */
const BRANDED_NAME = `${SITE_NAME} by ${AUTHOR.name}`

const HOME_DESCRIPTION = `${BRANDED_NAME} (${AUTHOR.fullName}) is an open source, self-hosted platform for serving open source AI models behind an OpenAI-compatible API, with accounts, API keys, usage tracking, pay-as-you-go billing, logs and monitoring built in.`

/** Keywords on every public page, including the author's name. */
const SITE_KEYWORDS = [
  SITE_NAME,
  BRANDED_NAME,
  "DockWell TheAbhiPatel",
  "TheAbhiPatel",
  "theabhipatel",
  "Abhi Patel",
  "Abhishek Patel",
  "OpenAI-compatible API",
  "self-hosted LLM",
  "open source AI models",
  "vLLM",
  "llama.cpp",
  "LLM gateway",
  "AI API platform",
  "LLM billing",
  "GPU server",
]

const OG_IMAGE_ALT = `${BRANDED_NAME}: open source models behind an OpenAI-compatible API`
/** Bump when og-image.png changes, so social networks fetch the new image instead of a cached one. */
const OG_IMAGE_PATH = "/og-image.png?v=2"

export function pageMeta(pathname: string): PageMeta {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path === "/") {
    return {
      title: `${BRANDED_NAME} | Self-hosted OpenAI-compatible API for open source models`,
      description: HOME_DESCRIPTION,
      path,
      type: "website",
      keywords: ["serve open source LLM", "OpenAI API alternative", "self-hosted AI platform"],
    }
  }
  if (path === "/pricing") {
    return {
      title: `Pricing | ${SITE_NAME}`,
      description: "Pay-as-you-go pricing per million tokens, free starter credit, and how credits, reservations and exact charging work on DockWell.",
      path,
      type: "website",
      keywords: ["LLM pricing", "price per million tokens", "pay as you go AI"],
    }
  }
  if (path === "/models") {
    return {
      title: `Models | ${SITE_NAME}`,
      description: "The catalogue of open source AI models available on DockWell, with context length, capabilities and price per million tokens.",
      path,
      type: "website",
      keywords: ["open source models", "Llama", "Qwen", "model catalogue"],
    }
  }
  if (path === "/docs") {
    return {
      title: `Documentation | ${BRANDED_NAME}`,
      description: `${BRANDED_NAME} documentation: call the OpenAI-compatible API, manage workspaces and billing, and self-host on a GPU server.`,
      path,
      type: "website",
      keywords: ["DockWell docs", "documentation", "self-hosting guide"],
    }
  }
  if (path.startsWith("/docs/")) {
    const doc = findDoc(path.slice("/docs/".length))
    if (doc) {
      return {
        title: `${doc.title} | ${SITE_NAME} docs`,
        description: doc.description,
        path,
        type: "article",
        keywords: [doc.title, doc.section, "DockWell docs"],
        section: doc.section,
      }
    }
  }
  if (path === "/privacy") {
    return { title: `Privacy policy | ${SITE_NAME}`, description: "What DockWell stores, what it does not store, and how long it keeps it.", path, type: "website" }
  }
  if (path === "/terms") {
    return { title: `Terms of service | ${SITE_NAME}`, description: "The terms for using DockWell software and the installs that run it.", path, type: "website" }
  }
  return { title: `Page not found | ${SITE_NAME}`, description: HOME_DESCRIPTION, path, type: "website" }
}

/** Every page that is pre-rendered to static HTML at build time. */
export const PRERENDER_PATHS = ["/", "/pricing", "/models", "/docs", ...ALL_DOCS.map((d) => `/docs/${d.slug}`), "/privacy", "/terms"]

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The <head> tags for a page (static HTML; no inline scripts, which the CSP forbids). */
export function renderHead(meta: PageMeta): string {
  const url = SITE_URL ? `${SITE_URL}${meta.path === "/" ? "/" : meta.path}` : ""
  const image = SITE_URL ? `${SITE_URL}${OG_IMAGE_PATH}` : ""
  const robots = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="keywords" content="${escapeHtml(pageKeywords(meta))}" />`,
    // Authorship: TheAbhiPatel built DockWell.
    `<meta name="author" content="${AUTHOR.name}" />`,
    `<meta name="creator" content="${AUTHOR.name}" />`,
    `<meta name="publisher" content="${AUTHOR.name}" />`,
    `<link rel="author" href="${AUTHOR.url}" />`,
    `<meta name="application-name" content="${SITE_NAME}" />`,
    `<meta name="apple-mobile-web-app-title" content="${SITE_NAME}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<meta name="googlebot" content="${robots}" />`,
    `<meta name="theme-color" content="#0f0f12" />`,
    // Open Graph (Facebook, LinkedIn, Slack, WhatsApp, Discord, ...)
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    // X / Twitter
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="${AUTHOR.xHandle}" />`,
    `<meta name="twitter:creator" content="${AUTHOR.xHandle}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
  ]
  if (GOOGLE_SITE_VERIFICATION) {
    tags.push(`<meta name="google-site-verification" content="${escapeHtml(GOOGLE_SITE_VERIFICATION)}" />`)
  }
  if (meta.type === "article") {
    tags.push(`<meta property="article:author" content="${AUTHOR.url}" />`)
    if (meta.section) tags.push(`<meta property="article:section" content="${escapeHtml(meta.section)}" />`)
  }
  if (url) {
    tags.push(`<link rel="canonical" href="${url}" />`, `<meta property="og:url" content="${url}" />`)
  }
  if (image) {
    tags.push(
      `<meta property="og:image" content="${image}" />`,
      `<meta property="og:image:secure_url" content="${image}" />`,
      `<meta property="og:image:type" content="image/png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}" />`,
      `<meta name="twitter:image" content="${image}" />`,
      `<meta name="twitter:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}" />`,
    )
  }
  return tags.join("\n    ")
}

export function pageKeywords(meta: PageMeta): string {
  return [...new Set([...(meta.keywords ?? []), ...SITE_KEYWORDS])].join(", ")
}

const absolute = (path: string) => `${SITE_URL}${path}`

/** TheAbhiPatel, referenced as author, creator and publisher by every page's structured data. */
const PERSON = {
  "@type": "Person",
  "@id": absolute("/#author"),
  name: AUTHOR.name,
  alternateName: [...AUTHOR.alternateNames],
  givenName: "Abhishek",
  familyName: "Patel",
  jobTitle: AUTHOR.jobTitle,
  url: AUTHOR.url,
  sameAs: [AUTHOR.url, AUTHOR.github, AUTHOR.linkedin, AUTHOR.x, AUTHOR.leetcode],
}
const PERSON_REF = { "@id": PERSON["@id"] }

const WEBSITE = {
  "@type": "WebSite",
  "@id": absolute("/#website"),
  name: SITE_NAME,
  alternateName: [BRANDED_NAME, `${AUTHOR.name} DockWell`],
  url: absolute("/"),
  description: HOME_DESCRIPTION,
  inLanguage: "en",
  creator: PERSON_REF,
  publisher: PERSON_REF,
}

/** Structured data for search engines (a JSON data block, not an executable script). */
export function structuredData(meta: PageMeta): string {
  const graph: object[] = [PERSON, WEBSITE]
  if (meta.path === "/") {
    graph.push({
      "@type": "SoftwareApplication",
      "@id": absolute("/#software"),
      name: SITE_NAME,
      alternateName: BRANDED_NAME,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Linux, macOS, Windows (self-hosted)",
      description: meta.description,
      url: absolute("/"),
      ...(SITE_URL ? { image: absolute(OG_IMAGE_PATH), screenshot: absolute(OG_IMAGE_PATH) } : {}),
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: PERSON_REF,
      creator: PERSON_REF,
      publisher: PERSON_REF,
      sameAs: [GITHUB_URL],
      keywords: pageKeywords(meta),
    })
  } else {
    graph.push({
      "@type": meta.type === "article" ? "TechArticle" : "WebPage",
      headline: meta.title,
      name: meta.title,
      description: meta.description,
      url: absolute(meta.path),
      inLanguage: "en",
      isPartOf: { "@id": WEBSITE["@id"] },
      author: PERSON_REF,
      publisher: PERSON_REF,
      keywords: pageKeywords(meta),
      ...(meta.section ? { articleSection: meta.section } : {}),
    })
    if (meta.path.startsWith("/docs")) {
      const crumbs = [
        { name: SITE_NAME, path: "/" },
        { name: "Docs", path: "/docs" },
        ...(meta.path === "/docs" ? [] : [{ name: meta.title.split(" | ")[0], path: meta.path }]),
      ]
      graph.push({
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absolute(c.path) })),
      })
    }
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")
}

export function sitemapXml(): string | null {
  if (!SITE_URL) return null
  const urls = PRERENDER_PATHS.map((p) => `  <url><loc>${SITE_URL}${p === "/" ? "/" : p}</loc></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
}

export function robotsTxt(): string {
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /app",
    "Disallow: /w/",
    "Disallow: /settings",
    "Disallow: /admin",
    "Disallow: /v1/",
    "Disallow: /onboarding",
  ]
  if (SITE_URL) lines.push("", `Sitemap: ${SITE_URL}/sitemap.xml`)
  return lines.join("\n") + "\n"
}
