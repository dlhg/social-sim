# Producer Tools — Design Document

## Concept

Three features layered onto the existing social simulation, no structural changes to the game loop:

1. **Relationship Graph** — a live visualization of the social network. Nodes are NPCs, edges are relationships. Updates in real time as conversations resolve. Makes the invisible data visible.
2. **Confessional** — the player can pull any NPC aside at any time, ask them a question, and get a voiced response. The question subtly influences the NPC's emotional state. The player's only direct line to the characters.
3. **Event Visualization Overhaul** — the existing floating text system only shows 3 of 25+ significant event types. Secrets, promises, betrayals, actions, mood changes, and reactive impulses all happen invisibly. This feature surfaces them through expanded floaters, persistent NPC indicators, and anticipation cues.

The sim keeps running exactly as it does today. The Director picks pairs, generates conversations, NPCs wander and interact. These features give the player a window into what's happening (graph), a tool to nudge it (confessional), and a richer real-time feed of what's unfolding (event visualization).

---

## Feature 1: Relationship Graph

### What It Shows

A force-directed graph rendered as a togglable overlay or slide-out panel. Each NPC is a node (portrait + name). Each relationship is an edge between two nodes.

**Edge encoding** (all data already exists in `RelationshipState`):

| Visual Property | Data Source | Encoding |
|---|---|---|
| Color | `regard` (-1 to 1) | Orange (negative) → gray (neutral) → blue (positive). Gradient, not binary. Colorblind-safe palette — avoids red-green encoding |
| Thickness | `abs(regard)` + `affection` | Thicker = stronger relationship (love or hate). Thin = indifference |
| Style | `trust` | Solid line (trust > 0.4) → dashed (trust 0.2–0.4) → dotted (trust < 0.2) |
| Glow/pulse | velocity (warming/deteriorating) | Edges that are actively changing pulse. Static relationships are static lines |
| Arrow icon | directional asymmetry | If A→B regard differs significantly from B→A, show a small directional indicator. One-sided love, secret hatred, etc. |

**Node encoding:**

| Visual Property | Data Source | Encoding |
|---|---|---|
| Border color | persistent `mood` | Matches mood color (red = volatile, blue = melancholy, gold = euphoric, etc.). No mood = neutral border |
| Size | number of strong connections | More strong relationships (|regard| > 0.4) = slightly larger node. Visual shorthand for "central" vs "isolated" NPCs |
| Badge/icon | state flags | Small icons for: has unrevealed secret (lock icon), active grudge (fire), recent betrayal (broken shield), pending promise (handshake) |

### Interaction

The graph is not just a display — it's a navigation tool:

- **Hover a node** → tooltip showing NPC's current emotional state (7 axes as small bars), mood, current goal, and location on the map
- **Click a node** → camera pans to that NPC on the world canvas. If they're in a conversation, highlights it
- **Hover an edge** → tooltip showing the notable relationship axes (|value| > 0.3 or recently changed), with a "show all" toggle for the full 8-axis breakdown. Plus the velocity label (warming/cooling/stable) and how many conversations they've had. Most relationships have 2-3 interesting axes — showing all 8 by default is a wall of numbers
- **Click an edge** → shows recent memory highlights between this pair — last 3 conversation summaries, any betrayals, promises, witnessed actions. A quick "story so far" for this relationship
- **Click a node to open confessional** → shortcut to pull that NPC into the confessional (see Feature 2)

### Layout

**Damped force-directed physics:**
- Nodes repel each other (standard charge repulsion)
- Edges pull connected nodes together, with spring strength proportional to `familiarity` (NPCs who talk often cluster together)
- High-regard pairs cluster tightly. Low-regard pairs are pushed apart but still connected (the angry orange line stretching across the graph is visually dramatic)
- Isolated NPCs (low familiarity with everyone) drift to the periphery

**Layout stability:** Run the force simulation to settle on initial load, then freeze node positions. Edge visuals (color, thickness, style, pulse) update continuously as relationships change. Node positions only re-layout on significant topology changes: a new strong connection forming (|regard| crossing 0.4), a relationship flipping sign, or an NPC being added/removed. This gives the player spatial memory of "where Marcus is on the graph" while keeping edge encoding fully live. Avoids the jitter problem where every 0.1 regard shift causes nodes to drift around.

### Event Feed

Below or beside the graph, a scrolling feed of *relationship-structural* events — not every emotion delta (the canvas floaters handle that), but the strategic shifts that change the shape of the social network:

```
[2:14 PM]  🔥 Marcus and Elena — trust collapsed (-0.3) after confrontation
[2:12 PM]  💚 Kai and Sofia — warming trend, 3rd positive interaction today
[2:10 PM]  🔓 Jordan discovered Priya's secret via gossip
[2:08 PM]  🤝 Marcus promised Kai "I'll have your back"
[2:05 PM]  👁️ Elena witnessed Sofia mock Jordan
```

This gives the graph feed a distinct purpose from the canvas floaters: strategic overview vs. tactical play-by-play. Events that qualify: trust/regard crossing a threshold, new strong connection formed, secret changing hands, promise made/broken, betrayal discovered, relationship flipping sign. Derived from existing system events — no new data.

### Implementation

**What exists:**
- All relationship data: `RelationshipState` with 8 axes per pair, velocity tracking (last 10 snapshots)
- All NPC state: emotions, mood, secrets, grudges, promises, goals, memories
- Conversation outcome events (post-conversation write-back applies deltas to the store)
- `NpcStore` has `getRelationship(a, b)` and `getAll()` — everything needed to build the graph data

**What's new:**
- `src/components/RelationshipGraph.tsx` — React component rendering the force-directed graph. Use canvas (for performance) or SVG (for easier interaction/tooltips). With up to 13 NPCs (78 edges), SVG is still viable but should be profiled. Throttle graph re-renders to every 500ms, not every frame.
- Force-directed layout engine — use `d3-force` or a lightweight equivalent. Run to settle on mount, then freeze positions. Re-run only on significant topology changes (see Layout section).
- Event feed data — subscribe to NPC store changes and conversation completion callbacks. Format events into the feed. Store last ~50 events in a ring buffer.
- Toggle/panel UI — a button on the main screen to show/hide the graph panel. Could be a resizable sidebar or a full overlay.

**No changes to existing systems.** This is purely additive visualization — it reads from the store, it doesn't write to it.

---

## Feature 2: Confessional

### What It Is

The player clicks an NPC and asks them a question. The NPC responds in character, with TTS voice. The question subtly shifts the NPC's emotional state. That's it.

This is the player's one direct interaction with the simulation. Everything else is observation (watching conversations, reading the graph). The confessional is where the player reaches in and touches the system.

### How It Works

**Trigger:** Player clicks an NPC (via the graph, or via a portrait bar, or directly on the world canvas). A confessional panel opens.

**Question selection:** The player sees 3-4 contextual question prompts plus a free-text option:

- Questions are generated from the NPC's recent state, not hardcoded. The generation logic checks:
  - **Recent conversations**: "How do you feel about your conversation with [NPC] just now?"
  - **Relationship extremes**: "What do you really think about [highest-regard NPC]?" / "Is there someone here you don't trust?"
  - **Active state flags**: "You seem [mood] lately — what's going on?" (if mood is active), "You've been keeping a secret — is it weighing on you?" (if has unrevealed secret), "Are you going to keep your promise to [NPC]?" (if has pending promise)
  - **Goal-related**: "What are you trying to accomplish here?"
  - **Generic fallback**: "How are you feeling right now?"

- Question generation is **template-driven, not LLM-generated**. Templates with slots filled from NPC state:
  ```
  templates = [
    { condition: recentConversation, text: "How do you feel about what happened with {other_npc}?" },
    { condition: hasMood("volatile"), text: "You seem on edge — what's bothering you?" },
    { condition: hasSecret, text: "Is there something you haven't told anyone?" },
    { condition: lowTrustWithSomeone, text: "Is there someone here you don't trust?" },
    { condition: pendingPromise, text: "Are you going to follow through on what you told {promise_target}?" },
  ]
  ```
- Filter to 3-4 that match current state, plus always show the free-text input

**NPC response:**

Single LLM call using a new `buildConfessionalMessages()` prompt:

- Same NPC context as a soliloquy (emotions, memories, arc, relationships, secrets, mood, goal) — the NPC knows everything they know
- Framed as direct address: "You're speaking candidly to someone who asked you: [question]. Respond honestly in 2-3 sentences, in your own voice."
- Personality modulates honesty:
  - High trust + low cunning → raw, unfiltered truth
  - Low trust + high cunning → evasive, strategic, maybe deflecting
  - High anger → may vent about whoever they're angry at regardless of the question
  - High guilt → may confess something unprompted
- Output: JSON with `response` (2-3 sentences of direct speech for TTS), `mentioned_npc` (name or null), and `sentiment_toward_mentioned` ("positive" | "negative" | "neutral" | null). The structured fields drive the leading question influence system (see below) — the LLM understands context, negation, and sarcasm that keyword scanning would miss

**TTS playback:** The response goes through the existing TTS pipeline (the NPC's assigned voice). Brief loading state is fine — the player just asked a question, they're waiting for an answer. Narratively justified.

### Leading Question Influence

The question isn't just a read — it's a write. Asking a question subtly shifts the NPC's state:

**Named-NPC questions** ("What do you think about [NPC_B]?"):
- Small emotional nudge toward whatever the NPC already feels about NPC_B
- If regard for B is negative → anger +0.02, trust -0.01 toward B (the question reminds them of their grievance)
- If regard for B is positive → joy +0.01, affection +0.01 toward B (the question makes them reflect warmly)
- The nudge is tiny per confessional but cumulative. Three confessionals asking about the same rival = a noticeable anger buildup

**Leading/loaded questions** ("Don't you think [NPC_B] has been disrespectful to you?"):
- Sentiment detection is handled by the LLM response itself — the `mentioned_npc` and `sentiment_toward_mentioned` fields from the structured output tell us who the NPC is thinking about and in what direction. No keyword scanning needed. The LLM understands negation ("Don't you think Marcus is *loyal*?" → positive), sarcasm, and indirect framing that a keyword scan would misclassify
- Negative sentiment → anger +0.03, trust -0.02 toward the mentioned NPC
- Positive sentiment → trust +0.02, affection +0.01
- This is the player's manipulation tool. No PP cost, no unlock — just words. But the effects are small enough that you can't mind-control an NPC with one question

**Mood/emotion questions** ("You seem angry — what's going on?"):
- Asking about an emotion amplifies it slightly: anger question → anger +0.01, sadness question → sadness +0.01
- The NPC is dwelling on the feeling because you asked about it

**Diminishing returns:** Track confessional count per NPC per day-cycle phase. First confessional has full effect. Second has 50% effect. Third has 25%. After 3 confessionals with the same NPC in the same phase, the influence stops (but you can still ask questions for intel). Resets each day phase.

**Visible diminishing returns:** The player needs to *know* when returns are diminishing, or they'll think the mechanic is broken. Pass the diminishing returns multiplier into the prompt so the LLM generates increasingly curt/distracted responses as the NPC tires of questioning. At 50% effectiveness, the NPC is shorter and less forthcoming. At 25%, they're visibly annoyed or distracted. At 0% (influence exhausted), the panel shows a character-appropriate dismissal: *"Elena seems preoccupied"* or *"Marcus clearly isn't listening anymore."* The NPC's engagement level is the feedback — not a UI indicator.

**Secret/promise questions:** Asking "Are you going to keep your promise to [NPC]?" doesn't mechanically resolve the promise, but it might shift the NPC's guilt or commitment. Asking about secrets doesn't reveal them to other NPCs — the confessional is private.

### What the Player Sees

The confessional panel shows:
- NPC portrait + name + current mood badge
- Current emotional state (same 7 bars from the graph tooltip)
- 3-4 question buttons + free-text input
- After asking: the NPC's response text appears, TTS plays. State shifts from the confessional are shown as standard floaters on the world canvas (same system as conversation-driven shifts), connecting the confessional to the event visualization naturally — the player sees the ripple of their question propagate into the world
- No explicit numerical indicators in the confessional panel itself. The player observes effects through the NPC's tone of response, floaters on the canvas, and downstream changes on the relationship graph. The design philosophy is "felt, not read" — asking questions has consequences the player discovers by watching, not by reading debug output

### Constraints

- **One NPC at a time.** You can't rapid-fire confessionals to the whole cast simultaneously.
- **NPC must not be in a conversation or seeking one.** If the NPC is currently talking to someone, the confessional button is grayed out ("In conversation — try again in a moment"). Also grayed out during seek behavioral overrides (when the Director has selected them for the next conversation and they're walking toward their partner) — this prevents race conditions where a confessional shifts emotional state right before a conversation the Director already generated context for. The "next pair" preview line (Feature 3) helps the player understand *why* the NPC is unavailable.
- **No mechanical cost.** Confessionals are free and unlimited (subject to diminishing returns). The cost is the player's attention — while you're in the confessional, the sim keeps running and you might miss something.
- **Confessional doesn't pause the sim.** The world keeps ticking. Other NPCs keep moving, the Director keeps scheduling. This creates natural tension: do you spend time probing one NPC, or watch the broader dynamics unfold?
- **Out-of-character input handling.** The player can type anything in free-text. The `buildConfessionalMessages()` prompt must include a guardrail: the NPC responds *as their character would* to confusing, irrelevant, or inappropriate questions — with confusion, deflection, irritation, or amusement depending on personality. The NPC never breaks character or responds as an AI assistant. Prompt injection attempts should be met with in-character bewilderment.

### Implementation

**What exists:**
- Soliloquy prompt builder (`buildSoliloquyMessages()` in prompt-builder.ts) — similar structure, can be used as a starting point
- LLM client (`ollama.ts`) — all 4 providers, streaming support
- TTS pipeline (`tts-service.ts`) — voice assignment, generation, playback
- NPC state access — `NpcStore` has all emotion, relationship, memory, secret, promise data
- Conversation activity tracking — `ConversationManager` tracks who's talking

**What's new:**
- `buildConfessionalMessages()` in `prompt-builder.ts` — new prompt function. Takes: NPC state (same context as soliloquy) + player question string + diminishing returns multiplier. Returns: messages array for LLM call. Output schema: `{ response, mentioned_npc, sentiment_toward_mentioned }`. Includes character-anchoring guardrail for out-of-character input. ~40-60 lines
- Confessional question templates in `src/confessional.ts` — template definitions, condition matching against NPC state, slot filling. ~80-120 lines
- Leading question influence logic in `src/confessional.ts` — reads `mentioned_npc` and `sentiment_toward_mentioned` from LLM response to determine state nudges (no keyword scanning). State nudge application via existing `applyEmotionDelta()` / `applyRelationshipDelta()`. Diminishing returns tracking (per NPC per day phase). Emits floaters for state shifts via `onFloater` callback. ~50-70 lines
- `src/components/ConfessionalPanel.tsx` — React component for the UI. Portrait, emotion bars, question buttons, free-text input, response display, TTS playback trigger, influence indicator. ~150-200 lines
- Integration in `App.tsx` or `WorldCanvas.tsx` — confessional trigger on NPC click, panel mount/unmount. ~20-30 lines

**Changes to existing systems:**
- None structurally. The confessional reads NPC state, makes one LLM call, applies small emotion/relationship deltas via existing `applyEmotionDelta()` and `applyRelationshipDelta()` methods, and emits floaters for state shifts via the existing `onFloater` callback. All the infrastructure exists.

---

## Feature 3: Event Visualization Overhaul

### Current State

The floating text system (`FloaterData` in types.ts, rendered in WorldCanvas.tsx, created in conversation-manager.ts) currently shows only 3 event types:

| What's shown | Format | Example |
|---|---|---|
| Emotion deltas | `+emotion` / `-emotion` | `+JOY`, `-TRUST` |
| Regard deltas | `♥ +0.25 name` / `♡ -0.15 name` | `♥ +0.25 Marcus` |
| Forgiveness | `forgave name` | `forgave Elena` |

The `FloaterCategory` type already defines `"secret"` and `"promise"` categories, but they're never emitted. Meanwhile, ~20 other significant event types (actions, betrayals, eavesdropping, mood changes, reactive impulses) happen with zero visual feedback — the player can only see them by reading the activity log.

### What to Add

Three layers: expanded floaters for conversation events, persistent indicators on NPC sprites, and anticipation cues for brewing drama.

#### Layer 1: Expanded Floaters

New floater emissions in `conversation-manager.ts`, using the existing `FloaterData` system and CSS animation. No new rendering code — just more calls to the existing `onFloater` callback.

**Narrative event floaters** (high-impact moments during conversations):

| Event | Floater Text | Color | Category | Trigger Location |
|---|---|---|---|---|
| Secret revealed | `🔓 secret revealed` | `#ffab40` (amber) | `secret` | `processSecretReveal()` |
| Secret spread (gossip) | `🔓 gossiped to {name}` | `#ffcc80` (light amber) | `secret` | gossip handling in `applyConversationTurn()` |
| Promise made | `🤝 promised {name}` | `#81d4fa` (light blue) | `promise` | `processPromise()` |
| Promise broken | `💔 broke promise to {name}` | `#ef5350` (red) | `promise` | promise resolution in day-cycle callback |
| Betrayal discovered | `⚡ discovered betrayal` | `#ff6e40` (deep orange) | `relationship` | `discoverBetrayal()` path |

**Action floaters** (visible actions performed during conversation):

| Action | Floater Text | Color | Category |
|---|---|---|---|
| `embrace` | `embraced {name}` | `#f48fb1` (pink) | `relationship` |
| `give_gift` | `gave gift to {name}` | `#81c784` (green) | `relationship` |
| `mock` | `mocked {name}` | `#ff8a65` (orange) | `relationship` |
| `threaten` | `threatened {name}` | `#ef5350` (red) | `relationship` |
| `storm_off` | `stormed off` | `#b0bec5` (gray) | `emotion` |
| `conspire` | `conspired against {name}` | `#7e57c2` (purple) | `secret` |
| `spread_rumor` | `spread rumor about {name}` | `#ab47bc` (violet) | `secret` |

**Eavesdrop floater** (on the eavesdropping NPC, not the speakers):

| Event | Floater Text | Color | Category |
|---|---|---|---|
| Eavesdrop | `👂 overheard {speaker}` | `#b0bec5` (muted gray) | `emotion` |

**Relationship dimension floaters** — replace the single regard floater with richer per-dimension feedback:

Currently: `♥ +0.25 Marcus` (only regard, only one floater per turn)

New: show the 1-2 most significant relationship axis changes per turn, using dimension-specific labels:

| Dimension | Positive Floater | Negative Floater | Color (pos) | Color (neg) |
|---|---|---|---|---|
| `regard` | `regard ↑ {name}` | `regard ↓ {name}` | `#66bb6a` | `#ef5350` |
| `affection` | `affection ↑ {name}` | `affection ↓ {name}` | `#f48fb1` | `#78909c` |
| `trust` | `trust ↑ {name}` | `trust ↓ {name}` | `#4fc3f7` | `#ff7043` |
| `respect` | `respect ↑ {name}` | `respect ↓ {name}` | `#ffb74d` | `#90a4ae` |
| `fear` | `fear ↑ {name}` | `fear ↓ {name}` | `#ce93d8` | `#81d4fa` |
| `disgust` | `disgust ↑ {name}` | `disgust ↓ {name}` | `#a1887f` | `#80cbc4` |

Filter: only show dimensions with `|delta| >= 0.03` (higher threshold than emotions, since there are more axes and we don't want floater spam). Show top 2 dimensions max per turn. Regard keeps the filled/hollow heart prefix (`♥`/`♡`) for visual continuity. Other dimensions use the arrow notation.

**Floater priority and spam control:**

With more floater types, we need to avoid overwhelming the screen. Rules:
- **Max 6 floaters per NPC per conversation turn.** If more events qualify, show the highest-impact ones (narrative events > actions > relationship dimensions > emotions).
- **Narrative events always show.** Secret reveals, betrayals, and promise breaks are rare and high-impact — never suppress them.
- **Action floaters suppress congruent emotion floaters only.** If an NPC mocked someone, the player can infer anger from the action — the `+ANGER` floater is redundant. But if the same turn also produces `+GUILT` (the NPC feels bad about it), that's *not* implied by the action and should still show. When an action floater fires, suppress only emotions that are congruent with the action (mock → suppress anger/disgust, embrace → suppress joy/affection), not all emotions. Incongruent emotions are often the most interesting signals.
- **Stagger timing.** Narrative events: 0ms delay (show immediately). Actions: 500ms delay. Relationship dimensions: 1500ms delay. Emotions: 2500ms delay. This creates a readable cascade: big event → action → relationship shift → emotion ripple.

#### Layer 2: Persistent NPC Indicators

These are not floaters (which drift and fade). These are persistent visual elements attached to the NPC sprite or name tag that stay visible as long as the condition is true.

**Mood indicator:**

A small colored dot or icon near the NPC's name tag, visible at normal zoom:

| Mood | Indicator | Color |
|---|---|---|
| `volatile` | 🔥 (or red dot) | `#ff5252` |
| `paranoid` | 👁 (or purple dot) | `#7c4dff` |
| `bitter` | ❄ (or dark blue dot) | `#455a64` |
| `melancholy` | 💧 (or blue dot) | `#42a5f5` |
| `guilt-ridden` | ⚖ (or olive dot) | `#8d6e63` |
| `restless` | ⚡ (or yellow dot) | `#ffd740` |
| `euphoric` | ✨ (or gold dot) | `#ffd54f` |
| no mood | nothing | — |

Mood already has a 1-minute persistence requirement before it shows in prompts. Use the same threshold for the indicator — no flickering for momentary emotional spikes. Additionally, once a mood indicator appears, it stays visible for a minimum of 30 seconds even if the mood clears — prevents flicker if mood toggles near the persistence threshold.

Implementation: in WorldCanvas.tsx's NPC rendering pass, check `npc.mood` and `npc.moodSince` against the 1-minute threshold. Render a small colored dot offset from the name tag. CSS transition on opacity so it fades in/out smoothly when mood changes. Use colored dots or simple geometric shapes rather than emoji — canvas emoji rendering is inconsistent across platforms.

**State flag badges:**

Small icons rendered beside or below the NPC name tag, showing active state flags:

| Flag | Condition | Badge | Visibility |
|---|---|---|---|
| Has unrevealed secret | `npc.secrets.length > 0` AND not all known by others | 🔒 | Always visible to player (dramatic irony) |
| Active grudge | Betrayal where this NPC is the victim AND `discoveredByVictim = true` (they've learned they were betrayed and now hold a grudge) | 🔥 | Visible after discovery |
| Pending promise | Active promise where this NPC is the promisor | 🤝 | Always visible |
| Broken promise (recent) | Promise broken in last 2 day phases | 💔 | Fades after 2 phases |
| Avoiding someone | Active behavioral override with mode "avoid" | 🚫 | Visible during override |

Max 3 badges shown at once (prioritized by dramatic value: grudge > broken promise > secret > promise > avoiding). Badges are small (8-10px) and positioned in a row below the name tag.

Implementation: in WorldCanvas.tsx's NPC rendering pass, query NpcStore for the NPC's state flags and render badge indicators. **Use colored dots or simple geometric shapes (small circles, diamonds, squares) rather than emoji** — canvas emoji rendering is inconsistent across OS/browser and illegible at 8-10px. Reserve emoji for HTML-rendered floaters where they display reliably. Badge shapes: grudge = red diamond, broken promise = red circle, secret = amber square, promise = blue circle, avoiding = gray circle.

#### Layer 3: Anticipation Cues

Visual indicators that something is *about to happen* — not a past event, but a brewing future one.

**Reactive impulse indicator:**

When an NPC has an active reactive impulse (urgency > 0), show a subtle visual cue that they have "unfinished business":

- A small thought-bubble icon (💭) near their head, pulsing gently
- Pulse speed proportional to urgency (higher urgency = faster pulse)
- Tooltip on hover: "Has something on their mind" (vague — don't reveal who or why, just that drama is brewing)
- Disappears when the impulse is consumed (the Director schedules their conversation) or expires

This creates anticipation. The player sees an NPC with a pulsing thought bubble and knows: something is about to happen with this person. They might pan the camera to follow them, or open the confessional to probe what's going on.

Implementation: `NpcStore` already tracks reactive impulses in `impulses` arrays per NPC. WorldCanvas checks for active impulses during the NPC render pass and renders the pulsing icon. CSS animation for the pulse.

**Director "next pair" preview:**

When the Director has selected and is generating the next conversation, show a subtle connecting line between the two NPCs on the world canvas — a faint dotted line or gentle particle trail. This tells the player "these two are about to talk."

The Director already creates behavioral overrides (seek mode) to bring NPCs together before a conversation plays. The visual line reinforces this — the player sees two NPCs being drawn together and can anticipate the encounter.

Implementation: requires a new `onGenerationStart` callback in `ConversationManagerCallbacks` (does not exist yet — the current callback interface has `onConversationStart`, `onConversationEnd`, `onSpeakerChange`, etc. but nothing at the generation/batch level). Emit the callback when the Director begins generating a conversation, passing the NPC pair IDs. App.tsx stores the active pair and passes it to WorldCanvas, which renders the connecting line. Clear on `onConversationStart`. Faint, animated, non-intrusive.

### Implementation

**What exists:**
- `FloaterData` type with `category` field (types.ts) — already supports `"secret"` and `"promise"` categories
- `onFloater` callback chain (conversation-manager.ts → App.tsx → WorldCanvas.tsx) — the full pipeline for creating and rendering floaters
- Floater CSS with category-specific classes (`.floater-emotion`, `.floater-relationship`, `.floater-secret`, `.floater-promise`) — the secret/promise styles may need to be added to CSS but the class structure is ready
- NPC render pass in WorldCanvas.tsx — already draws names, speech bubbles, thought bubbles. Adding mood dots and badges is straightforward
- All the data: NpcStore has mood, secrets, promises, betrayals, impulses. ConversationManager has actions, eavesdrop events, relationship deltas with full dimension breakdown

**What's new:**

*Layer 1 (expanded floaters):*
- New floater emissions in `conversation-manager.ts` — add `onFloater()` calls in: `processSecretReveal()`, `processPromise()`, action handling in `applyConversationTurn()`, eavesdrop callback, betrayal discovery path. ~60-80 lines of new emit calls spread across existing functions
- Replace regard-only relationship floater with dimension-aware floater logic — scan all 6 relationship axes for significant deltas, pick top 2, format with dimension labels. ~30-40 lines replacing existing `logRelationshipShift()`
- Floater priority/spam control — max 6 per turn, category priority ordering, suppress redundant emotion floaters when action floaters fire. ~20-30 lines
- New CSS for `.floater-secret`, `.floater-promise` categories if not already styled, plus action-specific color variables. ~15-20 lines
- Stagger timing adjustments — category-based delay offsets in the floater emission logic. ~10 lines

*Layer 2 (persistent indicators):*
- Mood indicator rendering in WorldCanvas.tsx — check `npc.mood` + `moodSince` against 1-minute threshold, render colored dot near name tag with CSS fade transition, 30-second minimum display. ~20-30 lines
- State flag badge rendering in WorldCanvas.tsx — query NpcStore for secrets, grudges, promises, overrides per NPC, render colored geometric shapes (not emoji) in a row below name. Batch NpcStore queries for performance. ~40-50 lines
- Badge priority logic — pick top 3 from available flags. ~10 lines

*Layer 3 (anticipation cues):*
- Reactive impulse indicator in WorldCanvas.tsx — check NpcStore impulses, render pulsing thought-bubble icon, pulse speed from urgency. ~25-30 lines
- Impulse pulse CSS animation — keyframes with variable speed. ~10 lines
- Director "next pair" preview line — new `onGenerationStart` callback in `ConversationManagerCallbacks` (net-new plumbing), emit from Director generation entry point. Store active pair in App.tsx, render dotted connecting line between NPC positions in WorldCanvas, clear on `onConversationStart`. ~30-40 lines (including callback plumbing)

**Total new code: ~250-350 lines**, mostly small additions spread across existing files. No new components needed — this is all within WorldCanvas.tsx, conversation-manager.ts, and App.css.

---

## Implementation Plan

Staging rationale: start with changes that improve the existing experience before adding new panels. Floater improvements make the world canvas more readable immediately. Persistent indicators and anticipation cues build on that foundation. The confessional gives the player agency — and by that point the event system is surfacing enough information that the player has *context* for good confessional questions. The relationship graph is the most complex, most optional feature — an analytical overlay the game works without. Build it last when the other features have proven the concept.

### Stage 1: Expanded Floaters (Event Visualization Layer 1)
**Goal:** The player can see everything significant happening in the simulation, not just emotion deltas. Highest ROI, lowest effort — ~100 lines of new emit calls in existing functions, no new components.

**Tasks:**
1. Narrative event floaters — add `onFloater()` calls in `processSecretReveal()`, `processPromise()`, betrayal discovery path, and promise resolution. Secret reveals get amber, promises get blue, betrayal discovery gets deep orange, broken promises get red.
2. Action floaters — emit floaters for `embrace`, `give_gift`, `mock`, `threaten`, `storm_off`, `conspire`, `spread_rumor` in action handling within `applyConversationTurn()`. When an action floater fires, suppress only congruent emotion floaters for the same turn (mock → suppress anger/disgust, but not guilt; embrace → suppress joy, but not sadness).
3. Eavesdrop floaters — emit a muted gray `👂 overheard {speaker}` floater on the eavesdropping NPC (not the speakers).
4. Dimension-aware relationship floaters — replace the single regard floater with per-dimension feedback. Scan all relationship axes for `|delta| >= 0.03`, show top 2 with dimension labels (`trust ↓ Marcus`, `affection ↑ Sofia`). Regard keeps the heart prefix for continuity.
5. Floater priority and stagger — max 6 floaters per NPC per turn. Priority: narrative events > actions > relationship dimensions > emotions. Stagger delays: narrative 0ms, actions 500ms, relationships 1500ms, emotions 2500ms.

**Milestone:** A conversation plays out — the player sees `🔓 secret revealed` float up in amber, followed by `trust ↓ Marcus` and `disgust ↑ Marcus` in orange. An eavesdropping NPC shows `👂 overheard Sofia` in gray. When an NPC mocks someone and then feels guilty about it, the player sees `mocked Elena` followed by `+GUILT` — the incongruent emotion that tells the real story. The world canvas goes from showing 3 event types to showing 25+, and the game immediately feels richer.

### Stage 2: Persistent Indicators + Anticipation Cues (Event Visualization Layers 2-3)
**Goal:** NPCs carry persistent visual state and the player can see drama brewing before it happens.

**Tasks (Layer 2 — persistent indicators):**
1. Mood indicator — colored dot near NPC name tag in WorldCanvas.tsx. Check `npc.mood`, render with 1-minute persistence threshold (matches prompt injection threshold). Smooth CSS fade transition on change. Minimum display duration of 30 seconds once shown (prevents flicker if mood toggles near threshold).
2. State flag badges — colored geometric shapes below NPC name tag (not emoji — canvas emoji rendering is inconsistent at 8-10px): red diamond (grudge), red circle (broken promise), amber square (secret), blue circle (promise), gray circle (avoiding). Max 3 badges, prioritized by dramatic value. Query NpcStore per render pass, batch queries for performance.

**Tasks (Layer 3 — anticipation cues):**
3. Reactive impulse indicator — pulsing thought-bubble icon near NPC head when they have an active impulse. Pulse speed proportional to urgency. Tooltip: "Has something on their mind." Disappears when impulse is consumed or expires.
4. Director "next pair" preview — add `onGenerationStart` callback to `ConversationManagerCallbacks` (new plumbing). Faint dotted connecting line between the two NPCs the Director is currently generating a conversation for. Render in WorldCanvas, clear on `onConversationStart`.

**Milestone:** The canvas is now information-rich. An NPC who just discovered a betrayal has a red diamond badge and a volatile mood dot. A pulsing thought-bubble says they're about to act on it. A faint dotted line appears connecting them to the betrayer — the Director is already generating their confrontation. The player can *see the drama propagating* through the simulation in real time.

### Stage 3: Confessional
**Goal:** The player can talk to any NPC and influence the simulation through conversation. By this point, the event system is surfacing enough information that the player has *context* for meaningful confessional questions.

**Tasks:**
1. `src/confessional.ts` — question template system. Define ~10-15 templates with conditions (recent conversation, active mood, has secret, low trust, pending promise, goal-related, recent action witnessed, relationship with player-mentioned NPC). Template slot filling from NPC state. Filter to best 3-4 matches.
2. `buildConfessionalMessages()` in `prompt-builder.ts` — new prompt function. Same NPC context as soliloquy + player question + diminishing returns multiplier. Direct-address framing. Personality-modulated honesty. Character-anchoring guardrail for out-of-character input. Structured output: `{ response, mentioned_npc, sentiment_toward_mentioned }`.
3. Leading question influence logic in `src/confessional.ts` — reads `mentioned_npc` and `sentiment_toward_mentioned` from LLM response to determine state nudges. Apply small emotion/relationship deltas via existing store methods. Diminishing returns tracking (per NPC per day phase). Emit floaters for state shifts via `onFloater`.
4. `src/components/ConfessionalPanel.tsx` — UI panel. NPC portrait + emotion bars, question buttons + free-text input, response text display, TTS playback integration. No numerical influence indicators — effects visible through canvas floaters and graph.
5. Trigger integration — click NPC on world canvas to open confessional. Gray out if NPC is in a conversation or in seek behavioral override. Sim keeps running in background.
6. Wire TTS — send confessional response through existing TTS pipeline with the NPC's voice.

**Milestone:** The player pulls an NPC aside, asks "Is there someone here you don't trust?" The NPC responds in character with TTS voice. Floaters appear on the world canvas showing the subtle emotional shift. Over several confessionals, the player manufactures a feud between two NPCs who were previously neutral — then watches the Director naturally schedule their confrontation. On the third confessional in the same phase, the NPC is visibly annoyed and gives a curt, distracted answer.

### Stage 4: Relationship Graph
**Goal:** The player can see the full social network as a live analytical overlay.

**Tasks:**
1. `src/components/RelationshipGraph.tsx` — damped force-directed graph with NPC portraits as nodes, relationship edges with color/thickness/style encoding. SVG-based for easy tooltips and interaction. Throttle re-renders to every 500ms.
2. Edge rendering — color gradient from orange→gray→blue based on regard (colorblind-safe), thickness from relationship intensity, solid/dashed/dotted from trust level, pulse animation for actively-changing relationships.
3. Node rendering — NPC portrait/avatar + name, mood-colored border, size scaled by connection count, badge shapes for secrets/grudges/promises.
4. Damped layout — force sim settles on mount, then freezes node positions. Re-runs only on significant topology changes (regard crossing 0.4, relationship flipping sign, NPC added/removed). Edge visuals update continuously.
5. Hover tooltips — node hover shows emotional state bars + mood + goal + location. Edge hover shows notable relationship axes (|value| > 0.3 or recently changed) with "show all" toggle.
6. Click interactions — click node to pan camera to NPC on world canvas and open confessional. Click edge to show recent memory highlights between the pair.
7. Structural event feed — scrolling log of relationship-structural events only (trust/regard crossing threshold, secret changing hands, promise made/broken, betrayal discovered). Distinct purpose from canvas floaters: strategic overview vs. tactical play-by-play.
8. Toggle UI — button on main screen to show/hide the graph panel. Resizable sidebar or overlay.

**Milestone:** While conversations play out on the world canvas, the player can watch the relationship graph — alliances forming as blue clusters, feuds stretching orange lines across the graph, isolated NPCs at the periphery. The graph is stable (nodes don't drift around), but edges pulse and shift color as relationships evolve. Clicking a pulsing edge shows exactly what just happened.

### Stage 5: Polish + Integration
**Goal:** The three features feel like a cohesive experience.

**Tasks:**
1. Graph highlights during confessional — when a confessional response mentions another NPC (via the `mentioned_npc` field), their edge pulses on the graph. Makes the social web feel responsive to the player's actions.
2. "Stir the pot" moments — when the event feed shows a rare, high-impact event (betrayal discovered, trust collapse, secret revealed), flash a subtle prompt: "Want to ask [NPC] about this?" One-click confessional trigger timed to dramatic moments. Cooldown of 60 seconds between prompts to avoid nagging — only fire for genuinely rare events.
3. Confessional history — log of past confessional Q&A pairs per NPC, viewable from their graph node tooltip. The player can review what they've asked.
4. Graph camera sync — when a conversation plays out on the world canvas, the corresponding edge on the graph glows. When it resolves, the edge updates visibly (color shifts, thickness changes). The graph becomes a live companion to the spatial view.
5. Event feed integration — the structural event feed reflects all event types: secret reveals, betrayals, promise breaks, and action events alongside relationship threshold crossings. Timestamps and NPC portraits. The feed becomes a complete narrative log of the simulation.
