#!/usr/bin/env npx tsx
/**
 * Auto-generates the dependency matrix section of memory/code-graph.md
 * by parsing actual import statements from src/.
 *
 * Usage: npx tsx scripts/gen-dep-matrix.ts
 * Outputs the matrix to stdout. Replace the matrix block in code-graph.md.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(import.meta.dirname!, "..", "src");

// Abbreviated display names — keeps the matrix compact
const ABBREV: Record<string, string> = {
  "conversation-manager": "conv-mgr",
  "memory-service": "memory-svc",
  "world-simulation": "world-sim",
  "prompt-builder": "prompt",
  "response-parser": "parser",
  "sprite-system": "sprite",
  "tilemap-renderer": "tilemap",
  "premade-storage": "premade",
  "voice-storage": "voice-store",
  "tts-service": "tts-svc",
  "npc-store": "npc-store",
  "llm-config": "llm-config",
  "day-cycle": "day-cycle",
  "activities": "activities",
  "interactions": "interactions",
};

function abbrev(name: string): string {
  return ABBREV[name] ?? name;
}

// Collect all .ts/.tsx files recursively
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && entry !== "vite-env.d.ts") {
      results.push(full);
    }
  }
  return results;
}

// Canonical name from file path (strips components/ prefix and extension)
function canonicalName(filePath: string): string {
  return relative(SRC, filePath)
    .replace(/^components\//, "")
    .replace(/\.(ts|tsx)$/, "");
}

// Extract local import targets from a file
function getLocalImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const imports: string[] = [];
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let match;
  while ((match = re.exec(content))) {
    const target = match[1]
      .replace(/^\.\.\//, "")
      .replace(/^\.\//, "")
      .replace(/^components\//, "")
      .replace(/\.tsx?$/, "");
    imports.push(target);
  }
  return [...new Set(imports)];
}

const files = collectFiles(SRC);

// Build import map: canonical name -> Set<canonical target names>
const importMap = new Map<string, Set<string>>();
const allTargets = new Set<string>();

for (const file of files) {
  const name = canonicalName(file);
  const imports = getLocalImports(file);
  if (imports.length > 0) {
    importMap.set(name, new Set(imports));
    imports.forEach((t) => allTargets.add(t));
  }
}

// Columns = non-component importable modules only (the interesting part)
// Excludes component-to-component deps and App/main (which are entry points)
const componentNames = new Set(
  readdirSync(join(SRC, "components"))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => f.replace(/\.(ts|tsx)$/, ""))
);
const entryPoints = new Set(["App", "main"]);

const columns = [...allTargets]
  .filter((t) => !componentNames.has(t) && !entryPoints.has(t))
  .sort();

// Rows = all files that import something, sorted with core modules first, then components
const coreRows: string[] = [];
const componentRows: string[] = [];
for (const name of [...importMap.keys()].sort()) {
  if (name === "main") continue; // skip main.tsx (just imports App)
  if (componentNames.has(name) || entryPoints.has(name)) {
    componentRows.push(name);
  } else {
    coreRows.push(name);
  }
}
const rows = [...coreRows, ...componentRows];

// Column display names
const colLabels = columns.map(abbrev);
const rowLabels = rows.map(abbrev);

// Compute widths
const colWidths = colLabels.map((c) => Math.max(c.length, 1));
const labelWidth = Math.max(...rowLabels.map((r) => r.length), 6);

// Print
const header =
  " ".repeat(labelWidth + 2) +
  colLabels.map((c, i) => c.padEnd(colWidths[i])).join("  ");

console.log("Read as: row imports column.\n");
console.log("```");
console.log(header);

for (let r = 0; r < rows.length; r++) {
  // Print separator between core and component sections
  if (r === coreRows.length) {
    console.log("");
  }
  const deps = importMap.get(rows[r])!;
  const cells = columns.map((col, i) => {
    return (deps.has(col) ? "x" : " ").padEnd(colWidths[i]);
  });
  console.log(rowLabels[r].padEnd(labelWidth + 2) + cells.join("  "));
}
console.log("```");
