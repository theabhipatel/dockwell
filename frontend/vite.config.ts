import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'

// Where the FastAPI backend listens in development (see .env.example).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:31100'

/**
 * Content Security Policy for the built app (also set by deploy/nginx.conf).
 * Scripts: our own origin only; no inline scripts, no eval.
 * Styles allow inline because Radix/react-remove-scroll inject small <style> elements.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

/**
 * Adds Subresource Integrity (sha384) to every script, stylesheet and module preload referenced
 * by the built HTML pages. Hashes are computed from the final files on disk, after every other plugin.
 */
function subresourceIntegrity(): Plugin {
  return {
    name: 'dockwell-subresource-integrity',
    apply: 'build',
    enforce: 'post',
    writeBundle(options) {
      const outDir = options.dir ?? 'dist'
      for (const page of ['index.html', 'site.html']) {
        const pagePath = path.join(outDir, page)
        if (!fs.existsSync(pagePath)) continue
        const html = fs.readFileSync(pagePath, 'utf8').replace(
          /<(script|link)\b[^>]*?\b(?:src|href)="([^"]+)"[^>]*>/g,
          (tag: string, element: string, url: string) => {
            if (element === 'link' && !/rel="(stylesheet|modulepreload)"/.test(tag)) return tag
            if (/\bintegrity=/.test(tag) || /^https?:/.test(url)) return tag
            const file = path.join(outDir, url.replace(/^\//, ''))
            if (!fs.existsSync(file)) return tag
            const digest = createHash('sha384').update(fs.readFileSync(file)).digest('base64')
            const withCors = /\bcrossorigin\b/.test(tag) ? tag : tag.replace(/>$/, ' crossorigin>')
            return withCors.replace(/>$/, ` integrity="sha384-${digest}">`)
          },
        )
        fs.writeFileSync(pagePath, html)
      }
    },
  }
}

/**
 * Link previews for app pages (/login, /signup, invite links...). They stay noindex, but a shared link
 * should still show the title and image. Open Graph needs absolute URLs, so this needs VITE_SITE_URL.
 */
function appShellSocialTags(siteUrl: string): Plugin {
  const title = 'DockWell by TheAbhiPatel'
  const description = "Serve open source AI models behind an OpenAI-compatible API. Open source and self-hosted, by TheAbhiPatel."
  const image = `${siteUrl}/og-image.png?v=2`
  const tags = [
    `<meta property="og:site_name" content="DockWell" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:creator" content="@itheabhipatel" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('\n    ')
  return {
    name: 'dockwell-app-shell-social-tags',
    transformIndexHtml: (html) => html.replace('<!--app-social-->', siteUrl ? tags : ''),
  }
}

/** Public site pages (landing, docs, privacy). Everything else is the app. */
const SITE_PAGES = new Set(['/', '/docs', '/pricing', '/models', '/privacy', '/terms'])
const isSitePath = (pathname: string) => SITE_PAGES.has(pathname) || pathname.startsWith('/docs/')

/**
 * Serves the public site from site.html and the app from index.html. In production the site is
 * pre-rendered to static files (scripts/prerender.mjs) and the app shell is renamed to app.html;
 * `vite preview` mirrors that layout.
 */
function sitePages(): Plugin {
  return {
    name: 'dockwell-site-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]
        if (isSitePath(pathname.replace(/\/+$/, '') || '/')) req.url = '/site.html'
        next()
      })
    },
    configurePreviewServer(server) {
      const dist = path.resolve(import.meta.dirname, 'dist')
      server.middlewares.use((req, _res, next) => {
        const [pathname, query = ''] = (req.url ?? '/').split('?')
        if (pathname.startsWith('/api/') || pathname.startsWith('/v1/') || path.extname(pathname)) return next()
        const clean = pathname.replace(/\/+$/, '')
        const page = clean === '' ? 'index.html' : `${clean.slice(1)}/index.html`
        const target = fs.existsSync(path.join(dist, page)) ? `/${page}` : '/app.html'
        req.url = query ? `${target}?${query}` : target
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild, mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    sitePages(),
    appShellSocialTags(String(loadEnv(mode, import.meta.dirname, 'VITE_').VITE_SITE_URL ?? '').replace(/\/+$/, '')),
    subresourceIntegrity(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    // Never inline assets as data: URIs; the CSP only allows files from our own origin.
    assetsInlineLimit: 0,
    rollupOptions: isSsrBuild
      ? {}
      : {
          // Two pages: the app (index.html) and the pre-rendered public site (site.html).
          input: {
            app: path.resolve(import.meta.dirname, 'index.html'),
            site: path.resolve(import.meta.dirname, 'site.html'),
          },
          output: {
            manualChunks: (id: string) => (id.includes('recharts') || id.includes('d3-') ? 'charts' : undefined),
          },
        },
  },
  server: {
    port: 31180,
    strictPort: true,
    // The API is served from the same origin in every environment, so cookies stay
    // first-party and no CORS is needed. (No CSP in dev: Vite's HMR needs inline scripts.)
    proxy: {
      '/api': { target: apiTarget, xfwd: true },
      '/v1': { target: apiTarget, xfwd: true },
    },
  },
  preview: {
    port: 31180,
    headers: SECURITY_HEADERS,
    proxy: {
      '/api': { target: apiTarget, xfwd: true },
      '/v1': { target: apiTarget, xfwd: true },
    },
  },
}))
