# Social Sandbox

An NPC social simulation where LLM-driven characters live in a small tilemap world, form relationships, keep secrets, make and break promises, and speak their conversations out loud via real-time TTS.

Characters are scored against each other by a "Director" that picks the most dramatically interesting pair at any moment, pre-generates their entire conversation, and plays it back when they meet on the map. Conversations feed back into each NPC's emotions, memories, relationships, and narrative arc.

## Features

- **Spatial world** — tilemap with A\* pathfinding, 14 solo activities (fishing, reading, gardening…), 22 interaction types, collision, emotion-weighted waypoint selection. Three levels: `village`, `mall`, `testmap`.
- **Director pipeline** — scores pairs across ~15 dramatic signals (reactive impulses, relationship velocity, secrets, grudges, love triangles, isolation, …), runs scene direction + full-conversation generation in a single LLM call per exchange.
- **Stateful NPCs** — 7-dimensional emotions, derived persistent moods, per-pair 8-axis relationships with velocity tracking, dual short/long-term memory, secrets & known secrets, inventory with decay, character arcs.
- **Reactive chains** — dramatic events (betrayals, threats, conspiracies, eavesdropping) create high-urgency impulses that virtually guarantee the next conversation.
- **Multi-provider LLM** — Ollama (local), Groq, Gemini, or Claude. Configurable from the in-app settings panel; keys persist in `localStorage`.
- **Dual-engine TTS** — Chatterbox Turbo (English, expressive) + Kokoro (multilingual). Custom voice cloning from uploaded audio or YouTube extraction.
- **Producer tools** — live feed of director decisions, confessional panel, relationship graph, reactive NPC indicators.

## Requirements

- Node 20+ and `npm`
- Python 3.10+ (for the TTS servers) with two separate venvs:
  - `tts-server/.venv-chatterbox` — Chatterbox Turbo
  - `tts-server/.venv` — Kokoro + Flask proxy
- An LLM backend — either a running [Ollama](https://ollama.ai) instance, or an API key for Groq / Gemini / Claude

TTS is optional; the sim runs without it, you just won't hear anything.

## Install

```bash
npm install

# Chatterbox venv (English voice + cloning)
python3 -m venv tts-server/.venv-chatterbox
tts-server/.venv-chatterbox/bin/pip install chatterbox-tts flask flask-cors soundfile

# Kokoro venv (multilingual + proxy)
python3 -m venv tts-server/.venv
tts-server/.venv/bin/pip install kokoro soundfile flask flask-cors requests
```

## Run

Starts the Vite dev server plus both TTS servers:

```bash
npm run start
```

Or just the frontend (no audio):

```bash
npm run dev
```

Open the app, pick an LLM provider in the settings panel, spawn NPCs from the side panel, and watch.

### Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server only |
| `npm run tts` | Chatterbox server (port 8788) |
| `npm run tts:main` | Kokoro + proxy server (port 8787) |
| `npm run tts:restart` | Restart the Chatterbox server |
| `npm run tts:clear` | Clear the TTS audio cache |
| `npm run build` | Type-check and production build |
| `npm run lint` | ESLint |

## Project Layout

```
src/
  conversation-manager.ts   Director pipeline — pair scoring, scene direction, generation
  world-simulation.ts       285ms tick — pathfinding, activities, interactions, proximity
  day-cycle.ts              Phase transitions, promise resolution, emotion/memory decay
  prompt-builder.ts         Assembles LLM prompts from NPC state
  ollama.ts                 Quad-provider LLM client with Groq rate-limit tracking
  llm-config.ts             Provider config + localStorage persistence
  tts-service.ts            TTS client, voice cloning, audio cache
  npcs.ts / npc-store.ts    NPC identity, state, and store
  types.ts                  Shared types — emotions, memories, relationships, plans
  confessional.ts           Confessional scene logic
  memory-service.ts         Memory promotion, recency decay, retrieval
  interactions.ts           22 interaction type definitions
  activities.ts             14 activity type definitions
  sprite-system.ts          Character sprite rendering
  tilemap-renderer.ts       Canvas tilemap drawing
  response-parser.ts        Parses batched LLM conversation output
  components/               React UI — DirectorDashboard, WorldCanvas, SidePanel, …
tts-server/
  server.py                 Flask proxy — routes Chatterbox/Kokoro, handles cloning
  chatterbox_server.py      Dedicated Chatterbox Turbo server
  voices/                   13 built-in voice refs + custom_*.wav clones
public/assets/levels/       village.tmj, mall.tmj, testmap.tmj (Tiled maps)
```

## Architecture

For deeper implementation detail, see the `memory/` reference docs:

- **`memory/architecture.md`** — the three runtime loops (Director 5s, World 285ms, DayCycle ~2min), mechanism systems (reactive chains, witness, soliloquy, contagion, betrayal discovery), NPC state model, data flows.
- **`memory/code-graph.md`** — dependency matrix and per-file API docs.

## License

No license specified — all rights reserved by default.
