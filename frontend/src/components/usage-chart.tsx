import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { compact, dayLabel, usd } from "@/lib/format"

export type Metric = "cost_micros" | "requests" | "tokens" | "input_tokens" | "output_tokens"

export const METRIC_LABEL: Record<Metric, string> = {
  cost_micros: "Cost",
  requests: "Requests",
  tokens: "Tokens",
  input_tokens: "Input tokens",
  output_tokens: "Output tokens",
}

export function formatMetric(metric: Metric, value: number): string {
  return metric === "cost_micros" ? usd(value) : compact(value)
}

interface Series {
  key: string
  label: string
}

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"]

/** Daily values for one or more series (stacked when there are several). */
export function DailyChart({
  data,
  series,
  metric,
  kind = "area",
  height = 260,
}: {
  data: Record<string, number | string>[]
  series: Series[]
  metric: Metric
  kind?: "area" | "bar"
  height?: number
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: COLORS[i % COLORS.length] }]),
  )
  const axis = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(v: string) => dayLabel(v)} />
      <YAxis tickLine={false} axisLine={false} width={metric === "cost_micros" ? 84 : 56} tickFormatter={(v: number) => formatMetric(metric, v)} />
      <ChartTooltip
        content={
          <ChartTooltipContent
            labelFormatter={(v) => dayLabel(String(v))}
            formatter={(value, name) => (
              <div className="flex w-full items-center justify-between gap-4">
                <span className="text-muted-foreground">{config[String(name)]?.label ?? String(name)}</span>
                <span className="tabular font-medium">{formatMetric(metric, Number(value))}</span>
              </div>
            )}
          />
        }
      />
      {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
    </>
  )
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      {kind === "bar" ? (
        <BarChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
          {axis}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} stackId="a" fill={`var(--color-${s.key})`} radius={series.length > 1 ? 0 : [4, 4, 0, 0]} />
          ))}
        </BarChart>
      ) : (
        <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={`var(--color-${s.key})`} stopOpacity={0.35} />
                <stop offset="95%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          {axis}
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stackId={series.length > 1 ? "a" : undefined}
              stroke={`var(--color-${s.key})`}
              fill={`url(#fill-${s.key})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      )}
    </ChartContainer>
  )
}
