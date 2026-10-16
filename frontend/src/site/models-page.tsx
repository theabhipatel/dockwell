import { SitePage } from "./components/site-page"
import { usePublicModels } from "./live-data"
import { ModelPriceTable } from "./model-table"

export function ModelsPage() {
  const models = usePublicModels()
  return (
    <SitePage
      eyebrow="Models"
      title="Open source models, one API."
      intro="Every model on this install, served by vLLM, llama.cpp or an attached provider, all through the same OpenAI-compatible API. The list is live."
    >
      <ModelPriceTable models={models.data} error={models.error} detailed />
      <div className="text-muted-foreground mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <p><strong className="text-foreground">Capabilities.</strong> chat, completions, tools (function calling), vision and embeddings, as supported by each model.</p>
        <p><strong className="text-foreground">Context.</strong> The maximum number of tokens (prompt plus reply) a request can use with that model.</p>
      </div>
    </SitePage>
  )
}
