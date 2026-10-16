import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { qk } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const workspaceSchema = z.object({ name: z.string().trim().min(1, "Give it a name.").max(80) })

export function CreateWorkspaceDialog({ open, onOpenChange }: DialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useForm<z.infer<typeof workspaceSchema>>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: "" },
  })
  const create = useMutation({
    mutationFn: (name: string) => unwrap(client.POST("/api/workspaces", { body: { name } })),
    onSuccess: async (ws) => {
      await queryClient.invalidateQueries({ queryKey: qk.workspaces })
      toast.success(`${ws.name} is ready.`)
      form.reset()
      onOpenChange(false)
      navigate(`/w/${ws.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit((v) => create.mutate(v.name))} noValidate>
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>A separate space with its own members, roles and projects.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field data-invalid={Boolean(form.formState.errors.name)}>
              <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
              <Input id="ws-name" placeholder="e.g. Acme Engineering" autoFocus {...form.register("name")} />
              <FieldError errors={[form.formState.errors.name]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : null} Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const projectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(100),
  description: z.string().max(1000),
})

export function CreateProjectDialog({ open, onOpenChange, workspaceId }: DialogProps & { workspaceId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: "", description: "" },
  })
  const create = useMutation({
    mutationFn: (body: z.infer<typeof projectSchema>) =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/projects", {
          params: { path: { workspace_id: workspaceId } },
          body,
        }),
      ),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) })
      toast.success(`Project ${project.name} created.`)
      form.reset()
      onOpenChange(false)
      navigate(`/w/${workspaceId}/projects/${project.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Projects group API keys, usage and limits. You'll be given access automatically.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field data-invalid={Boolean(form.formState.errors.name)}>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input id="project-name" placeholder="e.g. Support chatbot" autoFocus {...form.register("name")} />
              <FieldError errors={[form.formState.errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-description">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </FieldLabel>
              <Textarea id="project-description" rows={3} placeholder="What is this project for?" {...form.register("description")} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : null} Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
