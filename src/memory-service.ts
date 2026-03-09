import type { MemoryEntry } from "./types";
import type { NpcStore } from "./npc-store";

// ── Retrieval types ─────────────────────────────

export interface RetrievalContext {
  partnerId?: string;       // who we're talking to (filter by involvedNpcIds)
  excludeAbout?: string;    // exclude gossip about this NPC
  maxDirect?: number;       // max memories involving partner (default 8)
  maxGossip?: number;       // max gossip memories (default 3)
  maxAboutPartner?: number; // max gossip specifically about partner (default 2)
}

export interface RetrievedMemories {
  direct: MemoryEntry[];        // memories involving the partner
  gossip: MemoryEntry[];        // gossip about third parties (deduped by subject)
  aboutPartner: MemoryEntry[];  // gossip heard about the partner specifically
}

// ── Memory Service ──────────────────────────────

const SHORT_TERM_CAPACITY = 40;
const LONG_TERM_CAPACITY = 100;
const PROMOTION_THRESHOLD = 0.7;

export class MemoryService {
  private store: NpcStore;
  private _memoryVersion = 0;
  private _sortedCache = new Map<string, { version: number; sorted: MemoryEntry[] }>();

  constructor(store: NpcStore) {
    this.store = store;
  }

  // ── Storage ───────────────────────────────────

  add(
    npcId: string,
    entry: MemoryEntry,
    slot: "shortTermMemory" | "longTermMemory" = "shortTermMemory"
  ): void {
    const npc = this.store.get(npcId);
    if (!npc) { console.warn(`[memory] add: NPC "${npcId}" not found`); return; }
    npc[slot].push(entry);
    if (slot === "shortTermMemory" && npc.shortTermMemory.length > SHORT_TERM_CAPACITY) {
      // Evict the least valuable memory (lowest recency * importance)
      let minIdx = 0;
      let minScore = Infinity;
      for (let i = 0; i < npc.shortTermMemory.length; i++) {
        const m = npc.shortTermMemory[i];
        const score = m.recency * m.importance;
        if (score < minScore) {
          minScore = score;
          minIdx = i;
        }
      }
      const [evicted] = npc.shortTermMemory.splice(minIdx, 1);
      // Promote important memories to long-term instead of discarding
      if (evicted.importance >= PROMOTION_THRESHOLD) {
        npc.longTermMemory.push(evicted);
        // Cap long-term memory too — evict lowest scoring when over limit
        if (npc.longTermMemory.length > LONG_TERM_CAPACITY) {
          let ltMinIdx = 0;
          let ltMinScore = Infinity;
          for (let i = 0; i < npc.longTermMemory.length; i++) {
            const m = npc.longTermMemory[i];
            const score = m.recency * m.importance;
            if (score < ltMinScore) {
              ltMinScore = score;
              ltMinIdx = i;
            }
          }
          npc.longTermMemory.splice(ltMinIdx, 1);
        }
      }
    }
    this._memoryVersion++;
    this.store.notifyChange();
  }

  // ── Sorted access (cached) ────────────────────

  getSorted(npcId: string): MemoryEntry[] {
    const cached = this._sortedCache.get(npcId);
    if (cached && cached.version === this._memoryVersion) {
      return cached.sorted;
    }
    const npc = this.store.get(npcId);
    if (!npc) return [];
    const sorted = [...npc.shortTermMemory]
      .sort((a, b) => b.recency * b.importance - a.recency * a.importance);
    this._sortedCache.set(npcId, { version: this._memoryVersion, sorted });
    return sorted;
  }

  // ── Retrieval for prompts ─────────────────────

  retrieve(npcId: string, ctx: RetrievalContext = {}): RetrievedMemories {
    const sorted = this.getSorted(npcId);
    const maxDirect = ctx.maxDirect ?? 8;
    const maxGossip = ctx.maxGossip ?? 3;
    const maxAboutPartner = ctx.maxAboutPartner ?? 2;

    // Memories involving the conversation partner
    const direct = ctx.partnerId
      ? sorted
          .filter((m) => m.involvedNpcIds.includes(ctx.partnerId!))
          .slice(0, maxDirect)
      : [];

    // Gossip about third parties (deduped by subject)
    const seenSubjects = new Set<string>();
    const gossip = sorted
      .filter((m) => {
        if (m.type !== "gossip") return false;
        if (ctx.excludeAbout && m.aboutNpcIds?.includes(ctx.excludeAbout)) return false;
        const subjectKey = m.aboutNpcIds?.join(",") ?? m.text;
        if (seenSubjects.has(subjectKey)) return false;
        seenSubjects.add(subjectKey);
        return true;
      })
      .slice(0, maxGossip);

    // Gossip specifically about the partner
    const aboutPartner = ctx.partnerId
      ? sorted
          .filter((m) => m.aboutNpcIds?.includes(ctx.partnerId!) && m.type === "gossip")
          .slice(0, maxAboutPartner)
      : [];

    return { direct, gossip, aboutPartner };
  }

  // ── Decay ─────────────────────────────────────

  decayAllRecency(rate = 0.85): void {
    for (const npc of this.store.getAll()) {
      for (const mem of npc.shortTermMemory) {
        mem.recency *= rate;
      }
      for (const mem of npc.longTermMemory) {
        mem.recency *= rate;
      }
    }
    this._memoryVersion++;
  }

  // ── Queries ───────────────────────────────────

  hasGossip(npcId: string): boolean {
    const npc = this.store.get(npcId);
    if (!npc) return false;
    return npc.shortTermMemory.some((m) => m.type === "gossip");
  }

  getMemoryCount(npcId: string): number {
    const npc = this.store.get(npcId);
    return npc?.shortTermMemory.length ?? 0;
  }
}
