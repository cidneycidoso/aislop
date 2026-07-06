# Card Rewriter — Lumiverse Spindle extension

Rewrite any field of a character card with an AI, one field at a time, using
configurable prompts and any connection profile you already have set up in
Lumiverse.

## What it does

- Adds an **"AI Rewrite"** tab directly inside the character editor modal.
- Pick a field: Description, Personality, Scenario, First Message, Example
  Messages, Creator Notes, System Prompt, Post-History Instructions, or
  **Alternate Greetings**.
- For Alternate Greetings specifically, a second dropdown lets you pick which
  existing greeting to rewrite, or "+Add new greeting" to generate a
  brand-new one from scratch (based on the character's other fields).
- Pick a connection (any connection profile you've already configured in
  Lumiverse — leave blank to use your default).
- Edit the per-field instructions for this one rewrite, or save them as the
  new default for that field.
- There's also a global "Global rewrite instructions" box that's prepended to
  every field's instructions — this is your overarching "what's gonna
  change" prompt.
- Generate, review the result side-by-side with the original, then **Accept**
  (writes it back to the card — replacing the selected greeting, or appending
  a new one) or **Discard**.

## Why there's no "custom endpoint + password" field

Spindle extensions can't hold or submit raw API credentials for generation —
`spindle.generate.*` only accepts a `connection_id` referencing a Connection
Profile that already exists in Lumiverse (Settings → Connections), and
`spindle.connections.list()` never exposes the actual key, only
`has_api_key`. This is a deliberate security boundary so a compromised
extension can't exfiltrate credentials.

Practically this means: if you want to hit a custom endpoint, add it once as
a Connection Profile in Lumiverse itself, then just pick it from this
extension's dropdown like any other connection.

## Project layout

```
card-rewriter/
├── spindle.json        # extension manifest
├── src/
│   ├── shared.ts        # types, default prompts, RPC message shapes
│   ├── backend.ts        # runs in the Spindle worker — storage, characters, generation
│   └── frontend.ts       # runs in the browser — character editor tab UI
├── tsconfig.json
└── package.json
```

## Building

Requires [Bun](https://bun.sh).

```bash
npm install lumiverse-spindle-types --save-dev
bun build src/backend.ts --outdir dist --target=browser --minify
bun build src/frontend.ts --outdir dist --target=browser --minify
```

Or just push `src/` to a repo without a `dist/` folder — Lumiverse auto-builds
on install if `dist/backend.js` / `dist/frontend.js` are missing but the
matching `src/*.ts` files exist.

## Installing in Lumiverse

1. Push this folder to a GitHub repo.
2. In Lumiverse: Extensions → Install → paste the repo URL.
3. After install, enable the extension and grant the **characters** and
   **generation** permissions (both privileged — they need explicit
   admin approval).
4. Open any character in the editor — you'll see the new "AI Rewrite" tab.

## Notes / things to double check before you ship it

- I verified every API call here (`spindle.generate.quiet`,
  `spindle.characters.get/update`, `spindle.connections.list`,
  `spindle.userStorage.getJson/setJson`, `ctx.ui.registerCharacterEditorTab`,
  `ctx.components.mount*`) against the real `lumiverse-spindle-types` package
  (v0.5.31) and type-checked this project against it — it compiles clean.
- The one thing I could **not** verify against real output is the exact
  runtime shape of the object `spindle.generate.quiet()` resolves with — the
  type is intentionally `unknown` in the SDK. `backend.ts`'s `extractText()`
  handles the shapes I'd expect (`{ content: string }`, OpenAI-style
  `choices[0].message.content`, Anthropic-style content blocks), but if your
  first real rewrite throws "Could not extract text from generation result",
  log the raw `result` object once and adjust `extractText()` to match.
- `alternate_greetings` writes go through a read-modify-write: the backend
  re-fetches the character, clones the array, replaces the chosen index (or
  appends), then calls `characters.update()` with the whole array. This means
  two people/tabs editing greetings on the same character at the same moment
  could race — not a concern for a single-user self-host, worth knowing if
  you ever run this on a shared multi-user instance.
- `tags` (a plain string array with no natural "one item at a time" editing
  flow the way greetings have) still isn't wired up as a rewritable field.