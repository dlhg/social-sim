# CLAUDE.md

## Communication

- The user often uses speech-to-text input. Their messages may contain phonetically similar words or homophones in place of the intended word (e.g., "there" instead of "their", "weight" instead of "wait"). Interpret input charitably and infer the intended meaning from context.

## Codebase Reference Docs

Two reference docs are maintained in your Claude memory directory:

- **`memory/code-graph.md`** — File-level dependency matrix and per-file API docs (exports, types, key functions). Use for implementation questions: "what does this file export?", "what imports what?"
- **`memory/architecture.md`** — Runtime architecture: the 3 loops (Director/World/DayCycle), 7 mechanism systems, NPC state model, scoring constants, data flows. Use for design questions: "how does pair scoring work?", "what triggers a reactive chain?"

### Staleness protocol
- Both docs have an **actual short SHA** (not `HEAD`) in their header comment, e.g. `From commit: 8712373`.
- Before structural work, check staleness: `git diff --name-only <sha>..HEAD`. Use judgment — only update sections for files with structural changes (new files, changed exports/imports, new types, new constants). Skip CSS/content-only changes.
- When you make structural changes, update the affected sections and bump the commit hash to the current short SHA. Also update the SHA references in MEMORY.md.
- Consult MEMORY.md and these docs before doing broad codebase searches.
