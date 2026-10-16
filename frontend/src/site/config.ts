/** Public site settings. All are build-time values, so the pre-rendered HTML and the browser agree. */

export const SITE_NAME = "DockWell"
export const GITHUB_URL = "https://github.com/theabhipatel/dockwell"
export const GITHUB_DOCS_EDIT_URL = `${GITHUB_URL}/edit/master/frontend/src/site/docs/content`

/** The author, credited in the meta tags and structured data of every public page. */
export const AUTHOR = {
  name: "TheAbhiPatel",
  fullName: "Abhishek Patel",
  alternateNames: ["Abhishek Patel", "Abhi Patel", "The Abhi Patel", "theabhipatel"],
  jobTitle: "Full Stack Developer & DevOps Engineer",
  url: "https://www.theabhipatel.com/",
  github: "https://github.com/theabhipatel",
  linkedin: "https://www.linkedin.com/in/theabhipatel",
  x: "https://x.com/itheabhipatel",
  xHandle: "@itheabhipatel",
  leetcode: "https://leetcode.com/u/theabhipatel",
} as const

/** Google Search Console HTML-tag verification token (the content="..." value), if any. */
export const GOOGLE_SITE_VERIFICATION = String(import.meta.env.VITE_GOOGLE_SITE_VERIFICATION ?? "").trim()

/** Absolute public origin (e.g. https://dockwell.example.com). Used for canonical and Open Graph URLs. */
export const SITE_URL = String(import.meta.env.VITE_SITE_URL ?? "").replace(/\/+$/, "")

/** The public demo deployment shows "try it, then self-host" notices. */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true"

/** Where the app lives (a full page load: the app is a separate bundle). */
export const APP_URL = "/app"
export const SIGNUP_URL = "/signup"
export const LOGIN_URL = "/login"
