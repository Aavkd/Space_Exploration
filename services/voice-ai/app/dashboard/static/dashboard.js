(function () {
  const routes = [
    {
      key: "overview",
      label: "Overview",
      title: "Overview",
      intro: "Operational snapshot of the voice service, active defaults and where each editable preset lives on disk.",
      render: renderOverviewPage,
    },
    {
      key: "settings",
      label: "Settings",
      title: "Settings",
      intro: "Service-level manifest for runtime behavior, API base path, prepared modules and dashboard-facing metadata.",
      render: () =>
        renderJsonEditorPage({
          endpoint: "/api/v1/config/manifest",
          eyebrow: "Service manifest",
          title: "Application manifest",
          copy: "Edit the FastAPI service manifest in JSON. Preset source file paths stay locked in the V1 dashboard to avoid breaking the running layout.",
          hintBuilder: (overview) => `Manifest file: ${overview.paths.manifest}`,
        }),
    },
    {
      key: "providers",
      label: "Providers",
      title: "Providers",
      intro: "LLM, STT, TTS and embeddings providers in one maintainable JSON surface, with fast access to defaults and fallback strategy.",
      render: renderProvidersPage,
    },
    {
      key: "personas",
      label: "Personas",
      title: "Personas",
      intro: "Prompt and persona definitions with JSON editing, ready for iteration around tone, constraints and voice bindings.",
      render: renderPersonasPage,
    },
    {
      key: "conversation-test",
      label: "Conversation Test",
      title: "Conversation Test",
      intro: "Run text conversations against the live LLM stack, capture browser microphone audio for local transcription, and inspect the assembled prompt plus timings in dry run mode.",
      render: renderConversationPage,
    },
    {
      key: "voice-stt-tts",
      label: "Voice / STT / TTS",
      title: "Voice / STT / TTS",
      intro: "Wake word, language support and voice mode controls, with live visibility into the currently configured speech engines.",
      render: renderVoicePage,
    },
    {
      key: "memory",
      label: "Memory",
      title: "Memory",
      intro: "SQLite-backed conversation history, user preferences and manual facts. Browse, edit and delete stored data from this page.",
      render: renderMemoryPage,
    },
    {
      key: "logs",
      label: "Logs",
      title: "Logs",
      intro: "Operational readout for runtime logging posture and the observability hooks the backend is already preparing for later lots.",
      render: renderLogsPage,
    },
  ]

  const routeMap = Object.fromEntries(routes.map((route) => [route.key, route]))
  const pageBody = document.getElementById("page-body")
  const pageTitle = document.getElementById("page-title")
  const pageEyebrow = document.getElementById("page-eyebrow")
  const pageIntro = document.getElementById("page-intro")
  const dashboardNav = document.getElementById("dashboard-nav")
  const serviceStatus = document.getElementById("service-status")
  const statusBanner = document.getElementById("status-banner")

  let cachedOverview = null
  const DEV_PERSONA_STORAGE_KEY = "deep-space-voice.active-persona"

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
  }

  function prettyJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function summarizeList(items, fallback = "Not set") {
    return Array.isArray(items) && items.length ? items.join(", ") : fallback
  }

  function rememberActivePersona(personaId) {
    if (!personaId) {
      window.localStorage.removeItem(DEV_PERSONA_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(DEV_PERSONA_STORAGE_KEY, personaId)
  }

  function getRememberedPersona(personas, fallbackPersonaId = "") {
    const rememberedId = window.localStorage.getItem(DEV_PERSONA_STORAGE_KEY)
    if (rememberedId && personas.some((persona) => persona.id === rememberedId)) {
      return rememberedId
    }
    if (fallbackPersonaId && personas.some((persona) => persona.id === fallbackPersonaId)) {
      return fallbackPersonaId
    }
    return personas[0] ? personas[0].id : ""
  }

  function normalizePersonasImport(imported, currentConfig) {
    if (imported && Array.isArray(imported.personas)) {
      const merged = cloneJson(imported)
      if (!merged.default_persona_id) {
        merged.default_persona_id = currentConfig.default_persona_id || (merged.personas[0] && merged.personas[0].id) || ""
      }
      return merged
    }

    const importedPersona = imported && imported.kind === "deep-space-persona" && imported.persona
      ? imported.persona
      : imported && imported.id && imported.name
        ? imported
        : null

    if (!importedPersona) {
      throw new Error("Unsupported persona import format. Use a full personas preset or a single exported persona file.")
    }

    const merged = cloneJson(currentConfig)
    if (!Array.isArray(merged.personas)) {
      merged.personas = []
    }
    const existingIndex = merged.personas.findIndex((persona) => persona.id === importedPersona.id)
    if (existingIndex >= 0) {
      merged.personas[existingIndex] = importedPersona
    } else {
      merged.personas.push(importedPersona)
    }

    if (imported.activate_as_default || !merged.default_persona_id) {
      merged.default_persona_id = importedPersona.id
    }

    return merged
  }

  function setStatus(type, message) {
    if (!message) {
      statusBanner.hidden = true
      statusBanner.textContent = ""
      statusBanner.className = "status-banner"
      return
    }

    statusBanner.hidden = false
    statusBanner.className = `status-banner is-${type}`
    statusBanner.textContent = message
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    })

    let payload = null
    try {
      payload = await response.json()
    } catch (error) {
      payload = null
    }

    if (!response.ok) {
      const detail = payload && payload.detail ? payload.detail : `Request failed with status ${response.status}`
      throw new Error(detail)
    }

    return payload
  }

  function getPageKeyFromLocation() {
    const segments = window.location.pathname.replace(/\/+$/, "").split("/").filter(Boolean)
    const pageKey = segments.length >= 2 ? segments[1] : "overview"
    return routeMap[pageKey] ? pageKey : "overview"
  }

  function getPageHref(pageKey) {
    return pageKey === "overview" ? "/dashboard" : `/dashboard/${pageKey}`
  }

  function renderNav(activePageKey) {
    dashboardNav.innerHTML = routes
      .map((route) => {
        const activeClass = route.key === activePageKey ? "nav-link is-active" : "nav-link"
        return `<a class="${activeClass}" href="${getPageHref(route.key)}" data-page-key="${route.key}">${escapeHtml(route.label)}</a>`
      })
      .join("")
  }

  async function loadOverview(force = false) {
    if (!cachedOverview || force) {
      cachedOverview = await fetchJson("/api/v1/dashboard/overview")
    }
    serviceStatus.textContent = `${cachedOverview.service.name} v${cachedOverview.service.version} · ${cachedOverview.service.environment}`
    return cachedOverview
  }

  function createPanel(html) {
    const section = document.createElement("section")
    section.className = "panel"
    section.innerHTML = html
    return section
  }

  function createStatsGrid(cards) {
    const grid = document.createElement("section")
    grid.className = "stats-grid"
    grid.innerHTML = cards
      .map(
        (card) => `
          <article class="stat-card">
            <p class="eyebrow">${escapeHtml(card.eyebrow)}</p>
            <h3>${escapeHtml(card.title)}</h3>
            <p class="stat-value">${escapeHtml(card.value)}</p>
          </article>
        `
      )
      .join("")
    return grid
  }

  function createKeyValuePanel(eyebrow, title, values) {
    const rows = values
      .map(
        (entry) => `
          <div>
            <dt>${escapeHtml(entry.label)}</dt>
            <dd>${escapeHtml(entry.value)}</dd>
          </div>
        `
      )
      .join("")
    return createPanel(`
      <div class="panel-header">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h3 class="panel-title">${escapeHtml(title)}</h3>
        </div>
      </div>
      <dl class="key-value">${rows}</dl>
    `)
  }

  async function renderRoute(pageKey, replaceState) {
    const route = routeMap[pageKey] || routeMap.overview
    renderNav(route.key)
    pageTitle.textContent = route.title
    pageEyebrow.textContent = "Dashboard"
    pageIntro.textContent = route.intro
    pageBody.innerHTML = ""
    setStatus(null, "")

    if (replaceState) {
      window.history.replaceState({ pageKey: route.key }, "", getPageHref(route.key))
    }

    pageBody.appendChild(createPanel("<p class='panel-copy'>Loading dashboard data...</p>"))

    try {
      await route.render()
    } catch (error) {
      pageBody.innerHTML = ""
      setStatus("error", error.message || "Unable to load the dashboard page.")
      pageBody.appendChild(
        createPanel(
          `<p class="panel-copy">The page could not be rendered. Check the API responses and configuration files, then reload the dashboard.</p>`
        )
      )
    }
  }

  function navigateTo(pageKey) {
    const route = routeMap[pageKey]
    if (!route) {
      return
    }
    window.history.pushState({ pageKey }, "", getPageHref(pageKey))
    renderRoute(pageKey)
  }

  async function renderOverviewPage() {
    const overview = await loadOverview(true)
    pageBody.innerHTML = ""

    pageBody.appendChild(
      createStatsGrid([
        { eyebrow: "Personas", title: "Configured personas", value: overview.counts.personas },
        { eyebrow: "Providers", title: "LLM providers", value: overview.counts.llm_providers },
        { eyebrow: "Speech", title: "STT / TTS engines", value: `${overview.counts.stt_engines} / ${overview.counts.tts_engines}` },
        { eyebrow: "Modes", title: "Voice modes", value: overview.counts.voice_modes },
      ])
    )

    const summary = document.createElement("section")
    summary.className = "summary-grid"
    summary.appendChild(
      createKeyValuePanel("Runtime", "Active defaults", [
        { label: "LLM", value: overview.defaults.llm_provider || "Not set" },
        { label: "Fallback", value: overview.defaults.llm_fallback || "None" },
        { label: "STT", value: overview.defaults.stt_engine || "Not set" },
        { label: "TTS", value: overview.defaults.tts_engine || "Not set" },
        { label: "Persona", value: overview.defaults.persona_id || "Not set" },
        { label: "Wake word", value: overview.defaults.wake_word || "Disabled" },
      ])
    )
    summary.appendChild(
      createKeyValuePanel("Files", "Config sources", [
        { label: "Manifest", value: overview.paths.manifest },
        { label: "Providers", value: overview.paths.providers },
        { label: "Personas", value: overview.paths.personas },
        { label: "Voice", value: overview.paths.voice },
      ])
    )
    pageBody.appendChild(summary)

    const listGrid = document.createElement("section")
    listGrid.className = "list-grid"
    listGrid.innerHTML = overview.pages
      .map((pageKey) => {
        const route = routeMap[pageKey]
        const note = overview.roadmap_notes[pageKey.replaceAll("-", "_")] || route.intro
        return `
          <article class="list-card">
            <p class="eyebrow">${escapeHtml(route.label)}</p>
            <h3>${escapeHtml(route.title)}</h3>
            <p>${escapeHtml(note)}</p>
          </article>
        `
      })
      .join("")
    pageBody.appendChild(listGrid)

    pageBody.appendChild(
      createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">Prepared modules</p>
            <h3 class="panel-title">Backend readiness</h3>
          </div>
        </div>
        <p class="panel-copy">${escapeHtml(overview.modules.join(" · "))}</p>
      `)
    )
  }

  async function renderJsonEditorPage(options) {
    const [data, overview] = await Promise.all([fetchJson(options.endpoint), loadOverview()])

    const editorTemplate = document.getElementById("json-editor-template")
    const editor = editorTemplate.content.firstElementChild.cloneNode(true)
    const titleNode = editor.querySelector(".panel-title")
    const eyebrowNode = editor.querySelector(".panel-eyebrow")
    const copyNode = editor.querySelector(".panel-copy")
    const textArea = editor.querySelector(".json-editor")
    const hintNode = editor.querySelector(".editor-hint")
    const fileActions = editor.querySelector(".file-actions")

    eyebrowNode.textContent = options.eyebrow
    titleNode.textContent = options.title
    copyNode.textContent = options.copy
    textArea.value = prettyJson(data)
    hintNode.textContent = options.hintBuilder ? options.hintBuilder(overview, data) : ""

    let baseline = textArea.value

    editor.querySelector("[data-action='format']").addEventListener("click", () => {
      try {
        textArea.value = prettyJson(JSON.parse(textArea.value))
        setStatus("success", "JSON formatted locally.")
      } catch (error) {
        setStatus("error", `Cannot format invalid JSON: ${error.message}`)
      }
    })

    editor.querySelector("[data-action='reset']").addEventListener("click", () => {
      textArea.value = baseline
      setStatus("success", "Editor reset to the last saved version.")
    })

    editor.querySelector("[data-action='save']").addEventListener("click", async () => {
      try {
        const parsed = JSON.parse(textArea.value)
        const saved = await fetchJson(options.endpoint, {
          method: "PUT",
          body: JSON.stringify(parsed),
        })
        baseline = prettyJson(saved)
        textArea.value = baseline
        cachedOverview = null
        await loadOverview(true)
        setStatus("success", `${options.title} saved successfully.`)
      } catch (error) {
        setStatus("error", error.message || "Unable to save JSON.")
      }
    })

    if (options.enableImportExport) {
      const downloadButton = document.createElement("button")
      downloadButton.className = "file-button"
      downloadButton.textContent = "Export JSON"
      downloadButton.addEventListener("click", () => {
        const blob = new Blob([textArea.value], { type: "application/json" })
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = options.exportFilename
        link.click()
        window.URL.revokeObjectURL(url)
      })

      const importInput = document.createElement("input")
      importInput.type = "file"
      importInput.accept = ".json,application/json"
      importInput.hidden = true
      importInput.addEventListener("change", async () => {
        const file = importInput.files && importInput.files[0]
        if (!file) {
          return
        }
        try {
          const content = await file.text()
          let importedValue = JSON.parse(content)
          if (options.transformImportedJson) {
            importedValue = options.transformImportedJson(importedValue, JSON.parse(textArea.value))
          }
          textArea.value = prettyJson(importedValue)
          setStatus("success", `Imported ${file.name} into the editor. Review it before saving.`)
        } catch (error) {
          setStatus("error", error.message || `Unable to import ${file.name}.`)
        } finally {
          importInput.value = ""
        }
      })

      const importButton = document.createElement("button")
      importButton.className = "file-button"
      importButton.textContent = "Import JSON"
      importButton.addEventListener("click", () => importInput.click())

      fileActions.append(downloadButton, importButton, importInput)
    }

    pageBody.appendChild(editor)
  }

  async function renderProvidersPage() {
    const [providers, overview] = await Promise.all([fetchJson("/api/v1/config/providers"), loadOverview()])
    pageBody.innerHTML = ""

    pageBody.appendChild(
      createStatsGrid([
        { eyebrow: "Default", title: "Primary LLM", value: overview.defaults.llm_provider || "Not set" },
        { eyebrow: "Fallback", title: "Fallback LLM", value: overview.defaults.llm_fallback || "None" },
        { eyebrow: "Speech", title: "Default STT / TTS", value: `${overview.defaults.stt_engine} / ${overview.defaults.tts_engine}` },
        { eyebrow: "Embeddings", title: "Default provider", value: overview.defaults.embeddings_provider || "Not set" },
      ])
    )

    const summary = document.createElement("section")
    summary.className = "summary-grid"
    summary.appendChild(
      createKeyValuePanel("Inventory", "Configured provider groups", [
        { label: "LLM providers", value: Object.keys(providers.llm.providers).length },
        { label: "STT engines", value: Object.keys(providers.stt.engines).length },
        { label: "TTS engines", value: Object.keys(providers.tts.engines).length },
        { label: "Embedding providers", value: Object.keys(providers.embeddings.providers).length },
      ])
    )
    summary.appendChild(
      createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">Strategy</p>
            <h3 class="panel-title">Selection posture</h3>
          </div>
        </div>
        <p class="panel-copy">The dashboard keeps local-first provider switching explicit: default model choice, cloud fallback and speech backends all live in one versionable JSON file.</p>
      `)
    )
    pageBody.appendChild(summary)

    await renderJsonEditorPage({
      endpoint: "/api/v1/config/providers",
      eyebrow: "Config JSON",
      title: "Providers preset",
      copy: "Read and update LLM, STT, TTS and embeddings providers from a single validated preset file.",
      hintBuilder: () => `Providers file: ${overview.paths.providers}`,
    })
  }

  async function renderPersonasPage() {
    const [personas, overview] = await Promise.all([fetchJson("/api/v1/config/personas"), loadOverview()])
    pageBody.innerHTML = ""

    const cards = document.createElement("section")
    cards.className = "list-grid"
    cards.innerHTML = personas.personas
      .map((persona) => {
        const isDefault = persona.id === personas.default_persona_id
        return `
          <article class="list-card persona-card">
            <p class="eyebrow">${isDefault ? "Default persona" : "Persona"}</p>
            <h3>${escapeHtml(persona.name)}</h3>
            <p>${escapeHtml(persona.description || "No description provided.")}</p>
            <div class="persona-meta">
              <span class="persona-chip">${escapeHtml(persona.style.tone || "tone:unset")}</span>
              <span class="persona-chip">${escapeHtml(persona.preferred_language)}</span>
              <span class="persona-chip">${escapeHtml(persona.voice.engine || "tts:unbound")}</span>
              <span class="persona-chip">${escapeHtml(persona.memory.scope || "memory:unset")}</span>
              <span class="persona-chip">${escapeHtml(persona.tools.mode || "tools:unset")}</span>
            </div>
            <p><strong>Voice:</strong> ${escapeHtml(persona.voice.engine || "unbound")} · ${escapeHtml(persona.voice.language || persona.preferred_language)} · ${escapeHtml(persona.voice.style || "default")}</p>
            <p><strong>Memory:</strong> ${escapeHtml(persona.memory.scope)} · ${escapeHtml(persona.memory.retention_mode)}</p>
            <p><strong>Tools:</strong> ${escapeHtml(persona.tools.mode)} · ${escapeHtml(summarizeList(persona.tools.allowed_tools, "No declared future tools"))}</p>
            <p><strong>Tags:</strong> ${escapeHtml(summarizeList(persona.tags, "No tags"))}</p>
            <div class="panel-actions">
              <button class="secondary-button" type="button" data-persona-action="activate" data-persona-id="${escapeHtml(persona.id)}">Use in Conversation Test</button>
              <button class="file-button" type="button" data-persona-action="export" data-persona-id="${escapeHtml(persona.id)}">Export Persona</button>
              <button class="${isDefault ? "secondary-button" : "primary-button"}" type="button" data-persona-action="default" data-persona-id="${escapeHtml(persona.id)}" ${isDefault ? "disabled" : ""}>${isDefault ? "Default active" : "Set as Default"}</button>
            </div>
          </article>
        `
      })
      .join("")
    pageBody.appendChild(cards)

    cards.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-persona-action]")
      if (!button) {
        return
      }

      const action = button.dataset.personaAction
      const personaId = button.dataset.personaId
      const persona = personas.personas.find((entry) => entry.id === personaId)
      if (!persona) {
        return
      }

      if (action === "activate") {
        rememberActivePersona(persona.id)
        setStatus("success", `${persona.name} will now be preselected in Conversation Test.`)
        navigateTo("conversation-test")
        return
      }

      if (action === "export") {
        const blob = new Blob(
          [
            prettyJson({
              kind: "deep-space-persona",
              schema_version: 1,
              activate_as_default: persona.id === personas.default_persona_id,
              persona,
            }),
          ],
          { type: "application/json" }
        )
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `deep-space-persona-${persona.id}.json`
        link.click()
        window.URL.revokeObjectURL(url)
        setStatus("success", `${persona.name} exported as an individual persona preset.`)
        return
      }

      if (action === "default") {
        const nextPayload = cloneJson(personas)
        nextPayload.default_persona_id = persona.id
        try {
          button.disabled = true
          await fetchJson("/api/v1/config/personas", {
            method: "PUT",
            body: JSON.stringify(nextPayload),
          })
          rememberActivePersona(persona.id)
          cachedOverview = null
          setStatus("success", `${persona.name} is now the default narrator preset.`)
          await renderPersonasPage()
        } catch (error) {
          setStatus("error", error.message || "Unable to switch the default persona.")
          button.disabled = false
        }
      }
    })

    await renderJsonEditorPage({
      endpoint: "/api/v1/config/personas",
      eyebrow: "Prompts and tone",
      title: "Personas preset",
      copy: "Edit persona prompts, voice bindings and role constraints directly in JSON. Import and export are available from this screen.",
      hintBuilder: () => `Personas file: ${overview.paths.personas}`,
      enableImportExport: true,
      exportFilename: "deep-space-personas.json",
      transformImportedJson: (importedValue, currentValue) => normalizePersonasImport(importedValue, currentValue),
    })
  }

  async function renderVoicePage() {
    const [voice, providers, config, overview] = await Promise.all([
      fetchJson("/api/v1/config/voice"),
      fetchJson("/api/v1/config/providers"),
      fetchJson("/api/v1/config"),
      loadOverview(),
    ])
    pageBody.innerHTML = ""

    const ttsDefaultEngine = providers.tts.default_engine || ""
    const ttsEngineConfig = ttsDefaultEngine ? providers.tts.engines[ttsDefaultEngine] : null

    pageBody.appendChild(
      createStatsGrid([
        { eyebrow: "Wake word", title: "Activation phrase", value: voice.wake_word.enabled ? voice.wake_word.phrase : "Disabled" },
        { eyebrow: "Mode", title: "Default voice mode", value: voice.modes.default_mode },
        { eyebrow: "VAD", title: "Speech threshold", value: voice.modes.vad ? voice.modes.vad.threshold : "Not set" },
        { eyebrow: "Barge-in", title: "Interruption", value: voice.modes.allow_barge_in ? "Enabled" : "Disabled" },
      ])
    )

    const summary = document.createElement("section")
    summary.className = "summary-grid"
    summary.appendChild(
      createKeyValuePanel("Speech engines", "Current defaults", [
        { label: "STT engine", value: providers.stt.default_engine || "Not set" },
        { label: "TTS engine", value: ttsDefaultEngine || "Not set" },
        { label: "TTS backend", value: ttsEngineConfig ? ttsEngineConfig.backend : "Not set" },
        { label: "Wake word provider", value: voice.wake_word.provider_engine || "None" },
        { label: "Languages", value: voice.supported_languages.join(", ") },
        { label: "VAD", value: voice.modes.vad_enabled ? "Enabled" : "Disabled" },
        { label: "VAD min speech", value: voice.modes.vad ? `${voice.modes.vad.min_speech_ms} ms` : "Not set" },
        { label: "Continuous wake required", value: voice.modes.continuous_requires_wake_word ? "Yes" : "No" },
        { label: "Continuous idle timeout", value: `${voice.modes.continuous_idle_timeout_seconds || 0} s` },
      ])
    )
    summary.appendChild(
      createKeyValuePanel("TTS engines", "Configured engines", Object.entries(providers.tts.engines).map(([id, eng]) => ({
        label: id,
        value: `${eng.backend} · ${eng.enabled ? "enabled" : "disabled"}${eng.options && eng.options.model_path ? " · model: " + eng.options.model_path : " · no model set"}`,
      })))
    )
    pageBody.appendChild(summary)

    // TTS test bench
    const selectedPersonaId = config.personas.default_persona_id || (config.personas.personas[0] && config.personas.personas[0].id) || ""
    const ttsBenchPanel = document.createElement("section")
    ttsBenchPanel.className = "panel conversation-shell"
    ttsBenchPanel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Local TTS validation</p>
          <h3 class="panel-title">Text-to-speech bench</h3>
        </div>
        <div class="panel-actions">
          <button class="secondary-button" id="tts-reset" type="button">Reset</button>
          <button class="primary-button" id="tts-synthesize" type="button">Synthesize</button>
        </div>
      </div>
      <p class="panel-copy">Send text to the backend TTS engine and play the generated audio. Persona voice settings (speaking rate, engine, voice model) are applied automatically when a persona is selected. A Piper model (.onnx) must be configured in providers.json for audio output.</p>
      <div class="field-row">
        <label>
          Persona (voice settings)
          <select id="tts-persona"></select>
        </label>
        <label>
          Engine override
          <select id="tts-engine">
            <option value="">Use default (${escapeHtml(ttsDefaultEngine || "none")})</option>
            ${Object.entries(providers.tts.engines).filter(([, e]) => e.enabled).map(([id]) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="field-row">
        <label>
          Dry run (metadata only, no audio)
          <input id="tts-dry-run" type="checkbox" />
        </label>
        <label>
          Endpoint
          <input type="text" value="POST /api/v1/conversation/tts" readonly />
        </label>
      </div>
      <label>
        Text to synthesize
        <textarea class="conversation-input" id="tts-input" spellcheck="true">You stand at the threshold of a vast and luminous cosmos.</textarea>
      </label>
    `
    pageBody.appendChild(ttsBenchPanel)

    const ttsResultGrid = document.createElement("section")
    ttsResultGrid.className = "two-column-grid"
    ttsResultGrid.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Audio output</p>
            <h3 class="panel-title">Playback</h3>
          </div>
        </div>
        <div id="tts-audio-container" style="padding: 1rem 0;">
          <p class="panel-copy" id="tts-audio-status">Run a synthesis request to hear the TTS output.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Synthesis metadata</p>
            <h3 class="panel-title">Engine and timings</h3>
          </div>
        </div>
        <dl class="key-value" id="tts-meta"></dl>
      </section>
    `
    pageBody.appendChild(ttsResultGrid)

    await renderJsonEditorPage({
      endpoint: "/api/v1/config/voice",
      eyebrow: "Voice config",
      title: "Voice preset",
      copy: "Update wake word settings, supported languages and interaction modes through the validated voice preset.",
      hintBuilder: () => `Voice file: ${overview.paths.voice}`,
    })

    // Wire up TTS bench
    const personaSelect = ttsBenchPanel.querySelector("#tts-persona")
    const engineSelect = ttsBenchPanel.querySelector("#tts-engine")
    const dryRunCheckbox = ttsBenchPanel.querySelector("#tts-dry-run")
    const inputField = ttsBenchPanel.querySelector("#tts-input")
    const synthesizeButton = ttsBenchPanel.querySelector("#tts-synthesize")
    const resetButton = ttsBenchPanel.querySelector("#tts-reset")
    const audioContainer = ttsResultGrid.querySelector("#tts-audio-container")
    const audioStatus = ttsResultGrid.querySelector("#tts-audio-status")
    const metaField = ttsResultGrid.querySelector("#tts-meta")

    personaSelect.innerHTML = `<option value="">No persona (use engine defaults)</option>` +
      config.personas.personas.map((persona) => {
        const selected = persona.id === selectedPersonaId ? "selected" : ""
        const voiceInfo = persona.voice.engine ? ` · ${persona.voice.engine}${persona.voice.speaking_rate !== 1.0 ? " · rate:" + persona.voice.speaking_rate : ""}` : ""
        return `<option value="${escapeHtml(persona.id)}" ${selected}>${escapeHtml(persona.name)}${escapeHtml(voiceInfo)}</option>`
      }).join("")

    function createMetaRows(entries) {
      return entries.map((e) => `<div><dt>${escapeHtml(e.label)}</dt><dd>${escapeHtml(e.value)}</dd></div>`).join("")
    }

    function renderTtsIdle() {
      metaField.innerHTML = createMetaRows([
        { label: "Engine", value: "Pending" },
        { label: "Backend", value: "Pending" },
        { label: "Voice ID", value: "Pending" },
        { label: "Language", value: "Pending" },
        { label: "Speaking rate", value: "Pending" },
        { label: "Text length", value: "Pending" },
        { label: "Audio size", value: "Pending" },
        { label: "Sample rate", value: "Pending" },
        { label: "Generation", value: "Pending" },
        { label: "Total", value: "Pending" },
      ])
    }

    function renderTtsMeta(data) {
      metaField.innerHTML = createMetaRows([
        { label: "Engine", value: data.engine.id || "Not set" },
        { label: "Backend", value: data.engine.backend || "Not set" },
        { label: "Voice ID", value: data.engine.voice_id || "Default" },
        { label: "Language", value: data.synthesis.language || "Not set" },
        { label: "Speaking rate", value: String(data.synthesis.speaking_rate) },
        { label: "Text length", value: `${data.synthesis.text_length} chars` },
        { label: "Audio size", value: `${data.audio.size_bytes} bytes` },
        { label: "Sample rate", value: `${data.audio.sample_rate_hz} Hz` },
        { label: "Generation", value: `${data.timings.generation_ms} ms` },
        { label: "Total", value: `${data.timings.total_ms} ms` },
      ])
    }

    async function runSynthesis() {
      const text = inputField.value.trim()
      if (!text) {
        setStatus("error", "Enter text before synthesizing.")
        return
      }
      synthesizeButton.disabled = true
      synthesizeButton.textContent = "Synthesizing..."
      setStatus("success", "Synthesis request sent...")

      const payload = {
        text,
        dry_run: dryRunCheckbox.checked,
        ...(engineSelect.value ? { engine_id: engineSelect.value } : {}),
        ...(personaSelect.value ? { persona_id: personaSelect.value } : {}),
      }

      try {
        const data = await fetchJson("/api/v1/conversation/tts", {
          method: "POST",
          body: JSON.stringify(payload),
        })
        renderTtsMeta(data)

        if (data.dry_run && data.dry_run.enabled) {
          audioStatus.textContent = "Dry run — metadata returned, no audio generated."
          const existing = audioContainer.querySelector("audio")
          if (existing) existing.remove()
          setStatus("success", `Dry run completed on ${data.engine.id} in ${data.timings.total_ms} ms.`)
        } else if (data.audio && data.audio.audio_base64) {
          const audioEl = document.createElement("audio")
          audioEl.controls = true
          audioEl.src = `data:${data.audio.content_type};base64,${data.audio.audio_base64}`
          audioEl.style.width = "100%"
          const existing = audioContainer.querySelector("audio")
          if (existing) existing.remove()
          audioStatus.hidden = true
          audioContainer.appendChild(audioEl)
          audioEl.play().catch(() => {})
          setStatus("success", `Audio ready — ${data.engine.id} synthesized ${data.synthesis.text_length} chars in ${data.timings.total_ms} ms.`)
        }
      } catch (error) {
        renderTtsIdle()
        audioStatus.hidden = false
        audioStatus.textContent = "Synthesis failed. Check that the Piper model is configured."
        setStatus("error", error.message || "Unable to synthesize audio.")
      } finally {
        synthesizeButton.disabled = false
        synthesizeButton.textContent = "Synthesize"
      }
    }

    synthesizeButton.addEventListener("click", runSynthesis)

    resetButton.addEventListener("click", () => {
      inputField.value = "You stand at the threshold of a vast and luminous cosmos."
      personaSelect.value = selectedPersonaId
      engineSelect.value = ""
      dryRunCheckbox.checked = false
      const existing = audioContainer.querySelector("audio")
      if (existing) existing.remove()
      audioStatus.hidden = false
      audioStatus.textContent = "Run a synthesis request to hear the TTS output."
      renderTtsIdle()
      setStatus(null, "")
    })

    renderTtsIdle()
  }

  async function renderConversationPage() {
    const [config, overview] = await Promise.all([fetchJson("/api/v1/config"), loadOverview()])
    pageBody.innerHTML = ""

    const enabledProviders = Object.entries(config.providers.llm.providers).filter(([, provider]) => provider.enabled)
    const selectedPersonaId = getRememberedPersona(config.personas.personas, config.personas.default_persona_id)
    const defaultTextPrompt = "Guide me through the current Deep Space setup and confirm which persona is active."
    const sttDefaultEngineId = config.providers.stt.default_engine || ""
    const sttDefaultEngine = sttDefaultEngineId ? config.providers.stt.engines[sttDefaultEngineId] : null

    pageBody.appendChild(
      createStatsGrid([
        { eyebrow: "Persona", title: "Default persona", value: config.personas.default_persona_id || "Not set" },
        { eyebrow: "LLM", title: "Configured default", value: config.providers.llm.default_provider || "Not set" },
        { eyebrow: "Fallback", title: "Fallback provider", value: config.providers.llm.fallback_provider || "None" },
        { eyebrow: "STT", title: "Configured engine", value: sttDefaultEngineId || "Not set" },
      ])
    )

    const panel = document.createElement("section")
    panel.className = "panel conversation-shell"
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Text LLM validation</p>
          <h3 class="panel-title">Conversation test bench</h3>
        </div>
        <div class="panel-actions">
          <button class="secondary-button" id="conversation-reset" type="button">Reset</button>
          <button class="primary-button" id="conversation-submit" type="button">Run text conversation</button>
        </div>
      </div>
      <p class="panel-copy">${escapeHtml(overview.roadmap_notes.conversation_test)}</p>
      <div class="field-row">
        <label>
          Active persona
          <select id="conversation-persona"></select>
        </label>
        <label>
          Provider override
          <select id="conversation-provider">
            <option value="">Use configured default (${escapeHtml(config.providers.llm.default_provider || "none")})</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label>
          Dry run
          <input id="conversation-dry-run" type="checkbox" checked />
        </label>
        <label>
          Request target
          <input id="conversation-payload-readonly" type="text" value="POST /api/v1/conversation/text" readonly />
        </label>
      </div>
      <label>
        User message
        <textarea class="conversation-input" id="conversation-input" spellcheck="true">${escapeHtml(defaultTextPrompt)}</textarea>
      </label>
      <label>
        Request body preview
        <textarea class="preview-area" id="conversation-preview" readonly></textarea>
      </label>
    `
    pageBody.appendChild(panel)

    const sttPanel = document.createElement("section")
    sttPanel.className = "panel conversation-shell"
    sttPanel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Local STT validation</p>
          <h3 class="panel-title">Browser microphone bench</h3>
        </div>
        <div class="panel-actions">
          <button class="secondary-button" id="conversation-transcript-clear" type="button">Clear transcript</button>
          <button class="primary-button" id="conversation-mic-toggle" type="button">Start microphone</button>
        </div>
      </div>
      <p class="panel-copy">Record a short browser microphone sample, send the raw audio directly to the backend, and transcribe it locally with the configured STT engine. The detected transcript is copied into the text conversation input so you can continue into the LLM step immediately.</p>
      <div class="field-row">
        <label>
          Transcription target
          <input id="conversation-transcribe-target" type="text" value="POST /api/v1/conversation/transcribe" readonly />
        </label>
        <label>
          Active STT engine
          <input id="conversation-stt-engine" type="text" value="${escapeHtml(sttDefaultEngineId || "Not set")}${sttDefaultEngine ? ` (${escapeHtml(sttDefaultEngine.backend)})` : ""}" readonly />
        </label>
      </div>
      <section class="audio-status-card">
        <p class="eyebrow">Microphone status</p>
        <p class="mic-status" id="conversation-mic-status">Idle. Raw audio is not persisted unless debug audio capture is explicitly enabled in Settings.</p>
      </section>
    `
    pageBody.appendChild(sttPanel)

    const sttGrid = document.createElement("section")
    sttGrid.className = "two-column-grid"
    sttGrid.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Speech-to-text</p>
            <h3 class="panel-title">Detected transcript</h3>
          </div>
        </div>
        <textarea class="preview-area conversation-output conversation-transcript" id="conversation-transcript" readonly></textarea>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">STT metadata</p>
            <h3 class="panel-title">Language and timings</h3>
          </div>
        </div>
        <dl class="key-value" id="conversation-stt-meta"></dl>
      </section>
    `
    pageBody.appendChild(sttGrid)

    const resultGrid = document.createElement("section")
    resultGrid.className = "two-column-grid"
    resultGrid.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Execution</p>
            <h3 class="panel-title">Resolved context</h3>
          </div>
        </div>
        <dl class="key-value" id="conversation-meta"></dl>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Timings</p>
            <h3 class="panel-title">Latency readout</h3>
          </div>
        </div>
        <dl class="key-value" id="conversation-timings"></dl>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">LLM response</p>
            <h3 class="panel-title">Text output</h3>
          </div>
        </div>
        <textarea class="preview-area conversation-output" id="conversation-response" readonly></textarea>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Dry run</p>
            <h3 class="panel-title">Final prompt</h3>
          </div>
        </div>
        <textarea class="preview-area conversation-output" id="conversation-prompt" readonly></textarea>
      </section>
    `
    pageBody.appendChild(resultGrid)

    // -----------------------------------------------------------------------
    // Voice pipeline bench (full micro → STT → LLM → TTS → audio loop)
    // -----------------------------------------------------------------------

    const ttsEnginesEnabled = Object.entries(config.providers.tts.engines)
      .filter(([, e]) => e.enabled)
      .map(([id]) => id)

    const pipelinePanel = document.createElement("section")
    pipelinePanel.className = "panel conversation-shell"
    pipelinePanel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Full voice pipeline</p>
          <h3 class="panel-title">Voice conversation bench</h3>
        </div>
        <div class="panel-actions">
          <button class="secondary-button" id="pipeline-interrupt" type="button" disabled>Interrupt</button>
          <button class="primary-button" id="pipeline-mic-toggle" type="button">Record and run pipeline</button>
        </div>
      </div>
      <p class="panel-copy">Record from the browser microphone and run the complete pipeline: STT → LLM → TTS → audio. Each stage result and timing is shown below. This is the full voice interaction loop without launching Deep Space VR.</p>
      <div class="field-row">
        <label>
          Active persona
          <select id="pipeline-persona"></select>
        </label>
        <label>
          TTS engine override
          <select id="pipeline-tts-engine">
            <option value="">Use persona / configured default</option>
            ${ttsEnginesEnabled.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="field-row">
        <label>
          LLM provider override
          <select id="pipeline-provider">
            <option value="">Use configured default (${escapeHtml(config.providers.llm.default_provider || "none")})</option>
            ${enabledProviders.map(([pId, prov]) => {
              const modelSuffix = prov.model ? ` (${escapeHtml(prov.model)})` : ""
              return `<option value="${escapeHtml(pId)}">${escapeHtml(pId)}${modelSuffix}</option>`
            }).join("")}
          </select>
        </label>
        <label>
          Dry run (skip audio synthesis)
          <input id="pipeline-dry-run" type="checkbox" />
        </label>
      </div>
      <section class="audio-status-card">
        <p class="eyebrow">Pipeline status</p>
        <p class="mic-status" id="pipeline-status">Idle. Click "Record and run pipeline" to capture microphone audio and run the full voice loop.</p>
      </section>
    `
    pageBody.appendChild(pipelinePanel)

    // Stage progress row
    const pipelineStageRow = document.createElement("section")
    pipelineStageRow.className = "panel"
    pipelineStageRow.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Pipeline stages</p>
          <h3 class="panel-title">Execution progress</h3>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:12px; padding:0.5rem 0; flex-wrap:wrap;">
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span id="pipeline-badge-stt" class="persona-chip" style="font-size:0.75rem;">STT</span>
          <span style="font-size:0.8rem; color:var(--muted);">Speech to text</span>
        </span>
        <span style="color:var(--muted);">→</span>
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span id="pipeline-badge-llm" class="persona-chip" style="font-size:0.75rem;">LLM</span>
          <span style="font-size:0.8rem; color:var(--muted);">Language model</span>
        </span>
        <span style="color:var(--muted);">→</span>
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span id="pipeline-badge-tts" class="persona-chip" style="font-size:0.75rem;">TTS</span>
          <span style="font-size:0.8rem; color:var(--muted);">Text to speech</span>
        </span>
        <span style="color:var(--muted);">→</span>
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span id="pipeline-badge-audio" class="persona-chip" style="font-size:0.75rem;">Audio</span>
          <span style="font-size:0.8rem; color:var(--muted);">Playback</span>
        </span>
      </div>
    `
    pageBody.appendChild(pipelineStageRow)

    const pipelineResultGrid = document.createElement("section")
    pipelineResultGrid.className = "two-column-grid"
    pipelineResultGrid.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Stage outputs</p>
            <h3 class="panel-title">Transcript · Response · Audio</h3>
          </div>
        </div>
        <dl class="key-value" style="margin-bottom:0.75rem;">
          <div><dt>Transcript (STT)</dt><dd id="pipeline-transcript">—</dd></div>
          <div><dt>Language</dt><dd id="pipeline-language">—</dd></div>
        </dl>
        <textarea class="preview-area conversation-output" id="pipeline-response" readonly placeholder="LLM response will appear here after a successful run."></textarea>
        <div id="pipeline-audio-container" style="padding:0.5rem 0;">
          <p class="panel-copy" id="pipeline-audio-status" style="margin:0;">Audio output will appear here after a successful run.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Timings and metadata</p>
            <h3 class="panel-title">Per-stage breakdown</h3>
          </div>
        </div>
        <dl class="key-value" id="pipeline-meta"></dl>
      </section>
    `
    pageBody.appendChild(pipelineResultGrid)

    const pipelineDryRunPanel = document.createElement("section")
    pipelineDryRunPanel.className = "panel"
    pipelineDryRunPanel.id = "pipeline-dry-run-panel"
    pipelineDryRunPanel.hidden = true
    pipelineDryRunPanel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Dry run inspector</p>
          <h3 class="panel-title">Final LLM prompt</h3>
        </div>
      </div>
      <textarea class="preview-area conversation-output" id="pipeline-prompt" readonly></textarea>
    `
    pageBody.appendChild(pipelineDryRunPanel)

    // -- Pipeline state --
    let pipelineMediaRecorder = null
    let pipelineMediaStream = null
    let pipelineAudioChunks = []
    let activePipelineSessionId = ""

    // -- Pipeline DOM refs --
    const pipelineMicToggle = pipelinePanel.querySelector("#pipeline-mic-toggle")
    const pipelineInterruptBtn = pipelinePanel.querySelector("#pipeline-interrupt")
    const pipelineDryRunCheckbox = pipelinePanel.querySelector("#pipeline-dry-run")
    const pipelineStatusField = pipelinePanel.querySelector("#pipeline-status")
    const pipelinePersonaSelect = pipelinePanel.querySelector("#pipeline-persona")
    const pipelineProviderSelect = pipelinePanel.querySelector("#pipeline-provider")
    const pipelineTtsEngineSelect = pipelinePanel.querySelector("#pipeline-tts-engine")
    const pipelineTranscriptField = pipelineResultGrid.querySelector("#pipeline-transcript")
    const pipelineLanguageField = pipelineResultGrid.querySelector("#pipeline-language")
    const pipelineResponseField = pipelineResultGrid.querySelector("#pipeline-response")
    const pipelineAudioContainer = pipelineResultGrid.querySelector("#pipeline-audio-container")
    const pipelineAudioStatus = pipelineResultGrid.querySelector("#pipeline-audio-status")
    const pipelineMetaField = pipelineResultGrid.querySelector("#pipeline-meta")
    const pipelinePromptField = pipelineDryRunPanel.querySelector("#pipeline-prompt")
    const badgeStt = pipelineStageRow.querySelector("#pipeline-badge-stt")
    const badgeLlm = pipelineStageRow.querySelector("#pipeline-badge-llm")
    const badgeTts = pipelineStageRow.querySelector("#pipeline-badge-tts")
    const badgeAudio = pipelineStageRow.querySelector("#pipeline-badge-audio")

    pipelinePersonaSelect.innerHTML = config.personas.personas
      .map((persona) => {
        const selected = persona.id === selectedPersonaId ? "selected" : ""
        return `<option value="${escapeHtml(persona.id)}" ${selected}>${escapeHtml(persona.name)}</option>`
      })
      .join("")

    function setBadge(badge, status) {
      const styles = {
        pending: "background:rgba(148,172,197,0.15); color:var(--muted);",
        active: "background:rgba(88,210,255,0.25); color:var(--accent); font-weight:600;",
        done: "background:rgba(138,245,174,0.2); color:var(--success);",
        error: "background:rgba(255,128,128,0.2); color:var(--danger);",
      }
      badge.style.cssText = `font-size:0.75rem; ${styles[status] || styles.pending}`
    }

    function resetPipelineBadges() {
      [badgeStt, badgeLlm, badgeTts, badgeAudio].forEach((b) => setBadge(b, "pending"))
    }

    function createPipelineMetaRows(entries) {
      return entries.map((e) => `<div><dt>${escapeHtml(e.label)}</dt><dd>${escapeHtml(String(e.value))}</dd></div>`).join("")
    }

    function formatInjectedMemories(memories) {
      if (!Array.isArray(memories) || !memories.length) {
        return "[]"
      }
      return prettyJson(memories.map((memory) => ({
        id: memory.id,
        score: memory.score,
        scope: memory.persona_id || "global",
        source: memory.source,
        tags: memory.tags || [],
        content: memory.content,
        embedding: memory.embedding || {},
      })))
    }

    function renderPipelineIdle() {
      resetPipelineBadges()
      pipelineTranscriptField.textContent = "—"
      pipelineLanguageField.textContent = "—"
      pipelineResponseField.value = ""
      pipelineAudioStatus.hidden = false
      pipelineAudioStatus.textContent = "Audio output will appear here after a successful run."
      const existingAudio = pipelineAudioContainer.querySelector("audio")
      if (existingAudio) existingAudio.remove()
      pipelineDryRunPanel.hidden = true
      pipelinePromptField.value = ""
      pipelineMetaField.innerHTML = createPipelineMetaRows([
        { label: "STT engine", value: "Pending" },
        { label: "STT language", value: "Pending" },
        { label: "STT duration", value: "Pending" },
        { label: "LLM provider", value: "Pending" },
        { label: "LLM model", value: "Pending" },
        { label: "LLM fallback", value: "Pending" },
        { label: "LLM duration", value: "Pending" },
        { label: "TTS engine", value: "Pending" },
        { label: "TTS voice", value: "Pending" },
        { label: "TTS duration", value: "Pending" },
        { label: "Total", value: "Pending" },
      ])
    }

    function renderPipelineResult(data) {
      const stt = data.stages.stt
      const llm = data.stages.llm
      const tts = data.stages.tts
      const t = data.timings

      setBadge(badgeStt, "done")
      setBadge(badgeLlm, "done")
      setBadge(badgeTts, data.dry_run ? "pending" : "done")
      setBadge(badgeAudio, data.dry_run ? "pending" : "done")

      pipelineTranscriptField.textContent = stt.transcript || "—"
      const langSupported = stt.language_supported ? "" : " (outside supported set)"
      pipelineLanguageField.textContent = `${stt.language || "unknown"}${langSupported} · ${Math.round((stt.language_probability || 0) * 100)}%`

      pipelineResponseField.value = llm.response_text || ""

      if (!data.dry_run && data.audio && data.audio.audio_base64) {
        const audioEl = document.createElement("audio")
        audioEl.controls = true
        audioEl.src = `data:${data.audio.content_type};base64,${data.audio.audio_base64}`
        audioEl.style.width = "100%"
        const existing = pipelineAudioContainer.querySelector("audio")
        if (existing) existing.remove()
        pipelineAudioStatus.hidden = true
        pipelineAudioContainer.appendChild(audioEl)
        audioEl.play().catch(() => {})
      } else if (data.dry_run) {
        pipelineAudioStatus.hidden = false
        pipelineAudioStatus.textContent = "Dry run — TTS stage skipped, no audio generated."
      }

      if (data.dry_run && llm.prompt_final) {
        pipelineDryRunPanel.hidden = false
        pipelinePromptField.value = `${llm.prompt_final}\n\n[INJECTED MEMORIES DEBUG]\n${formatInjectedMemories(llm.injected_memories)}`
      }

      pipelineMetaField.innerHTML = createPipelineMetaRows([
        { label: "STT engine", value: `${stt.engine_id} (${stt.engine_backend})` },
        { label: "STT model", value: stt.model || "Default" },
        { label: "STT language", value: `${stt.language || "unknown"} · ${Math.round((stt.language_probability || 0) * 100)}%` },
        { label: "STT duration", value: `${t.stt_ms} ms` },
        { label: "LLM provider", value: `${llm.provider_id} (${llm.provider_kind})` },
        { label: "LLM model", value: llm.model || "Unset" },
        { label: "LLM fallback", value: llm.fallback_used ? "Used" : "Not used" },
        { label: "Injected memories", value: Array.isArray(llm.injected_memories) ? String(llm.injected_memories.length) : "0" },
        { label: "LLM duration", value: `${t.llm_ms} ms` },
        { label: "TTS engine", value: data.dry_run ? "Skipped (dry run)" : `${tts.engine_id} (${tts.engine_backend})` },
        { label: "TTS voice", value: data.dry_run ? "—" : tts.voice_id || "Default" },
        { label: "TTS duration", value: data.dry_run ? "—" : `${t.tts_ms} ms` },
        { label: "Total", value: `${t.total_ms} ms` },
      ])
    }

    function cleanupPipelineMic() {
      if (pipelineMediaStream) {
        pipelineMediaStream.getTracks().forEach((track) => track.stop())
      }
      pipelineMediaRecorder = null
      pipelineMediaStream = null
      pipelineAudioChunks = []
    }

    function buildPipelineFilename(blobType) {
      const ext = { "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/webm": "webm" }[(blobType || "").split(";", 1)[0].trim().toLowerCase()] || "webm"
      return `pipeline-${Date.now()}.${ext}`
    }

    async function sendPipelineAudio(audioBlob) {
      const contentType = audioBlob.type || "audio/webm"
      const personaId = pipelinePersonaSelect.value
      const providerId = pipelineProviderSelect.value
      const ttsEngineId = pipelineTtsEngineSelect.value
      const isDryRun = pipelineDryRunCheckbox.checked
      const sessionId = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      activePipelineSessionId = sessionId

      const url = new URL("/api/v1/conversation/voice", window.location.origin)
      if (personaId) url.searchParams.set("persona_id", personaId)
      if (providerId) url.searchParams.set("provider_id", providerId)
      if (ttsEngineId) url.searchParams.set("tts_engine_id", ttsEngineId)
      if (isDryRun) url.searchParams.set("dry_run", "true")
      url.searchParams.set("session_id", sessionId)

      pipelineInterruptBtn.disabled = false
      setBadge(badgeStt, "active")
      pipelineStatusField.textContent = "STT: transcribing audio..."

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "X-Audio-Filename": buildPipelineFilename(contentType),
        },
        body: audioBlob,
      })

      activePipelineSessionId = ""
      pipelineInterruptBtn.disabled = true

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.detail || `Pipeline failed: HTTP ${response.status}`)
      }

      return response.json()
    }

    async function stopAndRunPipeline() {
      if (!pipelineMediaRecorder) return

      const recorder = pipelineMediaRecorder
      pipelineMicToggle.disabled = true
      pipelineMicToggle.textContent = "Running pipeline..."
      pipelineStatusField.textContent = "Stopping microphone and uploading audio..."

      const stopPromise = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true })
        recorder.addEventListener("error", (e) => reject(e.error || new Error("MediaRecorder error")), { once: true })
      })

      try {
        recorder.stop()
        await stopPromise

        const recordedBlob = new Blob(pipelineAudioChunks, { type: recorder.mimeType || pickRecordingMimeType() || "audio/webm" })
        cleanupPipelineMic()

        if (!recordedBlob.size) {
          pipelineStatusField.textContent = "No audio captured. Try recording a slightly longer sample."
          setStatus("error", "No audio captured in pipeline bench.")
          return
        }

        const data = await sendPipelineAudio(recordedBlob)

        if (data.interrupted) {
          resetPipelineBadges()
          pipelineStatusField.textContent = `Pipeline interrupted: ${data.interrupted_reason || "session cancelled"}`
          setStatus("success", "Pipeline was interrupted before completion.")
          return
        }

        setBadge(badgeStt, "done")
        setBadge(badgeLlm, "done")
        setBadge(data.dry_run ? badgeTts : badgeAudio, "done")

        renderPipelineResult(data)
        pipelineStatusField.textContent = `Pipeline complete in ${data.timings.total_ms} ms. STT: ${data.timings.stt_ms} ms · LLM: ${data.timings.llm_ms} ms · TTS: ${data.timings.tts_ms} ms`
        setStatus("success", `Voice pipeline completed on persona ${data.persona_id} in ${data.timings.total_ms} ms.`)
      } catch (error) {
        cleanupPipelineMic()
        activePipelineSessionId = ""
        pipelineInterruptBtn.disabled = true
        resetPipelineBadges()
        pipelineStatusField.textContent = "Pipeline failed. Check console and service logs."
        setStatus("error", error.message || "Voice pipeline encountered an error.")
      } finally {
        pipelineMicToggle.disabled = false
        pipelineMicToggle.textContent = "Record and run pipeline"
      }
    }

    async function startPipelineRecording() {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        setStatus("error", "Microphone capture is not available in this browser.")
        return
      }

      const mimeType = pickRecordingMimeType()
      try {
        pipelineMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        pipelineAudioChunks = []
        pipelineMediaRecorder = mimeType
          ? new window.MediaRecorder(pipelineMediaStream, { mimeType })
          : new window.MediaRecorder(pipelineMediaStream)
        pipelineMediaRecorder.addEventListener("dataavailable", (e) => {
          if (e.data && e.data.size > 0) pipelineAudioChunks.push(e.data)
        })
        pipelineMediaRecorder.start()
        pipelineMicToggle.textContent = "Stop and run pipeline"
        pipelineStatusField.textContent = "Recording from microphone. Click again to stop and run the full pipeline."
        resetPipelineBadges()
        setStatus("success", "Pipeline microphone started.")
      } catch (error) {
        cleanupPipelineMic()
        setStatus("error", error.message || "Unable to start microphone capture.")
      }
    }

    async function togglePipelineMic() {
      if (pipelineMediaRecorder && pipelineMediaRecorder.state === "recording") {
        await stopAndRunPipeline()
        return
      }
      await startPipelineRecording()
    }

    async function interruptPipeline() {
      if (!activePipelineSessionId) return
      try {
        await fetchJson("/api/v1/conversation/interrupt", {
          method: "POST",
          body: JSON.stringify({ session_id: activePipelineSessionId }),
        })
        pipelineStatusField.textContent = "Interrupt signal sent. Pipeline will stop before the next stage."
        setStatus("success", "Interrupt signal sent to the pipeline.")
      } catch (error) {
        setStatus("error", error.message || "Unable to send interrupt signal.")
      }
    }

    pipelineMicToggle.addEventListener("click", togglePipelineMic)
    pipelineInterruptBtn.addEventListener("click", interruptPipeline)

    // -----------------------------------------------------------------------
    // Continuous conversation prototype (wake word + VAD + barge-in)
    // -----------------------------------------------------------------------

    const continuousPanel = document.createElement("section")
    continuousPanel.className = "panel conversation-shell"
    continuousPanel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Lot 12 prototype</p>
          <h3 class="panel-title">Continuous voice mode</h3>
        </div>
        <div class="panel-actions">
          <button class="secondary-button" id="continuous-reset" type="button">Reset session</button>
          <button class="primary-button" id="continuous-toggle" type="button">Start continuous mode</button>
        </div>
      </div>
      <p class="panel-copy">Listen in short browser chunks, wait for the configured wake word, keep the session activated, and send barge-in signals when speech is detected during assistant playback.</p>
      <div class="field-row">
        <label>
          Active persona
          <select id="continuous-persona"></select>
        </label>
        <label>
          LLM provider override
          <select id="continuous-provider">
            <option value="">Use configured default (${escapeHtml(config.providers.llm.default_provider || "none")})</option>
            ${enabledProviders.map(([pId, prov]) => {
              const modelSuffix = prov.model ? ` (${escapeHtml(prov.model)})` : ""
              return `<option value="${escapeHtml(pId)}">${escapeHtml(pId)}${modelSuffix}</option>`
            }).join("")}
          </select>
        </label>
      </div>
      <div class="field-row">
        <label>
          TTS engine override
          <select id="continuous-tts-engine">
            <option value="">Use persona / configured default</option>
            ${ttsEnginesEnabled.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")}
          </select>
        </label>
        <label>
          Dry run
          <input id="continuous-dry-run" type="checkbox" />
        </label>
      </div>
      <section class="audio-status-card">
        <p class="eyebrow">Continuous status</p>
        <p class="mic-status" id="continuous-status">Idle. Wake word: ${escapeHtml(config.voice.wake_word.enabled ? config.voice.wake_word.phrase : "disabled")}.</p>
      </section>
      <dl class="key-value" id="continuous-meta" style="margin-top:12px;"></dl>
    `
    pageBody.appendChild(continuousPanel)

    let continuousRecorder = null
    let continuousStream = null
    let continuousRunning = false
    let continuousSessionId = `continuous-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    let continuousAssistantSpeaking = false
    let continuousAudio = null

    const continuousToggle = continuousPanel.querySelector("#continuous-toggle")
    const continuousReset = continuousPanel.querySelector("#continuous-reset")
    const continuousStatus = continuousPanel.querySelector("#continuous-status")
    const continuousPersonaSelect = continuousPanel.querySelector("#continuous-persona")
    const continuousProviderSelect = continuousPanel.querySelector("#continuous-provider")
    const continuousTtsEngineSelect = continuousPanel.querySelector("#continuous-tts-engine")
    const continuousDryRunCheckbox = continuousPanel.querySelector("#continuous-dry-run")
    const continuousMeta = continuousPanel.querySelector("#continuous-meta")

    continuousPersonaSelect.innerHTML = config.personas.personas
      .map((persona) => {
        const selected = persona.id === selectedPersonaId ? "selected" : ""
        return `<option value="${escapeHtml(persona.id)}" ${selected}>${escapeHtml(persona.name)}</option>`
      })
      .join("")

    function renderContinuousMeta(entries) {
      continuousMeta.innerHTML = createPipelineMetaRows(entries)
    }

    async function sendContinuousChunk(blob) {
      if (!continuousRunning || !blob.size) return
      const url = new URL("/api/v1/conversation/voice-mode", window.location.origin)
      url.searchParams.set("mode", "continuous_conversation")
      url.searchParams.set("session_id", continuousSessionId)
      url.searchParams.set("run_pipeline", "true")
      if (continuousPersonaSelect.value) url.searchParams.set("persona_id", continuousPersonaSelect.value)
      if (continuousProviderSelect.value) url.searchParams.set("provider_id", continuousProviderSelect.value)
      if (continuousTtsEngineSelect.value) url.searchParams.set("tts_engine_id", continuousTtsEngineSelect.value)
      if (continuousAssistantSpeaking) url.searchParams.set("assistant_speaking", "true")
      if (continuousDryRunCheckbox.checked) url.searchParams.set("dry_run", "true")

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": blob.type || "audio/webm",
          "X-Audio-Filename": buildPipelineFilename(blob.type || "audio/webm"),
        },
        body: blob,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.detail || `Continuous mode failed: HTTP ${response.status}`)
      }

      const data = await response.json()
      const vad = data.vad || {}
      const wake = data.wake_word || {}
      renderContinuousMeta([
        { label: "Session", value: continuousSessionId },
        { label: "Status", value: data.status },
        { label: "Speech", value: vad.speech_detected ? "Detected" : "Silence" },
        { label: "VAD reason", value: vad.reason || "n/a" },
        { label: "Wake word", value: wake.enabled === false ? "Disabled" : wake.detected ? "Detected" : "Waiting" },
        { label: "Assistant speaking", value: continuousAssistantSpeaking ? "Yes" : "No" },
      ])

      if (data.status === "silence") {
        continuousStatus.textContent = "Listening: silence detected."
        return
      }
      if (data.status === "waiting_for_wake_word") {
        continuousStatus.textContent = `Listening for wake word "${config.voice.wake_word.phrase}".`
        return
      }
      if (data.status === "barge_in") {
        if (continuousAudio) {
          continuousAudio.pause()
          continuousAudio.currentTime = 0
        }
        continuousAssistantSpeaking = false
        continuousStatus.textContent = "Barge-in detected. Assistant playback interrupted."
        setStatus("success", "Continuous mode interrupted assistant playback.")
        return
      }
      if (data.pipeline) {
        renderPipelineResult(data.pipeline)
        continuousStatus.textContent = `Continuous turn complete: ${data.pipeline.timings.total_ms} ms.`
        if (data.pipeline.audio && data.pipeline.audio.audio_base64) {
          continuousAudio = pipelineAudioContainer.querySelector("audio")
          continuousAssistantSpeaking = true
          if (continuousAudio) {
            continuousAudio.addEventListener("ended", () => {
              continuousAssistantSpeaking = false
              continuousStatus.textContent = "Assistant finished. Listening for the next user turn."
            }, { once: true })
          }
        }
      } else if (data.activated) {
        continuousStatus.textContent = "Wake word accepted. Continuous session is active."
      }
    }

    async function startContinuousMode() {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        setStatus("error", "Microphone capture is not available in this browser.")
        return
      }
      const mimeType = pickRecordingMimeType()
      try {
        continuousStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        continuousRecorder = mimeType
          ? new window.MediaRecorder(continuousStream, { mimeType })
          : new window.MediaRecorder(continuousStream)
        continuousRecorder.addEventListener("dataavailable", (event) => {
          if (!event.data || !event.data.size) return
          sendContinuousChunk(event.data).catch((error) => {
            continuousStatus.textContent = "Continuous mode failed."
            setStatus("error", error.message || "Continuous mode error.")
          })
        })
        continuousRecorder.start(2800)
        continuousRunning = true
        continuousToggle.textContent = "Stop continuous mode"
        continuousStatus.textContent = `Listening for wake word "${config.voice.wake_word.phrase}".`
        renderContinuousMeta([{ label: "Session", value: continuousSessionId }])
      } catch (error) {
        stopContinuousMode()
        setStatus("error", error.message || "Unable to start continuous mode.")
      }
    }

    function stopContinuousMode() {
      continuousRunning = false
      if (continuousRecorder && continuousRecorder.state !== "inactive") {
        continuousRecorder.stop()
      }
      if (continuousStream) {
        continuousStream.getTracks().forEach((track) => track.stop())
      }
      continuousRecorder = null
      continuousStream = null
      continuousToggle.textContent = "Start continuous mode"
      continuousStatus.textContent = "Continuous mode stopped."
      continuousAssistantSpeaking = false
    }

    continuousToggle.addEventListener("click", async () => {
      if (continuousRunning) {
        stopContinuousMode()
      } else {
        await startContinuousMode()
      }
    })

    continuousReset.addEventListener("click", () => {
      stopContinuousMode()
      continuousSessionId = `continuous-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      continuousStatus.textContent = `Session reset. Wake word: ${config.voice.wake_word.enabled ? config.voice.wake_word.phrase : "disabled"}.`
      renderContinuousMeta([{ label: "Session", value: continuousSessionId }])
    })

    renderPipelineIdle()
    renderContinuousMeta([{ label: "Session", value: continuousSessionId }])

    // -----------------------------------------------------------------------
    // End of voice pipeline bench
    // -----------------------------------------------------------------------

    const personaSelect = panel.querySelector("#conversation-persona")
    const providerSelect = panel.querySelector("#conversation-provider")
    const dryRunCheckbox = panel.querySelector("#conversation-dry-run")
    const inputField = panel.querySelector("#conversation-input")
    const previewField = panel.querySelector("#conversation-preview")
    const submitButton = panel.querySelector("#conversation-submit")
    const resetButton = panel.querySelector("#conversation-reset")
    const micToggleButton = sttPanel.querySelector("#conversation-mic-toggle")
    const clearTranscriptButton = sttPanel.querySelector("#conversation-transcript-clear")
    const micStatusField = sttPanel.querySelector("#conversation-mic-status")
    const transcriptField = sttGrid.querySelector("#conversation-transcript")
    const sttMetaField = sttGrid.querySelector("#conversation-stt-meta")
    const metaField = resultGrid.querySelector("#conversation-meta")
    const timingsField = resultGrid.querySelector("#conversation-timings")
    const responseField = resultGrid.querySelector("#conversation-response")
    const promptField = resultGrid.querySelector("#conversation-prompt")
    let mediaRecorder = null
    let mediaStream = null
    let audioChunks = []

    personaSelect.innerHTML = config.personas.personas
      .map((persona) => {
        const selected = persona.id === selectedPersonaId ? "selected" : ""
        return `<option value="${escapeHtml(persona.id)}" ${selected}>${escapeHtml(persona.name)}</option>`
      })
      .join("")

    providerSelect.innerHTML += enabledProviders
      .map(([providerId, provider]) => {
        const modelSuffix = provider.model ? ` (${escapeHtml(provider.model)})` : ""
        return `<option value="${escapeHtml(providerId)}">${escapeHtml(providerId)}${modelSuffix}</option>`
      })
      .join("")

    function createRows(entries) {
      return entries
        .map(
          (entry) => `
            <div>
              <dt>${escapeHtml(entry.label)}</dt>
              <dd>${escapeHtml(entry.value)}</dd>
            </div>
          `
        )
        .join("")
    }

    function buildPayload() {
      const providerId = providerSelect.value.trim()
      return {
        persona_id: personaSelect.value,
        dry_run: dryRunCheckbox.checked,
        message: inputField.value.trim(),
        ...(providerId ? { provider_id: providerId } : {}),
      }
    }

    function updatePreview() {
      previewField.value = prettyJson(buildPayload())
    }

    function renderTranscription(payload = null) {
      if (!payload) {
        transcriptField.value = "Record a short browser microphone sample to see the local transcript here."
        sttMetaField.innerHTML = createRows([
          { label: "Engine", value: "Pending" },
          { label: "Backend", value: "Pending" },
          { label: "Model", value: "Pending" },
          { label: "Language", value: "Pending" },
          { label: "Confidence", value: "Pending" },
          { label: "Supported", value: "Pending" },
          { label: "Audio duration", value: "Pending" },
          { label: "Payload size", value: "Pending" },
          { label: "Transcription", value: "Pending" },
          { label: "Total", value: "Pending" },
        ])
        return
      }

      const confidencePercent = `${Math.round((payload.transcript.language_probability || 0) * 100)}%`
      transcriptField.value = payload.transcript.text || ""
      sttMetaField.innerHTML = createRows([
        { label: "Engine", value: payload.engine.id || "Not set" },
        { label: "Backend", value: payload.engine.backend || "Not set" },
        { label: "Model", value: payload.engine.model || "Unset" },
        {
          label: "Language",
          value: `${payload.transcript.language || "unknown"}${payload.transcript.language_supported ? "" : " (outside supported set)"}`,
        },
        { label: "Confidence", value: confidencePercent },
        { label: "Supported", value: payload.transcript.language_supported ? "Yes" : "No" },
        { label: "Audio duration", value: `${payload.audio.duration_seconds} s` },
        { label: "Payload size", value: `${payload.audio.size_bytes} bytes` },
        { label: "Transcription", value: `${payload.timings.transcription_ms} ms` },
        { label: "Total", value: `${payload.timings.total_ms} ms` },
      ])
    }

    function renderResult(payload = null) {
      if (!payload) {
        metaField.innerHTML = createRows([
          { label: "Persona", value: "No request executed yet" },
          { label: "Tone", value: "Pending" },
          { label: "Voice style", value: "Pending" },
          { label: "Memory scope", value: "Pending" },
          { label: "Tools mode", value: "Pending" },
          { label: "Provider", value: "Pending" },
          { label: "Model", value: "Pending" },
          { label: "Fallback", value: "Pending" },
          { label: "Injected memories", value: "Pending" },
          { label: "Attempts", value: "Pending" },
        ])
        timingsField.innerHTML = createRows([
          { label: "Prompt build", value: "Pending" },
          { label: "Provider", value: "Pending" },
          { label: "LLM total", value: "Pending" },
          { label: "Total", value: "Pending" },
        ])
        responseField.value = "Run a text conversation to see the LLM response."
        promptField.value = "Enable dry run and run a request to inspect the assembled prompt."
        return
      }

      metaField.innerHTML = createRows([
        { label: "Persona", value: `${payload.persona.name} (${payload.persona.id})` },
        { label: "Language", value: payload.persona.preferred_language || "Not set" },
        { label: "Tone", value: payload.persona.style && payload.persona.style.tone ? payload.persona.style.tone : "Not set" },
        { label: "Voice style", value: payload.persona.voice && payload.persona.voice.style ? payload.persona.voice.style : "Not set" },
        { label: "Memory scope", value: payload.persona.memory && payload.persona.memory.scope ? payload.persona.memory.scope : "Not set" },
        { label: "Tools mode", value: payload.persona.tools && payload.persona.tools.mode ? payload.persona.tools.mode : "Not set" },
        { label: "Provider", value: payload.provider.id },
        { label: "Model", value: payload.provider.model || "Unset" },
        { label: "Fallback", value: payload.fallback_used ? "Used" : "Not used" },
        { label: "Injected memories", value: Array.isArray(payload.injected_memories) ? String(payload.injected_memories.length) : "0" },
        { label: "Attempts", value: payload.attempted_providers.join(", ") || "None" },
      ])
      timingsField.innerHTML = createRows([
        { label: "Prompt build", value: `${payload.timings.prompt_build_ms} ms` },
        { label: "Provider", value: `${payload.timings.provider_ms} ms` },
        { label: "LLM total", value: `${payload.timings.llm_total_ms} ms` },
        { label: "Total", value: `${payload.timings.total_ms} ms` },
      ])
      responseField.value = payload.response_text || ""
      promptField.value = payload.dry_run && payload.dry_run.enabled
        ? `${payload.dry_run.prompt_final}\n\n[INJECTED MEMORIES DEBUG]\n${formatInjectedMemories(payload.dry_run.injected_memories)}`
        : "Dry run was disabled for this request. Enable it to inspect the final prompt."
    }

    function pickRecordingMimeType() {
      if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== "function") {
        return ""
      }

      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ]
      return candidates.find((candidate) => window.MediaRecorder.isTypeSupported(candidate)) || ""
    }

    function cleanupMicrophoneCapture() {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop())
      }
      mediaRecorder = null
      mediaStream = null
      audioChunks = []
    }

    function buildAudioFilename(blobType) {
      const normalizedType = (blobType || "").split(";", 1)[0].trim().toLowerCase()
      const extensionByType = {
        "audio/mp4": "mp4",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
      }
      const extension = extensionByType[normalizedType] || "webm"
      return `conversation-test-${Date.now()}.${extension}`
    }

    async function transcribeAudioBlob(audioBlob) {
      const contentType = audioBlob.type || "audio/webm"
      const response = await fetchJson("/api/v1/conversation/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "X-Audio-Filename": buildAudioFilename(contentType),
        },
        body: audioBlob,
      })
      renderTranscription(response)
      if (response.transcript && response.transcript.text) {
        inputField.value = response.transcript.text
        updatePreview()
      }
      return response
    }

    async function startMicrophoneCapture() {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        setStatus("error", "This browser does not expose microphone capture through getUserMedia.")
        return
      }
      if (!window.MediaRecorder) {
        setStatus("error", "This browser does not support MediaRecorder for microphone capture.")
        return
      }

      const mimeType = pickRecordingMimeType()
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        audioChunks = []
        mediaRecorder = mimeType
          ? new window.MediaRecorder(mediaStream, { mimeType })
          : new window.MediaRecorder(mediaStream)
        mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size > 0) {
            audioChunks.push(event.data)
          }
        })
        mediaRecorder.start()
        micToggleButton.textContent = "Stop and transcribe"
        micStatusField.textContent = "Recording from the browser microphone. Click again to stop and send the sample to the local STT backend."
        setStatus("success", "Microphone capture started.")
      } catch (error) {
        cleanupMicrophoneCapture()
        micToggleButton.textContent = "Start microphone"
        setStatus("error", error.message || "Unable to start microphone capture.")
      }
    }

    async function stopMicrophoneCapture() {
      if (!mediaRecorder) {
        return
      }

      const recorder = mediaRecorder
      micToggleButton.disabled = true
      micToggleButton.textContent = "Transcribing..."
      micStatusField.textContent = "Stopping the recording and sending the captured sample to the backend..."

      const stopPromise = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true })
        recorder.addEventListener("error", (event) => reject(event.error || new Error("MediaRecorder failed.")), { once: true })
      })

      try {
        recorder.stop()
        await stopPromise
        const recordedBlob = new Blob(audioChunks, { type: recorder.mimeType || pickRecordingMimeType() || "audio/webm" })
        cleanupMicrophoneCapture()

        if (!recordedBlob.size) {
          renderTranscription(null)
          setStatus("error", "No microphone audio was captured. Try recording a slightly longer sample.")
          micStatusField.textContent = "Idle. No usable audio sample was captured."
          return
        }

        micStatusField.textContent = "Uploading the captured audio and waiting for the local transcription..."
        const response = await transcribeAudioBlob(recordedBlob)
        micStatusField.textContent = `Transcript ready in ${response.timings.total_ms} ms. Detected language: ${response.transcript.language}.`
        setStatus(
          "success",
          `Microphone transcription completed on ${response.engine.id} in ${response.timings.total_ms} ms.`
        )
      } catch (error) {
        cleanupMicrophoneCapture()
        renderTranscription(null)
        micStatusField.textContent = "Idle. Microphone capture stopped after an error."
        setStatus("error", error.message || "Unable to transcribe the recorded microphone sample.")
      } finally {
        micToggleButton.disabled = false
        micToggleButton.textContent = "Start microphone"
      }
    }

    async function toggleMicrophoneCapture() {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        await stopMicrophoneCapture()
        return
      }
      await startMicrophoneCapture()
    }

    async function submitConversation() {
      const payload = buildPayload()
      if (!payload.message) {
        setStatus("error", "Enter a user message before running the conversation test.")
        return
      }

      submitButton.disabled = true
      submitButton.textContent = "Running..."
      setStatus("success", "Conversation request sent. Waiting for the LLM response...")

      try {
        const response = await fetchJson("/api/v1/conversation/text", {
          method: "POST",
          body: JSON.stringify(payload),
        })
        rememberActivePersona(response.persona.id)
        renderResult(response)
        setStatus(
          "success",
          `Conversation completed with persona ${response.persona.id} on ${response.provider.id} in ${response.timings.total_ms} ms.`
        )
      } catch (error) {
        renderResult(null)
        setStatus("error", error.message || "Unable to execute the conversation test.")
      } finally {
        submitButton.disabled = false
        submitButton.textContent = "Run text conversation"
      }
    }

    ;[personaSelect, providerSelect, dryRunCheckbox, inputField].forEach((element) => {
      element.addEventListener("input", updatePreview)
      element.addEventListener("change", updatePreview)
    })
    personaSelect.addEventListener("change", () => rememberActivePersona(personaSelect.value))

    submitButton.addEventListener("click", submitConversation)
    micToggleButton.addEventListener("click", toggleMicrophoneCapture)
    clearTranscriptButton.addEventListener("click", () => {
      cleanupMicrophoneCapture()
      micToggleButton.disabled = false
      micToggleButton.textContent = "Start microphone"
      micStatusField.textContent = "Idle. Raw audio is not persisted unless debug audio capture is explicitly enabled in Settings."
      renderTranscription(null)
      setStatus(null, "")
    })
    resetButton.addEventListener("click", () => {
      cleanupMicrophoneCapture()
      personaSelect.value = getRememberedPersona(config.personas.personas, config.personas.default_persona_id)
      providerSelect.value = ""
      dryRunCheckbox.checked = true
      inputField.value = defaultTextPrompt
      rememberActivePersona(personaSelect.value)
      micToggleButton.disabled = false
      micToggleButton.textContent = "Start microphone"
      micStatusField.textContent = "Idle. Raw audio is not persisted unless debug audio capture is explicitly enabled in Settings."
      renderTranscription(null)
      updatePreview()
      renderResult(null)
      setStatus(null, "")
    })

    rememberActivePersona(personaSelect.value)
    updatePreview()
    renderTranscription(null)
    renderResult(null)
  }

  async function renderMemoryPage() {
    pageBody.innerHTML = ""

    function fmtDate(iso) {
      if (!iso) return "—"
      try { return new Date(iso).toLocaleString() } catch (_) { return iso }
    }

    function chipHtml(text) {
      return `<span class="tag">${escapeHtml(String(text))}</span>`
    }

    let stats = { conversations: 0, messages: 0, preferences: 0, memories: 0 }
    try { stats = await fetchJson("/api/v1/memory/stats") } catch (_) {}

    pageBody.appendChild(
      createStatsGrid([
        { eyebrow: "History", title: "Conversations", value: String(stats.conversations) },
        { eyebrow: "Turns", title: "Messages", value: String(stats.messages) },
        { eyebrow: "Settings", title: "Preferences", value: String(stats.preferences) },
        { eyebrow: "Facts", title: "Memory entries", value: String(stats.memories) },
        { eyebrow: "Semantic", title: "Indexed entries", value: String(stats.indexed_memories || 0) },
      ])
    )

    // --- Conversations panel ---
    async function buildConversationsPanel() {
      let data = { items: [], total: 0 }
      try { data = await fetchJson("/api/v1/memory/conversations?limit=50") } catch (_) {}

      const panel = createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">Conversation history</p>
            <h3 class="panel-title">Sessions</h3>
          </div>
        </div>
      `)

      if (!data.items.length) {
        panel.insertAdjacentHTML("beforeend", "<p class=\"panel-copy\">No conversations stored yet. Run a text or voice conversation to populate this section.</p>")
        return panel
      }

      const tableEl = document.createElement("div")
      tableEl.className = "memory-table"

      for (const conv of data.items) {
        const row = document.createElement("div")
        row.className = "memory-row"
        row.innerHTML = `
          <div class="memory-row-main">
            <div class="memory-row-info">
              <strong>${escapeHtml(conv.persona_id || "—")}</strong>
              <span class="memory-row-meta">${chipHtml(conv.retention_mode)} · ${escapeHtml(String(conv.message_count))} msg · ${escapeHtml(fmtDate(conv.started_at))}</span>
            </div>
            <div class="memory-row-actions">
              <button class="memory-btn is-ghost expand-conv-btn">Expand</button>
              <button class="memory-btn is-danger del-conv-btn">Delete</button>
            </div>
          </div>
          <div class="memory-row-detail" style="display:none"></div>
        `

        row.querySelector(".expand-conv-btn").addEventListener("click", async (e) => {
          const detail = row.querySelector(".memory-row-detail")
          if (detail.style.display !== "none") {
            detail.style.display = "none"
            e.target.textContent = "Expand"
            return
          }
          e.target.textContent = "Loading…"
          try {
            const full = await fetchJson(`/api/v1/memory/conversations/${conv.id}`)
            detail.innerHTML = full.messages.length
              ? full.messages.map((m) => `
                  <div class="memory-message memory-message--${escapeHtml(m.role)}">
                    <span class="memory-message-role">${escapeHtml(m.role)}</span>
                    <p class="memory-message-content">${escapeHtml(m.content)}</p>
                    <span class="memory-message-meta">${escapeHtml(fmtDate(m.timestamp))}${m.model ? " · " + escapeHtml(m.model) : ""}</span>
                  </div>
                `).join("")
              : `<p class="panel-copy" style="margin:0">No messages stored (retention mode: ${escapeHtml(conv.retention_mode)}).</p>`
            detail.style.display = "grid"
            e.target.textContent = "Collapse"
          } catch (err) {
            setStatus("error", err.message)
            e.target.textContent = "Expand"
          }
        })

        row.querySelector(".del-conv-btn").addEventListener("click", async () => {
          if (!confirm(`Delete conversation from ${fmtDate(conv.started_at)}?`)) return
          try {
            await fetch(`/api/v1/memory/conversations/${conv.id}`, { method: "DELETE" })
            row.remove()
            setStatus("success", "Conversation deleted.")
          } catch (err) {
            setStatus("error", err.message)
          }
        })

        tableEl.appendChild(row)
      }

      if (data.total > data.items.length) {
        tableEl.insertAdjacentHTML("beforeend", `<p class="panel-copy">${data.total} total — showing first ${data.items.length}.</p>`)
      }

      panel.appendChild(tableEl)
      return panel
    }

    // --- Preferences panel ---
    async function buildPreferencesPanel() {
      let data = { items: [] }
      try { data = await fetchJson("/api/v1/memory/preferences") } catch (_) {}

      const panel = createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">User preferences</p>
            <h3 class="panel-title">Preferences</h3>
          </div>
        </div>
      `)

      const listEl = document.createElement("div")
      listEl.className = "pref-list"

      function renderPrefRows(items) {
        listEl.innerHTML = items.length
          ? items.map((pref) => `
              <div class="pref-row" data-key="${escapeHtml(pref.key)}" data-persona="${escapeHtml(pref.persona_id || "")}">
                <span class="pref-key">${escapeHtml(pref.key)}</span>
                <span class="pref-persona">${pref.persona_id ? chipHtml(pref.persona_id) : ""}</span>
                <span class="pref-value">${escapeHtml(JSON.stringify(pref.value))}</span>
                <button class="memory-btn is-danger pref-del-btn">Delete</button>
              </div>
            `).join("")
          : "<p class=\"panel-copy\">No preferences stored yet.</p>"

        listEl.querySelectorAll(".pref-del-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const row = btn.closest(".pref-row")
            const key = row.dataset.key
            const pid = row.dataset.persona
            const qs = pid ? `?persona_id=${encodeURIComponent(pid)}` : ""
            try {
              await fetch(`/api/v1/memory/preferences/${encodeURIComponent(key)}${qs}`, { method: "DELETE" })
              data.items = data.items.filter((p) => !(p.key === key && (p.persona_id || "") === pid))
              renderPrefRows(data.items)
              setStatus("success", `Preference '${key}' deleted.`)
            } catch (err) {
              setStatus("error", err.message)
            }
          })
        })
      }

      renderPrefRows(data.items)
      panel.appendChild(listEl)

      const form = document.createElement("div")
      form.className = "memory-add-form"
      form.innerHTML = `
        <p class="eyebrow" style="margin-bottom:8px">Add / update preference</p>
        <div class="form-row">
          <input class="form-input" placeholder="Key" data-field="key" />
          <input class="form-input" placeholder="Value (JSON or plain text)" data-field="value" />
          <input class="form-input" placeholder="Persona ID (optional)" data-field="pid" />
          <button class="primary-button pref-add-btn">Save</button>
        </div>
      `
      form.querySelector(".pref-add-btn").addEventListener("click", async () => {
        const key = form.querySelector("[data-field='key']").value.trim()
        const rawVal = form.querySelector("[data-field='value']").value.trim()
        const pid = form.querySelector("[data-field='pid']").value.trim()
        if (!key || rawVal === "") { setStatus("warning", "Key and value are required."); return }
        let parsedVal
        try { parsedVal = JSON.parse(rawVal) } catch (_) { parsedVal = rawVal }
        const qs = pid ? `?persona_id=${encodeURIComponent(pid)}` : ""
        try {
          const result = await fetchJson(`/api/v1/memory/preferences/${encodeURIComponent(key)}${qs}`, {
            method: "PUT",
            body: JSON.stringify({ value: parsedVal }),
          })
          data.items = data.items.filter((p) => !(p.key === key && (p.persona_id || "") === (pid || "")))
          data.items.push({ key: result.key, persona_id: result.persona_id || "", value: result.value, updated_at: new Date().toISOString() })
          data.items.sort((a, b) => a.key.localeCompare(b.key))
          renderPrefRows(data.items)
          form.querySelector("[data-field='key']").value = ""
          form.querySelector("[data-field='value']").value = ""
          form.querySelector("[data-field='pid']").value = ""
          setStatus("success", `Preference '${key}' saved.`)
        } catch (err) {
          setStatus("error", err.message)
        }
      })

      panel.appendChild(form)
      return panel
    }

    // --- Semantic search panel ---
    async function buildSemanticSearchPanel() {
      const panel = createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">Semantic recall</p>
            <h3 class="panel-title">Search injected memories</h3>
          </div>
        </div>
        <div class="memory-add-form" style="margin-top:0;padding-top:0;border-top:0">
          <div class="form-row">
            <input class="form-input" placeholder="Ask a new question to test memory retrieval" data-field="query" />
            <input class="form-input" placeholder="Persona ID (optional)" data-field="persona_id" />
            <button class="primary-button semantic-search-btn">Search</button>
          </div>
        </div>
        <div class="memory-entries-list semantic-search-results" style="margin-top:12px"></div>
      `)

      const resultEl = panel.querySelector(".semantic-search-results")
      const queryEl = panel.querySelector("[data-field='query']")
      const personaEl = panel.querySelector("[data-field='persona_id']")

      function renderSearchRows(items) {
        resultEl.innerHTML = items.length
          ? items.map((entry) => `
              <div class="memory-entry">
                <div class="memory-entry-body">
                  <p class="memory-entry-content">${escapeHtml(entry.content)}</p>
                  <div class="memory-entry-meta">
                    ${chipHtml(`score ${entry.score}`)}
                    ${chipHtml(entry.persona_id || "global")}
                    ${chipHtml(entry.source || "memory")}
                    ${entry.tags.map((t) => chipHtml(t)).join("")}
                    ${entry.embedding ? chipHtml(entry.embedding.provider_id || "embedding") : ""}
                  </div>
                </div>
              </div>
            `).join("")
          : "<p class=\"panel-copy\">No matching memories yet.</p>"
      }

      panel.querySelector(".semantic-search-btn").addEventListener("click", async () => {
        const query = queryEl.value.trim()
        const personaId = personaEl.value.trim()
        if (!query) { setStatus("warning", "Search query is required."); return }
        const url = new URL("/api/v1/memory/search", window.location.origin)
        url.searchParams.set("query", query)
        if (personaId) url.searchParams.set("persona_id", personaId)
        try {
          const data = await fetchJson(url.pathname + url.search)
          renderSearchRows(data.items || [])
          setStatus("success", `Semantic search returned ${data.total || 0} memories.`)
        } catch (err) {
          setStatus("error", err.message || "Semantic search failed.")
        }
      })

      renderSearchRows([])
      return panel
    }

    // --- Memory entries panel ---
    async function buildMemoriesPanel() {
      let data = { items: [], total: 0 }
      try { data = await fetchJson("/api/v1/memory/entries?limit=100") } catch (_) {}

      const panel = createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">Persistent facts</p>
            <h3 class="panel-title">Memory entries</h3>
          </div>
        </div>
      `)

      const listEl = document.createElement("div")
      listEl.className = "memory-entries-list"

      function renderEntryRows(items) {
        listEl.innerHTML = items.length
          ? items.map((entry) => `
              <div class="memory-entry" data-id="${escapeHtml(entry.id)}">
                <div class="memory-entry-body">
                  <p class="memory-entry-content">${escapeHtml(entry.content)}</p>
                  <div class="memory-entry-meta">
                    ${chipHtml(entry.persona_id || "global")}
                    ${chipHtml(entry.source)}
                    ${entry.tags.map((t) => chipHtml(t)).join("")}
                    <span class="memory-row-meta">${escapeHtml(fmtDate(entry.created_at))}</span>
                  </div>
                </div>
                <div class="memory-entry-actions">
                  <button class="memory-btn is-ghost entry-edit-btn">Edit</button>
                  <button class="memory-btn is-danger entry-del-btn">Delete</button>
                </div>
                <div class="memory-entry-edit-form" style="display:none">
                  <textarea class="form-textarea" rows="3">${escapeHtml(entry.content)}</textarea>
                  <input class="form-input" placeholder="Tags (comma-separated)" value="${escapeHtml(entry.tags.join(", "))}" />
                  <div style="display:flex;gap:8px">
                    <button class="primary-button entry-save-btn">Save</button>
                    <button class="secondary-button entry-cancel-btn">Cancel</button>
                  </div>
                </div>
              </div>
            `).join("")
          : "<p class=\"panel-copy\">No memory entries yet. Add facts below.</p>"

        listEl.querySelectorAll(".entry-edit-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const entryEl = btn.closest(".memory-entry")
            const editForm = entryEl.querySelector(".memory-entry-edit-form")
            const isOpen = editForm.style.display !== "none"
            editForm.style.display = isOpen ? "none" : "grid"
            btn.textContent = isOpen ? "Edit" : "Cancel"
          })
        })

        listEl.querySelectorAll(".entry-cancel-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const editForm = btn.closest(".memory-entry-edit-form")
            editForm.style.display = "none"
            btn.closest(".memory-entry").querySelector(".entry-edit-btn").textContent = "Edit"
          })
        })

        listEl.querySelectorAll(".entry-save-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const entryEl = btn.closest(".memory-entry")
            const entryId = entryEl.dataset.id
            const content = entryEl.querySelector("textarea").value.trim()
            const tagsRaw = entryEl.querySelector(".memory-entry-edit-form input").value.trim()
            const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : []
            if (!content) { setStatus("warning", "Content is required."); return }
            try {
              const updated = await fetchJson(`/api/v1/memory/entries/${entryId}`, {
                method: "PUT",
                body: JSON.stringify({ content, tags }),
              })
              const idx = data.items.findIndex((e) => e.id === entryId)
              if (idx >= 0) data.items[idx] = updated
              renderEntryRows(data.items)
              setStatus("success", "Memory entry updated.")
            } catch (err) {
              setStatus("error", err.message)
            }
          })
        })

        listEl.querySelectorAll(".entry-del-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const entryEl = btn.closest(".memory-entry")
            const entryId = entryEl.dataset.id
            if (!confirm("Delete this memory entry?")) return
            try {
              await fetch(`/api/v1/memory/entries/${entryId}`, { method: "DELETE" })
              data.items = data.items.filter((e) => e.id !== entryId)
              renderEntryRows(data.items)
              setStatus("success", "Memory entry deleted.")
            } catch (err) {
              setStatus("error", err.message)
            }
          })
        })
      }

      renderEntryRows(data.items)
      panel.appendChild(listEl)

      const form = document.createElement("div")
      form.className = "memory-add-form"
      form.innerHTML = `
        <p class="eyebrow" style="margin-bottom:8px">Add memory entry</p>
        <textarea class="form-textarea" rows="2" placeholder="Fact or note to remember…" data-field="content"></textarea>
        <div class="form-row" style="margin-top:8px">
          <input class="form-input" placeholder="Persona ID (optional)" data-field="persona_id" />
          <input class="form-input" placeholder="Tags (comma-separated)" data-field="tags" />
          <button class="primary-button entry-add-btn">Add</button>
        </div>
      `
      form.querySelector(".entry-add-btn").addEventListener("click", async () => {
        const content = form.querySelector("[data-field='content']").value.trim()
        const pid = form.querySelector("[data-field='persona_id']").value.trim()
        const tagsRaw = form.querySelector("[data-field='tags']").value.trim()
        const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : []
        if (!content) { setStatus("warning", "Content is required."); return }
        try {
          const created = await fetchJson("/api/v1/memory/entries", {
            method: "POST",
            body: JSON.stringify({ content, persona_id: pid, tags }),
          })
          data.items.unshift(created)
          renderEntryRows(data.items)
          form.querySelector("[data-field='content']").value = ""
          form.querySelector("[data-field='persona_id']").value = ""
          form.querySelector("[data-field='tags']").value = ""
          setStatus("success", "Memory entry added.")
        } catch (err) {
          setStatus("error", err.message)
        }
      })

      panel.appendChild(form)
      return panel
    }

    const [convsPanel, prefsPanel, semanticPanel, memoriesPanel] = await Promise.all([
      buildConversationsPanel(),
      buildPreferencesPanel(),
      buildSemanticSearchPanel(),
      buildMemoriesPanel(),
    ])

    pageBody.appendChild(convsPanel)
    pageBody.appendChild(semanticPanel)
    const twoCol = document.createElement("section")
    twoCol.className = "two-column-grid"
    twoCol.appendChild(prefsPanel)
    twoCol.appendChild(memoriesPanel)
    pageBody.appendChild(twoCol)
  }

  async function renderLogsPage() {
    const [overview, manifest] = await Promise.all([loadOverview(), fetchJson("/api/v1/config/manifest")])
    pageBody.innerHTML = ""

    pageBody.appendChild(
      createStatsGrid([
        { eyebrow: "Logging", title: "Runtime level", value: overview.service.log_level },
        { eyebrow: "Modules", title: "Prepared modules", value: overview.modules.length },
        { eyebrow: "Debug audio", title: "Raw audio capture", value: manifest.runtime.debug_audio_capture ? "Enabled" : "Disabled" },
        { eyebrow: "API", title: "Base path", value: manifest.api.base_path },
      ])
    )

    const logsGrid = document.createElement("section")
    logsGrid.className = "two-column-grid"
    logsGrid.appendChild(
      createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">Current posture</p>
            <h3 class="panel-title">Observability baseline</h3>
          </div>
        </div>
        <div class="log-list">
          <div class="log-item"><strong>Config events</strong><br />Changes made in the dashboard are persisted through validated API writes.</div>
          <div class="log-item"><strong>Provider visibility</strong><br />Default and fallback providers are surfaced in Overview and Providers.</div>
          <div class="log-item"><strong>Audio privacy</strong><br />Raw audio capture remains disabled unless explicitly enabled.</div>
        </div>
      `)
    )
    logsGrid.appendChild(
      createPanel(`
        <div class="panel-header">
          <div>
            <p class="eyebrow">Lot 14 preview</p>
            <h3 class="panel-title">Upcoming live logs</h3>
          </div>
        </div>
        <p class="panel-copy">${escapeHtml(overview.roadmap_notes.logs)}</p>
      `)
    )
    pageBody.appendChild(logsGrid)
  }

  dashboardNav.addEventListener("click", (event) => {
    const link = event.target.closest("[data-page-key]")
    if (!link) {
      return
    }
    event.preventDefault()
    navigateTo(link.dataset.pageKey)
  })

  window.addEventListener("popstate", () => {
    renderRoute(getPageKeyFromLocation(), true)
  })

  renderNav(getPageKeyFromLocation())
  renderRoute(getPageKeyFromLocation(), true)
})()
