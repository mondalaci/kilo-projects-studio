import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import { normalizeOrigin } from "@/api/discovery"
import type {
  AgentInfo,
  CommandInfo,
  LocationInfo,
  ModelInfo,
  ModelRef,
  ProjectInfo,
  ProviderInfo,
  ServerConfig,
} from "@/api/types"

const PREFS_KEY = "kilo-projects-studio.prefs"

interface Preferences {
  [origin: string]: { agent?: string; model?: ModelRef; directory?: string }
}

function loadPrefs(): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Preferences
    const merged: Preferences = {}
    for (const [key, value] of Object.entries(parsed)) {
      const origin = normalizeOrigin(key) ?? key
      merged[origin] = { ...merged[origin], ...value }
    }
    return merged
  } catch {
    return {}
  }
}

const prefs = ref<Preferences>(loadPrefs())

function persistPrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value))
  } catch {
    /* ignore */
  }
}

export interface ModelChoice {
  providerID: string
  providerName: string
  connected: boolean
  model: ModelInfo
}

export interface ModelGroup {
  providerID: string
  providerName: string
  connected: boolean
  models: ModelInfo[]
}

const origin = ref<string | null>(null)
const locationInfo = ref<LocationInfo | null>(null)
const config = ref<ServerConfig | null>(null)
const agents = ref<AgentInfo[]>([])
const providers = ref<ProviderInfo[]>([])
const models = ref<ModelInfo[]>([])
const commands = ref<CommandInfo[]>([])
const projects = ref<ProjectInfo[]>([])
const selectedDirectory = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const selectedAgent = ref<string>("build")
const selectedModel = ref<ModelRef | null>(null)

/** A provider is "connected" when it is not explicitly disabled. */
function providerConnected(provider: ProviderInfo): boolean {
  return provider.activation !== "disabled"
}

/** Providers with their models, connected ones first, then alphabetically. */
const providerGroups = computed<ModelGroup[]>(() => {
  const byProvider = new Map<string, ModelInfo[]>()
  for (const model of models.value) {
    const list = byProvider.get(model.providerID) ?? []
    list.push(model)
    byProvider.set(model.providerID, list)
  }
  return providers.value
    .filter((provider) => (byProvider.get(provider.id)?.length ?? 0) > 0)
    .map((provider) => ({
      providerID: provider.id,
      providerName: provider.name || provider.id,
      connected: providerConnected(provider),
      models: (byProvider.get(provider.id) ?? []).slice().sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
    }))
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1
      return a.providerName.localeCompare(b.providerName)
    })
})

const modes = computed<AgentInfo[]>(() => agents.value.filter((agent) => agent.mode === "primary" && !agent.hidden))

const selectedAgentInfo = computed<AgentInfo | undefined>(() =>
  modes.value.find((agent) => agent.id === selectedAgent.value),
)

const selectedModelInfo = computed<ModelInfo | undefined>(() => {
  const ref_ = selectedModel.value
  if (!ref_) return undefined
  return models.value.find((item) => item.providerID === ref_.providerID && (item.id === ref_.id || item.modelID === ref_.id))
})

/** Variant names available for the selected model (reasoning effort, etc.). */
const selectedModelVariants = computed<string[]>(() => (selectedModelInfo.value?.variants ?? []).map((v) => v.id))

/** Currently selected variant for the selected model. */
const selectedVariant = computed<string | undefined>(() => selectedModel.value?.variant)

function parseModelString(value: ServerConfig["model"]): ModelRef | null {
  if (!value) return null
  if (typeof value === "object") return { providerID: value.providerID, id: value.model, variant: value.variant }
  const [providerID, ...rest] = value.split("/")
  const id = rest.join("/")
  if (!providerID || !id) return null
  return { providerID, id }
}

export function useServer() {
  function applyDefaults() {
    const cfg = config.value
    const defaults = prefs.value[origin.value ?? ""] ?? {}
    selectedAgent.value = defaults.agent ?? cfg?.default_agent ?? modes.value[0]?.id ?? "build"
    selectedModel.value = resolveDefaultModel()
  }

  /** Attach the remembered variant (if it is valid for the model). */
  function withVariant(ref_: ModelRef): ModelRef {
    const info = models.value.find((item) => item.providerID === ref_.providerID && item.id === ref_.id)
    if (ref_.variant && info?.variants?.some((v) => v.id === ref_.variant)) return ref_
    const { variant: _drop, ...rest } = ref_
    return rest
  }

  /**
   * Resolve the same default the server would use when a prompt omits a model:
   * saved pref → agent model → config.model → the first enabled model whose
   * provider is available.
   */
  function resolveDefaultModel(): ModelRef | null {
    const defaults = prefs.value[origin.value ?? ""] ?? {}
    if (defaults.model) return withVariant(defaults.model)
    const agentModel = selectedAgentInfo.value?.model
    if (agentModel) return withVariant(agentModel)
    const cfgModel = parseModelString(config.value?.model)
    if (cfgModel) return withVariant(cfgModel)
    const available = new Set(providerGroups.value.filter((group) => group.connected).map((group) => group.providerID))
    const first = models.value.find((model) => available.has(model.providerID) && model.enabled !== false)
    if (first) return { providerID: first.providerID, id: first.id }
    return null
  }

  async function load(client: ServerClient, instanceOrigin: string, directory?: string) {
    const changedOrigin = origin.value !== instanceOrigin
    origin.value = instanceOrigin
    loading.value = true
    error.value = null

    // Apply saved agent/model synchronously so the UI never flashes the default
    // before the persisted choice loads.
    const saved = prefs.value[instanceOrigin] ?? {}
    if (saved.agent) selectedAgent.value = saved.agent
    if (saved.model) selectedModel.value = saved.model

    try {
      let location = directory ? await client.location({ directory }).catch(() => null) : null
      let dir = directory && location ? directory : undefined
      if (!dir || !location) {
        location = await client.location().catch(() => null)
        dir = location?.directory ?? undefined
      }
      locationInfo.value = location
      selectedDirectory.value = dir ?? null

      const [cfg, agentList, providerList, modelList, commandList, projectList] = await Promise.all([
        client.config({ directory: dir }).catch(() => null),
        client.agents({ directory: dir }).catch(() => [] as AgentInfo[]),
        client.providers({ directory: dir }).catch(() => [] as ProviderInfo[]),
        client.models({ directory: dir }).catch(() => [] as ModelInfo[]),
        client.commands({ directory: dir }).catch(() => [] as CommandInfo[]),
        client.projects().catch(() => [] as ProjectInfo[]),
      ])
      config.value = cfg
      agents.value = agentList
      providers.value = providerList
      models.value = modelList
      commands.value = commandList
      projects.value = projectList
      // Don't clobber the current agent/model when only switching project.
      if (changedOrigin || !selectedModel.value) applyDefaults()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function savedDirectory(instanceOrigin: string): string | undefined {
    return prefs.value[instanceOrigin]?.directory
  }

  function applySavedPrefs(instanceOrigin: string) {
    const saved = prefs.value[instanceOrigin] ?? {}
    if (saved.agent) selectedAgent.value = saved.agent
    if (saved.model) selectedModel.value = saved.model
  }

  function setDirectory(dir: string) {
    selectedDirectory.value = dir
    const key = origin.value
    if (key) {
      prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], directory: dir } }
      persistPrefs()
    }
  }

  function reset() {
    origin.value = null
    locationInfo.value = null
    config.value = null
    agents.value = []
    providers.value = []
    models.value = []
    commands.value = []
    projects.value = []
    selectedDirectory.value = null
    selectedModel.value = null
  }

  function setAgent(name: string) {
    selectedAgent.value = name
    const key = origin.value ?? ""
    prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], agent: name } }
    persistPrefs()
  }

  function setModel(model: ModelRef) {
    const next = withVariant({ providerID: model.providerID, id: model.id })
    selectedModel.value = next
    const key = origin.value ?? ""
    prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], model: next } }
    persistPrefs()
  }

  function setVariant(variant: string) {
    if (!selectedModel.value) return
    const next = { ...selectedModel.value, variant }
    selectedModel.value = next
    const key = origin.value ?? ""
    prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], model: next } }
    persistPrefs()
  }

  /** The directory that scopes all instance requests (the selected project). */
  const directory = computed(() => selectedDirectory.value ?? locationInfo.value?.directory ?? undefined)

  return {
    locationInfo,
    config,
    agents,
    providers,
    models,
    commands,
    projects,
    selectedDirectory,
    loading,
    error,
    modes,
    providerGroups,
    selectedAgent,
    selectedAgentInfo,
    selectedModel,
    selectedModelInfo,
    selectedModelVariants,
    selectedVariant,
    directory,
    load,
    setDirectory,
    savedDirectory,
    applySavedPrefs,
    reset,
    setAgent,
    setModel,
    setVariant,
  }
}
