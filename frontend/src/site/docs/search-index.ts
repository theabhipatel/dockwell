/** Search entries for every docs page and section. Loaded only when the search opens. */
import { ALL_DOCS, extractHeadings } from "./catalog"

export interface SearchEntry {
  id: string
  title: string
  section: string
  page: string
  href: string
  kind: "page" | "heading"
  keywords: string
}

const sources = import.meta.glob<string>("./content/*.md", { query: "?raw", import: "default", eager: true })

export const SEARCH_INDEX: SearchEntry[] = ALL_DOCS.flatMap((doc) => {
  const source = sources[`./content/${doc.slug}.md`] ?? ""
  const page: SearchEntry = {
    id: doc.slug,
    title: doc.title,
    section: doc.section,
    page: doc.title,
    href: `/docs/${doc.slug}`,
    kind: "page",
    keywords: doc.description,
  }
  const headings = extractHeadings(source).map<SearchEntry>((h) => ({
    id: `${doc.slug}#${h.id}`,
    title: h.text,
    section: doc.section,
    page: doc.title,
    href: `/docs/${doc.slug}#${h.id}`,
    kind: "heading",
    keywords: doc.title,
  }))
  return [page, ...headings]
})
