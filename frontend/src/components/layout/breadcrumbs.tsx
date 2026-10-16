import { Fragment, createContext, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { Link } from "react-router"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export interface Crumb {
  label: string
  to?: string
}

interface BreadcrumbState {
  crumbs: Crumb[]
  setCrumbs: (crumbs: Crumb[]) => void
}

const BreadcrumbContext = createContext<BreadcrumbState | null>(null)

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs])
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>
}

/** Declare the breadcrumb trail for the current page. */
export function useBreadcrumbs(crumbs: Crumb[]): void {
  // Depend on the stable setter only; the context value changes whenever crumbs change.
  const setCrumbs = useContext(BreadcrumbContext)?.setCrumbs
  const key = JSON.stringify(crumbs)
  useEffect(() => {
    setCrumbs?.(JSON.parse(key) as Crumb[])
  }, [setCrumbs, key])
}

export function TopbarBreadcrumbs() {
  const ctx = useContext(BreadcrumbContext)
  const crumbs = ctx?.crumbs ?? []
  if (crumbs.length === 0) return null
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              <BreadcrumbItem className={last ? "min-w-0" : "hidden min-w-0 md:inline-flex"}>
                {last || !crumb.to ? (
                  <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className="truncate">
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last ? <BreadcrumbSeparator className="hidden md:list-item" /> : null}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
