import type { DayPhase, DayCycleState, NpcPromise, NPC, EmotionalState } from "./types";
import type { NpcStore } from "./npc-store";
import type { ChatMessage } from "./ollama";
import { accumulateChat } from "./ollama";
import { extractJson } from "./response-parser";

export const PHASES: DayPhase[] = ["morning", "afternoon", "evening"];
const DEFAULT_TICKS_PER_PHASE = 400; // ~2 min at 285ms tick
const STALE_PHASE_THRESHOLD = 6; // promises without resolveAtPhase auto-break after 6 phases (~12 min)

export interface DayCycleOptions {
  ticksPerPhase?: number;
  onPhaseChange?: (state: DayCycleState) => void;
  onPlanResolved?: (promise: NpcPromise, outcome: string, promiserName: string, promiseeName: string) => void;
  npcStore: NpcStore;
  language?: string;
}

export class DayCycle {
  private state: DayCycleState = {
    day: 1,
    phase: "morning",
    phaseIndex: 0,
    ticksIntoPhase: 0,
  };

  private ticksPerPhase: number;
  private onPhaseChange: ((state: DayCycleState) => void) | null;
  private onPlanResolved: ((promise: NpcPromise, outcome: string, promiserName: string, promiseeName: string) => void) | null;
  private store: NpcStore;
  private resolving = false;
  private language: string;

  constructor(options: DayCycleOptions) {
    this.ticksPerPhase = options.ticksPerPhase ?? DEFAULT_TICKS_PER_PHASE;
    this.onPhaseChange = options.onPhaseChange ?? null;
    this.onPlanResolved = options.onPlanResolved ?? null;
    this.store = options.npcStore;
    this.language = options.language ?? "English";
  }

  getState(): Readonly<DayCycleState> {
    return this.state;
  }

  getPhase(): DayPhase {
    return this.state.phase;
  }

  getLabel(): string {
    return `Day ${this.state.day} — ${this.state.phase.charAt(0).toUpperCase() + this.state.phase.slice(1)}`;
  }

  /** Call once per world-simulation tick. */
  tick(): void {
    this.state.ticksIntoPhase++;

    if (this.state.ticksIntoPhase >= this.ticksPerPhase) {
      this.advancePhase();
    }
  }

  private advancePhase(): void {
    this.state.phaseIndex++;
    this.state.ticksIntoPhase = 0;

    const phaseOrdinal = this.state.phaseIndex % PHASES.length;
    this.state.phase = PHASES[phaseOrdinal];

    if (phaseOrdinal === 0) {
      this.state.day++;
    }

    this.onPhaseChange?.(this.getStateCopy());
    this.resolveMaturedPlans();
  }

  /** Assign a resolve phase to a newly-created promise (1-2 phases from now). */
  assignResolvePhase(promise: NpcPromise): void {
    const offset = 1 + Math.floor(Math.random() * 2); // 1 or 2 phases out
    promise.resolveAtPhase = this.state.phaseIndex + offset;
  }

  /** Resolve all plans whose deadline has passed, plus stale ones without a deadline. */
  private async resolveMaturedPlans(): Promise<void> {
    if (this.resolving) return;
    this.resolving = true;

    try {
      const currentPhase = this.state.phaseIndex;
      const promises = this.store.getPromises().filter(p => {
        if (p.status !== "active") return false;
        // Has a deadline that's passed
        if (p.resolveAtPhase != null && p.resolveAtPhase <= currentPhase) return true;
        // No deadline but old enough to expire
        if (p.resolveAtPhase == null) {
          const phasesSinceCreation = currentPhase - this.estimateCreationPhase(p);
          return phasesSinceCreation >= STALE_PHASE_THRESHOLD;
        }
        return false;
      });

      for (const promise of promises) {
        await this.resolveOnePlan(promise);
      }
    } finally {
      this.resolving = false;
    }
  }

  /** Estimate which phase a promise was created in based on its madeAt timestamp. */
  private estimateCreationPhase(promise: NpcPromise): number {
    const ageMs = Date.now() - promise.madeAt;
    const ageTicks = ageMs / 285; // approximate ticks since creation
    const agePhases = Math.floor(ageTicks / this.ticksPerPhase);
    return Math.max(0, this.state.phaseIndex - agePhases);
  }

  private async resolveOnePlan(promise: NpcPromise): Promise<void> {
    const promiser = this.store.get(promise.promiserId);
    const promisee = this.store.get(promise.promiseeId);
    if (!promiser || !promisee) {
      promise.status = "broken";
      return;
    }

    const outcome = await this.generateOutcome(promise, promiser, promisee);
    if (!outcome) {
      this.applyOutcome(promise, promiser, promisee,
        `${promiser.name} and ${promisee.name} never followed through on their plan to "${promise.text}."`,
        false);
      return;
    }

    this.applyOutcome(promise, promiser, promisee, outcome.text, outcome.kept);
  }

  private async generateOutcome(
    promise: NpcPromise,
    promiser: NPC,
    promisee: NPC,
  ): Promise<{ text: string; kept: boolean } | null> {
    const rel = promiser.relationships[promisee.id] ?? 0;

    // Check if a third party is involved (from conspire actions)
    const thirdPartyIds = this.extractThirdPartyIds(promise.text);
    const thirdPartyBlock = thirdPartyIds.length > 0
      ? `\nTHIRD PARTIES INVOLVED: ${thirdPartyIds.map(id => {
          const npc = this.store.get(id);
          return npc ? npc.name : id;
        }).join(", ")}`
      : "";

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a narrator for a village life simulation. Two characters had a plan. Describe what happened in 1-2 sentences. ALWAYS refer to characters by name.

${promiser.name}:
  Personality: ${promiser.personalityTraits.join(", ")}
  Current mood: ${moodSummary(promiser)}

${promisee.name}:
  Personality: ${promisee.personalityTraits.join(", ")}
  Current mood: ${moodSummary(promisee)}

Relationship: ${rel > 0.3 ? "friendly" : rel < -0.3 ? "tense" : "neutral"} (${rel.toFixed(2)})
${thirdPartyBlock}

THE PLAN: "${promise.text}" (proposed by ${promiser.name} to ${promisee.name})

Consider their personalities and relationship. Plans don't always go well — awkward, funny, or dramatic outcomes are encouraged. Sometimes people flake.

Respond with ONLY a JSON object:
{
  "outcome": "1-2 sentences using character names, describing what happened",
  "kept": true,
  "mood": "positive" or "negative" or "neutral"
}
Set "kept" to false if the plan fell through or was abandoned.
Set "mood" to describe the emotional tone of the outcome.
Output ONLY the JSON. No markdown, no code fences.
You MUST write ALL text in ${this.language}. Never use any other language.`,
      },
    ];

    try {
      const raw = await accumulateChat(messages);
      const jsonStr = extractJson(raw);
      if (!jsonStr) return null;
      const parsed = JSON.parse(jsonStr);
      return {
        text: typeof parsed.outcome === "string"
          ? parsed.outcome
          : `${promiser.name} and ${promisee.name} carried out their plan to "${promise.text}."`,
        kept: parsed.kept !== false,
      };
    } catch {
      return null;
    }
  }

  /** Look for NPC IDs mentioned in plan text (from conspire/rumor actions). */
  private extractThirdPartyIds(planText: string): string[] {
    const allNpcs = this.store.getAll();
    const mentioned: string[] = [];
    for (const npc of allNpcs) {
      if (planText.toLowerCase().includes(npc.name.toLowerCase())) {
        mentioned.push(npc.id);
      }
    }
    return mentioned;
  }

  private applyOutcome(
    promise: NpcPromise,
    promiser: NPC,
    promisee: NPC,
    outcomeText: string,
    kept: boolean,
  ): void {
    promise.status = kept ? "kept" : "broken";

    const memoryType = kept ? "activity" as const : "promise_broken" as const;
    const importance = kept ? 0.6 : 0.8;

    // Find any third parties to include in memory
    const thirdPartyIds = this.extractThirdPartyIds(promise.text);

    // Both characters get the memory
    for (const npcId of [promiser.id, promisee.id]) {
      const otherId = npcId === promiser.id ? promisee.id : promiser.id;
      this.store.addMemory(
        npcId,
        {
          text: outcomeText,
          importance,
          recency: 1,
          emotionalWeight: kept ? 0.3 : 0.6,
          involvedNpcIds: [otherId],
          aboutNpcIds: thirdPartyIds.length > 0 ? thirdPartyIds : undefined,
          type: memoryType,
          timestamp: Date.now(),
        },
        "shortTermMemory",
      );
    }

    // Relationship effects
    if (kept) {
      // Shared experiences strengthen bonds
      this.store.applyRelationshipDelta(promiser.id, promisee.id, 0.03);
      this.store.applyRelationshipDelta(promisee.id, promiser.id, 0.03);
    } else {
      // Broken plans erode trust
      this.store.applyRelationshipDelta(promiser.id, promisee.id, -0.05);
      this.store.applyRelationshipDelta(promisee.id, promiser.id, -0.05);
    }

    // Emotional effects
    const emotionDelta: EmotionalState = kept
      ? { anger: -0.03, trust: 0.04, fear: -0.02, joy: 0.05 }
      : { anger: 0.06, trust: -0.05, fear: 0.02, joy: -0.04 };

    this.store.applyEmotionDelta(promiser.id, emotionDelta);
    this.store.applyEmotionDelta(promisee.id, emotionDelta);

    this.onPlanResolved?.(promise, outcomeText, promiser.name, promisee.name);
  }

  private getStateCopy(): DayCycleState {
    return { ...this.state };
  }
}

function moodSummary(npc: NPC): string {
  const { anger, trust, fear, joy } = npc.emotionalState;
  const parts: string[] = [];
  if (joy > 0.6) parts.push("happy");
  else if (joy < 0.3) parts.push("unhappy");
  if (anger > 0.4) parts.push("angry");
  if (fear > 0.4) parts.push("anxious");
  if (trust > 0.6) parts.push("trusting");
  else if (trust < 0.3) parts.push("distrustful");
  return parts.length > 0 ? parts.join(", ") : "calm";
}
