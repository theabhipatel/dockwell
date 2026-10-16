import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUp,
  Code2,
  Copy,
  CreditCard,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
  User,
} from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { LogoMark } from "@/components/brand"
import { CodeSnippets } from "@/components/code-snippets"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { MarkdownView } from "@/components/markdown"
import { ModelPicker } from "@/components/model-picker"
import { EmptyState } from "@/components/states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { qk, useConversations, useProjects, useWorkspaceModels } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { copyText } from "@/lib/clipboard"
import { relativeTime, tokens, usd } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import { ChatError, streamChat } from "@/lib/stream"
import type { ConversationSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
  model?: string
  input_tokens?: number | null
  output_tokens?: number | null
  cost_micros?: number | null
  stopped?: boolean
}

interface Settings {
  system: string
  temperature: number
  max_tokens: number | null
  top_p: number
  frequency_penalty: number
  presence_penalty: number
  project_id: string | null
}

const DEFAULT_SETTINGS: Settings = {
  system: "You are a helpful assistant.",
  temperature: 0.7,
  max_tokens: null,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  project_id: null,
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        <span className="tabular text-muted-foreground text-xs">{value}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v ?? value)} />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  )
}

export function PlaygroundPage() {
  const { id, workspace, can } = useWorkspaceScope()
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Playground" }])
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const models = useWorkspaceModels(id)
  const projects = useProjects(id)
  const conversations = useConversations(id)

  const available = useMemo(() => (models.data ?? []).filter((m) => m.capabilities.includes("chat")), [models.data])
  const [model, setModel] = useState<string>("")
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<ChatError | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null)
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null)
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  // Default model: the one in the URL, else the first ready model.
  useEffect(() => {
    if (model || available.length === 0) return
    const wanted = params.get("model")
    const pick = available.find((m) => m.id === wanted && m.status === "ready") ?? available.find((m) => m.status === "ready") ?? available[0]
    if (pick) setModel(pick.id)
  }, [available, model, params])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  const current = available.find((m) => m.id === model)
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))

  const saveConversation = useCallback(
    async (next: Message[]) => {
      const title = next.find((m) => m.role === "user")?.content.slice(0, 60) || "New chat"
      const body = { model, settings: settings as unknown as Record<string, unknown>, messages: next as unknown as Record<string, unknown>[] }
      try {
        if (conversationId) {
          await unwrap(
            client.PATCH("/api/workspaces/{workspace_id}/playground/conversations/{conversation_id}", {
              params: { path: { workspace_id: id, conversation_id: conversationId } },
              body,
            }),
          )
        } else {
          const created = await unwrap(
            client.POST("/api/workspaces/{workspace_id}/playground/conversations", {
              params: { path: { workspace_id: id } },
              body: { ...body, title },
            }),
          )
          setConversationId(created.id)
        }
        await queryClient.invalidateQueries({ queryKey: qk.conversations(id) })
      } catch {
        // Saving history is best effort; the chat itself already worked.
      }
    },
    [conversationId, id, model, queryClient, settings],
  )

  const run = async (history: Message[]) => {
    if (!model) return
    setError(null)
    setStreaming(true)
    const controller = new AbortController()
    abort.current = controller
    const reply: Message = { role: "assistant", content: "", model }
    setMessages([...history, reply])
    const wire = [
      ...(settings.system.trim() ? [{ role: "system" as const, content: settings.system }] : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ]
    let final: Message[] = history
    try {
      const result = await streamChat(
        id,
        {
          model,
          messages: wire,
          temperature: settings.temperature,
          top_p: settings.top_p,
          max_tokens: settings.max_tokens ?? undefined,
          frequency_penalty: settings.frequency_penalty || undefined,
          presence_penalty: settings.presence_penalty || undefined,
          project_id: settings.project_id ?? undefined,
        },
        (piece) =>
          setMessages((prev) => {
            const copy = [...prev]
            const last = copy[copy.length - 1]
            if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + piece }
            return copy
          }),
        controller.signal,
      )
      final = [
        ...history,
        { ...reply, content: result.content, input_tokens: result.inputTokens, output_tokens: result.outputTokens, cost_micros: result.costMicros },
      ]
      setMessages(final)
      void queryClient.invalidateQueries({ queryKey: qk.billing(id) })
    } catch (e) {
      if (controller.signal.aborted) {
        setMessages((prev) => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, stopped: true }
          final = copy
          return copy
        })
      } else {
        setError(e instanceof ChatError ? e : new ChatError(0, errorMessage(e), null))
        setMessages(history)
        final = history
      }
    } finally {
      setStreaming(false)
      abort.current = null
    }
    if (final.some((m) => m.role === "assistant" && m.content)) void saveConversation(final)
  }

  const send = () => {
    const text = input.trim()
    if (!text || streaming || !model) return
    setInput("")
    void run([...messages, { role: "user", content: text }])
  }

  const regenerate = () => {
    if (streaming) return
    const lastUser = messages.map((m) => m.role).lastIndexOf("user")
    if (lastUser < 0) return
    void run(messages.slice(0, lastUser + 1))
  }

  const newChat = () => {
    abort.current?.abort()
    setMessages([])
    setConversationId(null)
    setError(null)
    setHistoryOpen(false)
  }

  const openConversation = async (cid: string) => {
    try {
      const conv = await unwrap(
        client.GET("/api/workspaces/{workspace_id}/playground/conversations/{conversation_id}", {
          params: { path: { workspace_id: id, conversation_id: cid } },
        }),
      )
      setConversationId(conv.id)
      setMessages(conv.messages as unknown as Message[])
      if (conv.model && available.some((m) => m.id === conv.model)) setModel(conv.model)
      setSettings({ ...DEFAULT_SETTINGS, ...(conv.settings as Partial<Settings>) })
      setError(null)
      setHistoryOpen(false)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const rename = useMutation({
    mutationFn: (v: { cid: string; title: string }) =>
      unwrap(
        client.PATCH("/api/workspaces/{workspace_id}/playground/conversations/{conversation_id}", {
          params: { path: { workspace_id: id, conversation_id: v.cid } },
          body: { title: v.title },
        }),
      ),
    onSuccess: () => {
      setRenaming(null)
      void queryClient.invalidateQueries({ queryKey: qk.conversations(id) })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (cid: string) =>
      unwrap(
        client.DELETE("/api/workspaces/{workspace_id}/playground/conversations/{conversation_id}", {
          params: { path: { workspace_id: id, conversation_id: cid } },
        }),
      ),
    onSuccess: (_, cid) => {
      if (cid === conversationId) newChat()
      void queryClient.invalidateQueries({ queryKey: qk.conversations(id) })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  useEffect(() => {
    if (params.get("model")) {
      const next = new URLSearchParams(params)
      next.delete("model")
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  if (!can(Perm.usePlayground)) {
    return (
      <div className="p-6">
        <EmptyState icon={MessagesSquare} title="No playground access" description="Your role does not include the playground. Ask a workspace admin." />
      </div>
    )
  }

  const totalCost = messages.reduce((sum, m) => sum + (m.cost_micros ?? 0), 0)
  const outOfCredit = error?.code === "insufficient_quota"

  const history = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button className="w-full" variant="outline" onClick={newChat}>
          <MessageSquarePlus /> New chat
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 px-2 pb-3">
          {conversations.isPending ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="m-1 h-9" />)
          ) : (conversations.data ?? []).length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs">Your saved chats appear here.</p>
          ) : (
            (conversations.data ?? []).map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group hover:bg-muted flex items-center gap-1 rounded-md pr-1",
                  c.id === conversationId && "bg-muted",
                )}
              >
                <button type="button" className="min-w-0 flex-1 px-2 py-2 text-left" onClick={() => void openConversation(c.id)}>
                  <p className="truncate text-sm">{c.title}</p>
                  <p className="text-muted-foreground truncate text-xs">{relativeTime(c.updated_at)}</p>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Chat options">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(c)}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )

  const settingsPanel = (
    <div className="space-y-5 p-4">
      <Field>
        <FieldLabel htmlFor="system-prompt">System prompt</FieldLabel>
        <Textarea id="system-prompt" rows={5} value={settings.system} onChange={(e) => update({ system: e.target.value })} />
      </Field>
      <SliderField label="Temperature" value={settings.temperature} min={0} max={2} step={0.05} onChange={(v) => update({ temperature: v })} hint="Higher is more random." />
      <Field>
        <FieldLabel htmlFor="max-tokens">Max output tokens</FieldLabel>
        <Input
          id="max-tokens"
          type="number"
          min={1}
          placeholder={current?.max_output_tokens ? `Up to ${current.max_output_tokens}` : "Model default"}
          value={settings.max_tokens ?? ""}
          onChange={(e) => update({ max_tokens: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
        />
        <FieldDescription>Caps the reply length and the most a reply can cost.</FieldDescription>
      </Field>
      <SliderField label="Top P" value={settings.top_p} min={0} max={1} step={0.05} onChange={(v) => update({ top_p: v })} />
      <SliderField label="Frequency penalty" value={settings.frequency_penalty} min={-2} max={2} step={0.1} onChange={(v) => update({ frequency_penalty: v })} />
      <SliderField label="Presence penalty" value={settings.presence_penalty} min={-2} max={2} step={0.1} onChange={(v) => update({ presence_penalty: v })} />
      <Field>
        <FieldLabel>Charge to project</FieldLabel>
        <Select value={settings.project_id ?? "default"} onValueChange={(v) => update({ project_id: v === "default" ? null : v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default project</SelectItem>
            {(projects.data ?? [])
              .filter((p) => !p.archived_at)
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <FieldDescription>Playground usage is charged to the workspace at the model's price, like the API.</FieldDescription>
      </Field>
    </div>
  )

  const snippetMessages = [
    ...(settings.system.trim() ? [{ role: "system", content: settings.system }] : []),
    ...messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content })),
    ...(input.trim() ? [{ role: "user", content: input.trim() }] : []),
  ]

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
      <aside className="hidden w-64 shrink-0 border-r lg:block">{history}</aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setHistoryOpen(true)} aria-label="Saved chats">
            <MessagesSquare />
          </Button>
          <span className="text-muted-foreground hidden text-sm sm:inline">Playground</span>
          <div className="ml-auto flex items-center gap-1">
            {totalCost > 0 ? (
              <span className="text-muted-foreground tabular mr-2 hidden text-xs sm:inline">This chat: {usd(totalCost)}</span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setCodeOpen(true)} disabled={!model}>
              <Code2 /> View code
            </Button>
            <Button variant="ghost" size="icon-sm" className="xl:hidden" onClick={() => setSettingsOpen(true)} aria-label="Parameters">
              <Settings2 />
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <LogoMark className="size-10" />
                <h2 className="text-xl font-semibold">Chat with {current?.name ?? "a model"}</h2>
                <p className="text-muted-foreground max-w-md text-sm">
                  Every reply shows its tokens and cost. Usage is charged to {workspace.name}, exactly like API requests.
                </p>
                {models.isSuccess && available.length === 0 ? (
                  <Alert variant="warning" className="mt-4 max-w-md text-left">
                    <AlertTitle>No models available yet</AlertTitle>
                    <AlertDescription>A platform admin needs to add or deploy a model first.</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
                {m.role === "assistant" ? <LogoMark className="mt-1 size-6" /> : null}
                <div className={cn("min-w-0", m.role === "user" ? "bg-muted max-w-[85%] rounded-2xl px-4 py-2.5" : "flex-1")}>
                  {m.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  ) : m.content ? (
                    <MarkdownView source={m.content} />
                  ) : (
                    <div className="flex gap-1 py-2" aria-label="Thinking">
                      <span className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full" />
                      <span className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full [animation-delay:120ms]" />
                      <span className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full [animation-delay:240ms]" />
                    </div>
                  )}
                  {m.role === "assistant" && (m.content || m.stopped) && !(streaming && i === messages.length - 1) ? (
                    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {m.stopped ? <span className="text-warning">Stopped</span> : null}
                      {m.input_tokens != null ? (
                        <span className="tabular">
                          {tokens(m.input_tokens)} in / {tokens(m.output_tokens ?? 0)} out
                        </span>
                      ) : null}
                      {m.cost_micros != null ? <span className="tabular">{usd(m.cost_micros, { precise: true })}</span> : null}
                      {m.model ? <code>{m.model}</code> : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-xs" aria-label="Copy reply" onClick={() => void copyText(m.content).then(() => toast.success("Copied."))}>
                            <Copy />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy</TooltipContent>
                      </Tooltip>
                      {i === messages.length - 1 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-xs" aria-label="Regenerate" onClick={regenerate}>
                              <RotateCcw />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Regenerate</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {m.role === "user" ? (
                  <span className="bg-muted text-muted-foreground mt-1 grid size-6 shrink-0 place-items-center rounded-full">
                    <User className="size-3.5" />
                  </span>
                ) : null}
              </div>
            ))}
            {error ? (
              <Alert variant={outOfCredit ? "warning" : "destructive"}>
                <AlertTitle>{outOfCredit ? "You're out of credits" : "The request failed"}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{error.message}</span>
                  {outOfCredit && (can(Perm.manageBilling) || can(Perm.viewBilling)) ? (
                    <Button size="sm" asChild>
                      <Link to={`/w/${id}/billing?add=1`}>
                        <CreditCard /> Add credits
                      </Link>
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <div ref={bottom} />
          </div>
        </ScrollArea>

        <div className="border-t p-3">
          <div className="bg-card focus-within:ring-ring/40 mx-auto max-w-3xl rounded-2xl border shadow-xs focus-within:ring-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Send a message (Shift+Enter for a new line)"
              rows={2}
              className="max-h-60 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center gap-2 px-2 pb-2">
              <ModelPicker models={available} value={model} onChange={setModel} compact className="max-w-[60%]" />
              <div className="ml-auto flex items-center gap-2">
                {streaming ? (
                  <Button size="icon-sm" variant="secondary" onClick={() => abort.current?.abort()} aria-label="Stop">
                    <Square className="fill-current" />
                  </Button>
                ) : (
                  <Button size="icon-sm" onClick={send} disabled={!input.trim() || !model} aria-label="Send">
                    <ArrowUp />
                  </Button>
                )}
              </div>
            </div>
          </div>
          {current ? (
            <p className="text-muted-foreground mx-auto mt-2 max-w-3xl text-center text-xs">
              {current.price.is_free
                ? `${current.name} is free to use.`
                : `${current.name}: ${usd(current.price.input_micros_per_m, { precise: true })} input / ${usd(current.price.output_micros_per_m, { precise: true })} output per 1M tokens`}
            </p>
          ) : null}
        </div>
      </section>

      <aside className="hidden w-80 shrink-0 overflow-y-auto border-l xl:block">
        <p className="border-b px-4 py-3 text-sm font-medium">Parameters</p>
        {settingsPanel}
      </aside>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Parameters</SheetTitle>
          </SheetHeader>
          {settingsPanel}
        </SheetContent>
      </Sheet>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="p-0">
          <SheetHeader>
            <SheetTitle>Saved chats</SheetTitle>
          </SheetHeader>
          {history}
        </SheetContent>
      </Sheet>

      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Use this request in your code</DialogTitle>
            <DialogDescription>
              The same request with the official OpenAI SDKs. Create an API key and set it as DOCKWELL_API_KEY.
            </DialogDescription>
          </DialogHeader>
          <CodeSnippets
            className="min-w-0"
            options={{
              baseUrl: workspace.api_base_url,
              model,
              messages: snippetMessages.length ? snippetMessages : undefined,
              temperature: settings.temperature,
              topP: settings.top_p !== 1 ? settings.top_p : undefined,
              maxTokens: settings.max_tokens ?? undefined,
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const title = String(new FormData(e.currentTarget).get("title") ?? "").trim()
              if (renaming && title) rename.mutate({ cid: renaming.id, title })
            }}
            className="space-y-4"
          >
            <Input name="title" defaultValue={renaming?.title} autoFocus maxLength={200} />
            <Button type="submit" disabled={rename.isPending}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this chat?"
        description="The saved conversation is removed. Usage and request logs are kept."
        confirmLabel="Delete"
        destructive
        onConfirm={() => (deleting ? remove.mutateAsync(deleting.id) : undefined)}
      />
    </div>
  )
}
