import type { SpindleFrontendContext, SpindleFrontendModule } from "lumiverse-spindle-types";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  defaultConfig,
  isArrayCategory,
  type CategoryId,
  type RewriterConfig,
  type RewriterRequest,
  type RewriterRequestInput,
  type RewriterResponse,
} from "./shared";

const NEW_GREETING_VALUE = "__new__";

let nextRequestId = 0;
function newRequestId(): string {
  nextRequestId += 1;
  return `req_${Date.now()}_${nextRequestId}`;
}

const module_: SpindleFrontendModule = {
  setup(ctx: SpindleFrontendContext) {
    // ── RPC helper: promise-ify the fire-and-forget backend message bus ──
    const pending = new Map<string, (res: RewriterResponse) => void>();
    ctx.onBackendMessage((payload) => {
      const res = payload as RewriterResponse;
      const resolve = pending.get(res.requestId);
      if (resolve) {
        pending.delete(res.requestId);
        resolve(res);
      }
    });

    function call<T extends RewriterResponse>(req: RewriterRequestInput): Promise<T> {
      const requestId = newRequestId();
      return new Promise((resolve, reject) => {
        pending.set(requestId, (res) => {
          if (res.type === "error") reject(new Error(res.message));
          else resolve(res as T);
        });
        ctx.sendToBackend({ ...req, requestId } as RewriterRequest);
      });
    }

    let config: RewriterConfig = defaultConfig();

    const tab = ctx.ui.registerCharacterEditorTab({ id: "rewriter", title: "AI Rewrite" });
    const root = tab.root;
    root.style.padding = "12px";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.gap = "10px";
    root.style.overflowY = "auto";

    function label(text: string): HTMLElement {
      const el = ctx.dom.createElement("div", {});
      el.textContent = text;
      el.style.fontWeight = "600";
      el.style.fontSize = "12px";
      el.style.opacity = "0.8";
      return el;
    }

    function button(text: string, primary = false): HTMLButtonElement {
      const btn = ctx.dom.createElement("button", {});
      btn.textContent = text;
      btn.style.padding = "6px 12px";
      btn.style.borderRadius = "6px";
      btn.style.cursor = "pointer";
      btn.style.border = primary ? "none" : "1px solid var(--border, #444)";
      btn.style.background = primary ? "var(--accent, #6366f1)" : "transparent";
      btn.style.color = primary ? "#fff" : "inherit";
      return btn;
    }

    // ── Category picker ──
    root.appendChild(label("Field to rewrite"));
    const categoryHost = ctx.dom.createElement("div", {});
    root.appendChild(categoryHost);
    const categorySelect = ctx.components.mountSelect(categoryHost, {
      value: CATEGORIES[0],
      options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    });

    // ── Alternate-greeting picker (only shown for that one category) ──
    const greetingLabel = label("Which greeting");
    root.appendChild(greetingLabel);
    const greetingHost = ctx.dom.createElement("div", {});
    root.appendChild(greetingHost);
    const greetingSelect = ctx.components.mountSelect(greetingHost, {
      value: NEW_GREETING_VALUE,
      options: [{ value: NEW_GREETING_VALUE, label: "+ Add new greeting" }],
    });

    function setGreetingPickerVisible(visible: boolean) {
      const display = visible ? "" : "none";
      greetingLabel.style.display = display;
      greetingHost.style.display = display;
    }
    setGreetingPickerVisible(false);

    // ── Connection picker ──
    root.appendChild(label("Connection"));
    const connectionHost = ctx.dom.createElement("div", {});
    root.appendChild(connectionHost);
    const connectionSelect = ctx.components.mountSelect(connectionHost, {
      value: "",
      options: [],
      placeholder: "Loading connections…",
      clearable: true,
      clearLabel: "Use my default connection",
    });

    // ── Instructions (per-category prompt, editable per rewrite) ──
    root.appendChild(label("Instructions for this rewrite"));
    const instructionsHost = ctx.dom.createElement("div", {});
    root.appendChild(instructionsHost);
    const instructionsArea = ctx.components.mountTextArea(instructionsHost, {
      rows: 3,
      placeholder: "What should change…",
    });

    const saveDefaultRow = ctx.dom.createElement("div", {});
    saveDefaultRow.style.display = "flex";
    saveDefaultRow.style.justifyContent = "flex-end";
    root.appendChild(saveDefaultRow);
    const saveDefaultBtn = button("Save as default for this field");
    saveDefaultRow.appendChild(saveDefaultBtn);

    // ── Global base prompt (collapsible) ──
    const baseSection = ctx.components.mountCollapsibleSection(root, {
      title: "Global rewrite instructions (applies to every field)",
      defaultExpanded: false,
    });
    const basePromptArea = ctx.components.mountTextArea(baseSection.body, { rows: 5 });
    const baseSaveRow = ctx.dom.createElement("div", {});
    baseSaveRow.style.display = "flex";
    baseSaveRow.style.justifyContent = "flex-end";
    baseSaveRow.style.marginTop = "6px";
    baseSection.body.appendChild(baseSaveRow);
    const baseSaveBtn = button("Save global instructions");
    baseSaveRow.appendChild(baseSaveBtn);

    // ── Original text (read-only preview) ──
    root.appendChild(label("Current text"));
    const originalHost = ctx.dom.createElement("div", {});
    root.appendChild(originalHost);
    const originalArea = ctx.components.mountTextArea(originalHost, { rows: 6, disabled: true });

    // ── Actions ──
    const actionRow = ctx.dom.createElement("div", {});
    actionRow.style.display = "flex";
    actionRow.style.gap = "8px";
    root.appendChild(actionRow);
    const rewriteBtn = button("Rewrite", true);
    const statusText = ctx.dom.createElement("span", {});
    statusText.style.fontSize = "12px";
    statusText.style.opacity = "0.7";
    statusText.style.alignSelf = "center";
    actionRow.appendChild(rewriteBtn);
    actionRow.appendChild(statusText);

    // ── Result + accept/discard ──
    root.appendChild(label("Rewritten text"));
    const resultHost = ctx.dom.createElement("div", {});
    root.appendChild(resultHost);
    const resultArea = ctx.components.mountTextArea(resultHost, {
      rows: 6,
      placeholder: "Rewritten text will appear here — you can edit it before accepting.",
    });

    const resultActionRow = ctx.dom.createElement("div", {});
    resultActionRow.style.display = "flex";
    resultActionRow.style.gap = "8px";
    root.appendChild(resultActionRow);
    const acceptBtn = button("Accept — replace field", true);
    const discardBtn = button("Discard");
    resultActionRow.appendChild(acceptBtn);
    resultActionRow.appendChild(discardBtn);
    acceptBtn.disabled = true;
    discardBtn.disabled = true;

    // ── State ──
    let currentCharacterId: string | null = null;
    let currentCharacter: Record<string, unknown> | null = null;

    function currentCategory(): CategoryId {
      return categorySelect.getValue() as CategoryId;
    }

    function currentGreetings(): string[] {
      const raw = currentCharacter?.alternate_greetings;
      return Array.isArray(raw) ? (raw as string[]) : [];
    }

    async function loadCategoryInstructions() {
      instructionsArea.update({ value: config.categoryPrompts[currentCategory()] ?? "" });
    }

    /** Re-derive what the greeting picker + original-text box should show, from already-fetched data. */
    function renderCategoryView() {
      const category = currentCategory();

      if (isArrayCategory(category)) {
        setGreetingPickerVisible(true);
        const greetings = currentGreetings();
        const options = [
          ...greetings.map((text, i) => ({
            value: String(i),
            label: `Greeting #${i + 1}`,
            sublabel: text.length > 60 ? `${text.slice(0, 60)}…` : text,
          })),
          { value: NEW_GREETING_VALUE, label: "+ Add new greeting" },
        ];
        const previousValue = greetingSelect.getValue();
        const nextValue = options.some((o) => o.value === previousValue) ? previousValue : NEW_GREETING_VALUE;
        greetingSelect.update({ options, value: nextValue });
        const selectedIndex = nextValue === NEW_GREETING_VALUE ? -1 : Number(nextValue);
        originalArea.update({ value: selectedIndex >= 0 ? greetings[selectedIndex] ?? "" : "" });
      } else {
        setGreetingPickerVisible(false);
        originalArea.update({ value: (currentCharacter?.[category] as string | undefined) ?? "" });
      }
    }

    async function loadCharacter() {
      if (!currentCharacterId) return;
      originalArea.update({ value: "Loading…" });
      type GetCharacterResponse = Extract<RewriterResponse, { type: "get_character" }>;
      const res = await call<GetCharacterResponse>({
        type: "get_character",
        characterId: currentCharacterId,
      });
      currentCharacter = res.character;
      renderCategoryView();
    }

    categorySelect.update({
      onChange: async () => {
        await loadCategoryInstructions();
        renderCategoryView();
        resultArea.update({ value: "" });
        acceptBtn.disabled = true;
        discardBtn.disabled = true;
      },
    });

    greetingSelect.update({
      onChange: () => {
        const value = greetingSelect.getValue();
        const greetings = currentGreetings();
        const index = value === NEW_GREETING_VALUE ? -1 : Number(value);
        originalArea.update({ value: index >= 0 ? greetings[index] ?? "" : "" });
        resultArea.update({ value: "" });
        acceptBtn.disabled = true;
        discardBtn.disabled = true;
      },
    });

    saveDefaultBtn.onclick = async () => {
      config.categoryPrompts[currentCategory()] = instructionsArea.getValue();
      await call({ type: "save_config", config });
      statusText.textContent = "Saved as default for this field.";
      setTimeout(() => (statusText.textContent = ""), 2500);
    };

    baseSaveBtn.onclick = async () => {
      config.basePrompt = basePromptArea.getValue();
      await call({ type: "save_config", config });
      statusText.textContent = "Saved global instructions.";
      setTimeout(() => (statusText.textContent = ""), 2500);
    };

    rewriteBtn.onclick = async () => {
      if (!currentCharacterId) return;
      rewriteBtn.disabled = true;
      statusText.textContent = "Generating…";
      try {
        const connectionId = connectionSelect.getValue() || undefined;
        type RewriteResponse = Extract<RewriterResponse, { type: "rewrite" }>;
        const res = await call<RewriteResponse>({
          type: "rewrite",
          characterId: currentCharacterId,
          category: currentCategory(),
          originalText: originalArea.getValue(),
          instructions: instructionsArea.getValue(),
          connectionId,
        });
        resultArea.update({ value: res.text });
        acceptBtn.disabled = false;
        discardBtn.disabled = false;
        statusText.textContent = "";
      } catch (err) {
        statusText.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        rewriteBtn.disabled = false;
      }
    };

    acceptBtn.onclick = async () => {
      if (!currentCharacterId) return;
      acceptBtn.disabled = true;
      try {
        const category = currentCategory();
        const greetingValue = greetingSelect.getValue();
        const greetingIndex =
          isArrayCategory(category) && greetingValue !== NEW_GREETING_VALUE ? Number(greetingValue) : undefined;

        await call({
          type: "apply",
          characterId: currentCharacterId,
          category,
          newText: resultArea.getValue(),
          greetingIndex,
        });

        resultArea.update({ value: "" });
        discardBtn.disabled = true;
        statusText.textContent = "Applied.";
        setTimeout(() => (statusText.textContent = ""), 2500);

        // Refetch so the greeting list (and its indices) reflect the write we just made.
        await loadCharacter();
      } catch (err) {
        statusText.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        acceptBtn.disabled = false;
      }
    };

    discardBtn.onclick = () => {
      resultArea.update({ value: "" });
      acceptBtn.disabled = true;
      discardBtn.disabled = true;
    };

    // ── Init ──
    async function init() {
      type GetConfigResponse = Extract<RewriterResponse, { type: "get_config" }>;
      type ListConnectionsResponse = Extract<RewriterResponse, { type: "list_connections" }>;
      const [configRes, connectionsRes] = await Promise.all([
        call<GetConfigResponse>({ type: "get_config" }),
        call<ListConnectionsResponse>({ type: "list_connections" }),
      ]);
      config = configRes.config;
      basePromptArea.update({ value: config.basePrompt });

      connectionSelect.update({
        options: connectionsRes.connections.map((c) => ({
          value: c.id,
          label: `${c.name}${c.isDefault ? " (default)" : ""}`,
          sublabel: `${c.provider} · ${c.model}`,
        })),
        placeholder: "Use my default connection",
        value: config.lastConnectionId ?? "",
      });

      await loadCategoryInstructions();
    }

    tab.onActivate(() => {
      const state = ctx.ui.characterEditor.getState();
      if (state.characterId && state.characterId !== currentCharacterId) {
        currentCharacterId = state.characterId;
        void loadCharacter();
      }
    });

    const cleanupEditorWatch = ctx.ui.characterEditor.onChange((state) => {
      if (state.characterId && state.characterId !== currentCharacterId) {
        currentCharacterId = state.characterId;
        void loadCharacter();
      }
    });

    currentCharacterId = ctx.ui.characterEditor.getState().characterId;
    void init().then(() => loadCharacter());

    ctx.ready();

    return () => {
      cleanupEditorWatch();
      tab.destroy();
    };
  },
};

export default module_;
