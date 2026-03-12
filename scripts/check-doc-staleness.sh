#!/bin/bash
# Checks if code-graph.md and architecture.md are stale relative to current HEAD.
# Used by Claude Code SessionStart hook. Outputs a reminder if stale, nothing if current.

MEMORY_DIR="$HOME/.claude/projects/-Users-drew-Code-ollama-playground/memory"
CODE_GRAPH="$MEMORY_DIR/code-graph.md"
ARCHITECTURE="$MEMORY_DIR/architecture.md"

# Extract SHA from header comment: <!-- Generated: DATE | From commit: SHA -->
get_doc_sha() {
  head -1 "$1" 2>/dev/null | sed -n 's/.*From commit: \([a-f0-9]*\).*/\1/p'
}

DOC_SHA=$(get_doc_sha "$CODE_GRAPH")
CURRENT_SHA=$(git rev-parse --short HEAD 2>/dev/null)

# If we can't read either SHA, skip silently
[ -z "$DOC_SHA" ] || [ -z "$CURRENT_SHA" ] && exit 0

# If SHAs match, docs are current — no output
[ "$DOC_SHA" = "$CURRENT_SHA" ] && exit 0

# Docs are stale — list changed files
CHANGED=$(git diff --name-only "$DOC_SHA"..HEAD 2>/dev/null)
[ -z "$CHANGED" ] && exit 0

cat <<EOF
⚠️ Reference docs are stale (doc SHA: $DOC_SHA, current: $CURRENT_SHA).
Changed files since last update:
$CHANGED

Before structural work, update the affected sections in:
- memory/code-graph.md (run \`npx tsx scripts/gen-dep-matrix.ts\` for the matrix, hand-edit API docs)
- memory/architecture.md (if runtime behavior changed)
Then bump the commit hash in both docs and MEMORY.md to $CURRENT_SHA.
EOF
