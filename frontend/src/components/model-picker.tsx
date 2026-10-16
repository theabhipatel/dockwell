import { useState } from "react"
import { Check, ChevronsUpDown, Cpu } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { contextLength, perMillion } from "@/lib/format"
import type { CatalogModel } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ModelPrice({ model, className }: { model: CatalogModel; className?: string }) {
  if (model.price.is_free) return <span className={cn("text-success text-xs", className)}>Free</span>
  return (
    <span className={cn("text-muted-foreground tabular text-xs", className)}>
      {perMillion(model.price.input_micros_per_m)} in / {perMillion(model.price.output_micros_per_m)} out per 1M
    </span>
  )
}

export function ModelStatusBadge({ status }: { status: CatalogModel["status"] }) {
  if (status === "ready") return null
  const variant = status === "failed" ? "destructive" : status === "stopped" ? "secondary" : "warning"
  return <Badge variant={variant}>{status}</Badge>
}

function ModelRow({ model }: { model: CatalogModel }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{model.name}</span>
        <ModelStatusBadge status={model.status} />
        {model.deprecated ? <Badge variant="warning">deprecated</Badge> : null}
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
        <code>{model.id}</code>
        <span>{contextLength(model.context_length)} context</span>
      </div>
      <ModelPrice model={model} />
    </div>
  )
}

interface ModelPickerProps {
  models: CatalogModel[]
  value: string
  onChange: (id: string) => void
  className?: string
  compact?: boolean
}

/** Model chooser showing each model's price and context length. */
export function ModelPicker({ models, value, onChange, className, compact = false }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const current = models.find((m) => m.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Choose a model"
          className={cn("max-w-full justify-between gap-2 font-normal", className)}
        >
          <Cpu className="text-muted-foreground" />
          <span className="truncate">{current ? current.name : models.length ? "Choose a model" : "No models available"}</span>
          {current && !compact ? <ModelPrice model={current} className="hidden md:inline" /> : null}
          <ChevronsUpDown className="text-muted-foreground ml-auto" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(26rem,calc(100vw-1.5rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList className="max-h-80">
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              {models.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.id}`}
                  disabled={m.status !== "ready"}
                  onSelect={() => {
                    onChange(m.id)
                    setOpen(false)
                  }}
                  className="items-start gap-2 py-2"
                >
                  <ModelRow model={m} />
                  <Check className={cn("mt-1", m.id === value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Choose any number of models (empty = all models), e.g. for an API key's allow list. */
export function ModelMultiSelect({
  models,
  value,
  onChange,
}: {
  models: CatalogModel[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate">
            {value.length === 0 ? "All models" : value.length === 1 ? value[0] : `${value.length} models`}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList className="max-h-72">
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onChange([])}>
                <Check className={cn(value.length === 0 ? "opacity-100" : "opacity-0")} /> All models
              </CommandItem>
              {models.map((m) => (
                <CommandItem key={m.id} value={`${m.name} ${m.id}`} onSelect={() => toggle(m.id)}>
                  <Check className={cn(value.includes(m.id) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{m.name}</span>
                  <code className="text-muted-foreground ml-auto truncate text-xs">{m.id}</code>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
