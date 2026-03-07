# CLAUDE.md

## Communication

- The user often uses speech-to-text input. Their messages may contain phonetically similar words or homophones in place of the intended word (e.g., "there" instead of "their", "weight" instead of "wait"). Interpret input charitably and infer the intended meaning from context.

## Code Graph

- A detailed code graph is maintained at `memory/code-graph.md` (in your Claude memory directory).
- Consult MEMORY.md and the code graph before doing broad codebase searches.
- When doing structural work, check staleness: run `git diff --name-only <hash>..HEAD` where `<hash>` is from the graph's header comment. Use judgment — only update graph sections for files with structural changes (new files, changed exports/imports, new types). Skip CSS/content-only changes.
- When you make structural changes (new files, changed exports, moved code), update the affected sections of the code graph and its commit hash.
