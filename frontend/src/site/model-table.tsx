import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { ctx, money } from "./live-data"
import type { PublicModel } from "./live-data"

export function ModelPriceTable({ models, error, detailed = false }: { models: PublicModel[] | null; error: boolean; detailed?: boolean }) {
  if (error) {
    return <p className="text-muted-foreground rounded-xl border p-6 text-sm">The live price list could not be loaded right now. Sign in to see the models available to your workspace.</p>
  }
  if (!models) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    )
  }
  if (models.length === 0) {
    return <p className="text-muted-foreground rounded-xl border p-6 text-sm">No models are published yet. The operator adds them from the admin area.</p>
  }
  return (
    <div className="bg-card overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Model</TableHead>
            <TableHead>Context</TableHead>
            {detailed ? <TableHead className="hidden md:table-cell">Capabilities</TableHead> : null}
            <TableHead className="text-right">Input / 1M tokens</TableHead>
            <TableHead className="pr-4 text-right">Output / 1M tokens</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="pl-4">
                <p className="font-medium">
                  {m.name}
                  {m.deprecated ? <Badge variant="warning" className="ml-2">Deprecated</Badge> : null}
                  {m.status !== "ready" ? <Badge variant="secondary" className="ml-2">{m.status}</Badge> : null}
                </p>
                <code className="text-muted-foreground text-xs">{m.id}</code>
                {detailed && m.description ? <p className="text-muted-foreground mt-1 max-w-md text-xs">{m.description}</p> : null}
              </TableCell>
              <TableCell className="tabular">{ctx(m.context_length)}</TableCell>
              {detailed ? (
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">{m.capabilities.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}</div>
                </TableCell>
              ) : null}
              <TableCell className="tabular text-right">{m.price.is_free ? "Free" : money(m.price.input_micros_per_m)}</TableCell>
              <TableCell className="tabular pr-4 text-right">{m.price.is_free ? "Free" : money(m.price.output_micros_per_m)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
