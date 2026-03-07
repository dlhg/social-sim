import { useCallback, useEffect, useRef, useState } from "react";
import { WorldCanvas } from "./components/WorldCanvas";
import { FeedPanel } from "./components/SidePanel";
import { CharacterViewer } from "./components/CharacterViewer";
import { NpcInspector } from "./components/NpcInspector";
import { NpcCreator } from "./components/NpcCreator";
import { SetupScreen } from "./components/SetupScreen";
import { DmTools } from "./components/DmTools";
import { NpcStore } from "./npc-store";
import { MemoryService } from "./memory-service";
import { ConversationManager } from "./conversation-manager";
import { WorldSimulation } from "./world-simulation";
import { DayCycle } from "./day-cycle";
import type { NPC, BubbleData, FloaterData, ActionType, WaypointActivityId, DayPhase } from "./types";
import { ACTIVITIES } from "./activities";
import { pickInteraction, executeInteraction } from "./interactions";
import { TTSService } from "./tts-service";
import type { NpcSnapshot, FeedItem } from "./components/SidePanel";
import "./App.css";

/** Extract the "speech" value from a partial JSON stream, stripping JSON syntax. */
function extractSpeechFromStream(raw: string): { text: string; complete: boolean } {
  // Match "speech": "..." or "speech":"..."
  const match = raw.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)("?)/s);
  if (!match) return { text: "", complete: false };
  let text = match[1];
  // Unescape JSON string escapes
  text = text.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return { text: text.trimEnd(), complete: match[2] === '"' };
}

const ACTION_LABELS: Record<ActionType, string> = {
  give_gift: "gives a gift",
  mock: "mocks",
  storm_off: "storms off!",
  embrace: "embraces",
  threaten: "threatens",
  conspire: "whispers conspiratorially",
  spread_rumor: "spreads a rumor",
};

function App() {
  const storeRef = useRef(new NpcStore([]));
  const memoryRef = useRef(new MemoryService(storeRef.current));
  const [npcs, setNpcs] = useState<NPC[]>([]);
  const [roster, setRoster] = useState<NPC[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [streamingText, setStreamingText] = useState<Record<string, string>>(
    {}
  );
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [activeConversationPair, setActiveConversationPair] = useState<
    [string, string] | null
  >(null);
  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");
  const [language, setLanguage] = useState("English");
  const languageRef = useRef(language);
  languageRef.current = language;
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [dmToolsOpen, setDmToolsOpen] = useState(false);
  const [npcViewerOpen, setNpcViewerOpen] = useState(false);

  // Panel state
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [npcHistory, setNpcHistory] = useState<Record<string, NpcSnapshot[]>>(
    {}
  );
  const [bubbles, setBubbles] = useState<BubbleData[]>([]);
  const [floaters, setFloaters] = useState<FloaterData[]>([]);
  const bubbleTimersRef = useRef<Map<string, number>>(new Map());

  const managerRef = useRef<ConversationManager | null>(null);
  const worldRef = useRef<WorldSimulation | null>(null);
  const dayCycleRef = useRef<DayCycle | null>(null);
  const [dayLabel, setDayLabel] = useState("");
  const [dayPhase, setDayPhase] = useState<DayPhase>("morning");
  const ttsRef = useRef(new TTSService({ volume: 0.7, speed: 1.1, enabled: true }));
  const ttsStreamedRef = useRef(new Set<string>());
  const ttsSentIndexRef = useRef(new Map<string, number>());
  const [ttsEnabled, setTtsEnabled] = useState(true);

  useEffect(() => {
    setNpcs(storeRef.current.getAll());
    return storeRef.current.subscribe(() => {
      setNpcs(storeRef.current.getAll());
    });
  }, [status]);

  // Sync bubble state → slow movement for NPCs with active bubbles
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const npcIdsWithBubbles = new Set(bubbles.map(b => b.npcId));
    for (const npc of npcs) {
      world.setSlowNpc(npc.id, npcIdsWithBubbles.has(npc.id));
    }
  }, [bubbles, npcs]);

  const handleAddToRoster = useCallback((npc: NPC) => {
    setRoster((prev) => {
      if (prev.some((n) => n.id === npc.id)) return prev;
      if (prev.length >= 13) return prev;
      return [...prev, npc];
    });
  }, []);

  const handleRemoveFromRoster = useCallback((npcId: string) => {
    setRoster((prev) => prev.filter((n) => n.id !== npcId));
  }, []);

  const handleStartSimulation = useCallback(() => {
    storeRef.current = new NpcStore(roster);
    memoryRef.current = new MemoryService(storeRef.current);
    handleStart();
  }, [roster]);

  // ── Interaction system ───────────────────────
  const interactionCooldowns = useRef<Map<string, number>>(new Map());
  const INTERACTION_COOLDOWN_MS = 20_000;
  const INTERACTION_CHANCE = 0.35; // 35% chance per proximity tick when conv doesn't fire

  const tryInteraction = useCallback((aId: string, bId: string) => {
    const now = Date.now();
    const pairKey = [aId, bId].sort().join(":");
    const last = interactionCooldowns.current.get(pairKey) ?? 0;
    if (now - last < INTERACTION_COOLDOWN_MS) return;
    if (Math.random() > INTERACTION_CHANCE) return;

    const actorNpc = storeRef.current.get(aId);
    const targetNpc = storeRef.current.get(bId);
    if (!actorNpc || !targetNpc) return;

    // Randomly pick who initiates
    const [actor, target] = Math.random() < 0.5
      ? [actorNpc, targetNpc]
      : [targetNpc, actorNpc];

    const result = pickInteraction(actor, target);
    if (!result) return;

    interactionCooldowns.current.set(pairKey, now);

    // Execute effects
    executeInteraction(result, storeRef.current, memoryRef.current);
    worldRef.current?.recordSocialContact(result.actorId);
    worldRef.current?.recordSocialContact(result.targetId);

    // Show bubble on actor
    const bubbleKey = `${result.actorId}-interaction`;
    setBubbles(prev => [
      ...prev.filter(b => b.npcId !== result.actorId || b.type !== "action"),
      {
        npcId: result.actorId,
        text: result.actorBubbleText,
        type: "action",
        startedAt: now,
      },
    ]);

    // Auto-clear bubble after 3.5s
    const timer = window.setTimeout(() => {
      setBubbles(prev => prev.filter(b =>
        !(b.npcId === result.actorId && b.type === "action" && b.startedAt === now)
      ));
      bubbleTimersRef.current.delete(bubbleKey);
    }, 3500);
    bubbleTimersRef.current.set(bubbleKey, timer);

    // Feed entry
    setFeed(prev => [...prev, {
      type: "activity",
      event: {
        timestamp: new Date(),
        text: result.feedText,
        activityType: "action",
        npcId: result.actorId,
      },
    }]);
  }, []);

  const handleStart = useCallback(() => {
    setFeed([]);
    setStreamingText({});
    setCurrentSpeaker(null);
    setActiveConversationPair(null);
    setNpcHistory({});
    setBubbles([]);
    setFloaters([]);
    for (const t of bubbleTimersRef.current.values()) clearTimeout(t);
    bubbleTimersRef.current.clear();

    // Create world simulation
    const world = new WorldSimulation({
      gridWidth: 72,
      gridHeight: 48,
      tickIntervalMs: 285,
      onProximity: (aId, bId) => {
        const started = managerRef.current?.triggerConversation(aId, bId);
        if (!started) {
          tryInteraction(aId, bId);
        }
      },
      onActivityStart: (npcId, activityId, waypointName) => {
        const act = ACTIVITIES[activityId as WaypointActivityId];
        const bubbleText = `${act.emoji} ${act.label}`;
        setBubbles(prev => [
          ...prev.filter(b => !(b.npcId === npcId && b.type === "action")),
          { npcId, text: bubbleText, type: "action", startedAt: Date.now() },
        ]);
        const name = storeRef.current.get(npcId)?.name ?? npcId;
        setFeed(prev => [...prev, {
          type: "activity",
          event: {
            timestamp: new Date(),
            text: `${name} started ${act.label} at ${waypointName}`,
            activityType: "action",
            npcId,
          },
        }]);
      },
      onActivityEnd: (npcId, _activityId, waypointName, _memoryText) => {
        setBubbles(prev => prev.filter(b => !(b.npcId === npcId && b.type === "action")));
        const name = storeRef.current.get(npcId)?.name ?? npcId;
        const act = ACTIVITIES[_activityId as WaypointActivityId];
        setFeed(prev => [...prev, {
          type: "activity",
          event: {
            timestamp: new Date(),
            text: `${name} finished ${act.label} at ${waypointName}`,
            activityType: "action",
            npcId,
          },
        }]);
      },
      onItemAcquired: (npcId, itemLabel, itemEmoji) => {
        const name = storeRef.current.get(npcId)?.name ?? npcId;
        setFeed(prev => [...prev, {
          type: "activity",
          event: {
            timestamp: new Date(),
            text: `${name} acquired ${itemEmoji} ${itemLabel}`,
            activityType: "action",
            npcId,
          },
        }]);
      },
      onObserveActivity: (observerId, actorId, activityId) => {
        const observer = storeRef.current.get(observerId);
        const actor = storeRef.current.get(actorId);
        if (!observer || !actor) return;
        const act = ACTIVITIES[activityId as WaypointActivityId];
        if (!act) return;

        const rel = observer.relationships[actorId]?.regard ?? 0;
        const traits = observer.personalityTraits.map(t => t.toLowerCase());
        const emo = observer.emotionalState;

        // Build a personality-driven opinion
        let opinion: string;
        let emotionDelta: Partial<import("./types").EmotionalState> = {};
        let seekTarget: string | null = null;

        // Activity-specific reactions
        if (activityId === "training" && traits.some(t => ["competitive", "aggressive"].includes(t))) {
          opinion = `${actor.name} is training. I should keep my skills sharp too.`;
          emotionDelta = { anger: -0.02, joy: 0.02 };
        } else if (activityId === "cooking" && emo.joy < 0.3) {
          opinion = `${actor.name} is cooking. The smell is comforting.`;
          emotionDelta = { joy: 0.03 };
          if (rel > 0.1) seekTarget = actorId;
        } else if (activityId === "meditating" && traits.some(t => ["philosophical", "anxious"].includes(t))) {
          opinion = `${actor.name} is meditating. Maybe I should try that.`;
          emotionDelta = { fear: -0.02 };
        } else if (activityId === "writing" && traits.includes("curious")) {
          opinion = `${actor.name} is writing something. I wonder what about.`;
        } else if (activityId === "people_watching" && traits.includes("suspicious")) {
          opinion = `${actor.name} is watching people. What are they looking for?`;
          emotionDelta = { trust: -0.02 };
        } else if (rel > 0.3) {
          const positive = [
            `${actor.name} is ${act.label}. Good for them.`,
            `Nice to see ${actor.name} ${act.label}.`,
            `${actor.name} seems content ${act.label}.`,
          ];
          opinion = positive[Math.floor(Math.random() * positive.length)];
          emotionDelta = { joy: 0.01 };
        } else if (rel < -0.2) {
          const negative = [
            `${actor.name} is ${act.label}. Typical.`,
            `Of course ${actor.name} is ${act.label}. How predictable.`,
            `I saw ${actor.name} ${act.label}. I don't care.`,
          ];
          opinion = negative[Math.floor(Math.random() * negative.length)];
          emotionDelta = { anger: 0.01 };
        } else if (traits.includes("perceptive")) {
          opinion = `I noticed ${actor.name} ${act.label}. Interesting.`;
        } else {
          opinion = `I saw ${actor.name} ${act.label} nearby.`;
        }

        // Apply emotion effects
        if (Object.keys(emotionDelta).length > 0) {
          const full: import("./types").EmotionalState = {
            anger: emotionDelta.anger ?? 0,
            trust: emotionDelta.trust ?? 0,
            fear: emotionDelta.fear ?? 0,
            joy: emotionDelta.joy ?? 0,
            sadness: emotionDelta.sadness ?? 0,
            curiosity: emotionDelta.curiosity ?? 0,
            disgust: emotionDelta.disgust ?? 0,
            guilt: emotionDelta.guilt ?? 0,
          };
          storeRef.current.applyEmotionDelta(observerId, full);
        }

        // Behavioral reaction: seek the actor (e.g., drawn by cooking smell)
        if (seekTarget && !observer.behavioralOverride) {
          storeRef.current.setBehavioralOverride(observerId, {
            mode: "seek",
            targetNpcId: seekTarget,
            expiresAt: Date.now() + 30_000,
            reason: opinion,
          });
        }

        memoryRef.current.add(observerId, {
          text: opinion,
          importance: 0.25,
          recency: 1,
          emotionalWeight: 0.2,
          involvedNpcIds: [actorId],
          timestamp: Date.now(),
          type: "observation",
        }, "shortTermMemory");

        setFeed(prev => [...prev, {
          type: "activity",
          event: {
            timestamp: new Date(),
            text: `${observer.name}: "${opinion}"`,
            activityType: "thought",
            npcId: observerId,
          },
        }]);
      },
      onTick: () => {
        dayCycleRef.current?.tick();
      },
      getPhase: () => dayCycleRef.current?.getPhase() ?? "morning",
      npcStore: storeRef.current,
      memoryService: memoryRef.current,
    });

    // Register NPCs at different starting positions (spread across waypoints)
    const allNpcs = storeRef.current.getAll();
    const startPositions = [
      { x: 12, y: 8 },  // Fountain
      { x: 4, y: 12 },  // Park Bench
      { x: 22, y: 9 },  // Training Yard
      { x: 7, y: 3 },   // Garden
      { x: 18, y: 13 }, // Market
      { x: 1, y: 2 },   // Chapel
      { x: 14, y: 5 },  // Pond
      { x: 10, y: 1 },  // Library Ruins
      { x: 8, y: 14 },  // Tavern Porch
      { x: 21, y: 1 },  // Hilltop
      { x: 20, y: 4 },  // Old Tree
      { x: 3, y: 7 },   // Well
      { x: 15, y: 10 }, // Bridge
    ];
    allNpcs.forEach((npc, i) => {
      world.addNpc(npc.id, startPositions[i % startPositions.length]);
    });

    worldRef.current = world;

    // Create conversation manager
    const manager = new ConversationManager(storeRef.current, memoryRef.current, {
      onStreamToken: (npcId, fullText) => {
        setStreamingText((prev) => ({ ...prev, [npcId]: fullText }));
        const { text: speechText, complete } = extractSpeechFromStream(fullText);
        if (speechText) {
          setBubbles((prev) => {
            const idx = prev.findIndex(b => b.npcId === npcId && b.type === "speech");
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], text: speechText };
              return updated;
            }
            return [...prev, { npcId, text: speechText, type: "speech", startedAt: Date.now() }];
          });
          // Stream TTS sentence-by-sentence as they complete
          const ttsEmotions = storeRef.current.get(npcId)?.emotionalState;
          const cursor = ttsSentIndexRef.current.get(npcId) ?? 0;
          const boundaryRegex = /[.!?]\s+/g;
          boundaryRegex.lastIndex = cursor;
          let newCursor = cursor;
          let match: RegExpExecArray | null;
          while ((match = boundaryRegex.exec(speechText)) !== null) {
            const sentEnd = match.index + 1; // include punctuation
            const sentence = speechText.slice(newCursor, sentEnd).trim();
            if (sentence) {
              ttsStreamedRef.current.add(npcId);
              ttsRef.current.speak(npcId, sentence, ttsEmotions, languageRef.current);
            }
            newCursor = match.index + match[0].length;
          }
          ttsSentIndexRef.current.set(npcId, newCursor);
          // When speech field closes, dispatch any remaining text
          if (complete) {
            const remaining = speechText.slice(newCursor).trim();
            if (remaining) {
              ttsStreamedRef.current.add(npcId);
              ttsRef.current.speak(npcId, remaining, ttsEmotions, languageRef.current);
            }
            // Set cursor to end so subsequent calls (as remaining JSON streams)
            // don't re-dispatch. Cleaned up in onTurnComplete.
            ttsSentIndexRef.current.set(npcId, speechText.length);
          }
        }
      },
      onTurnComplete: (msg) => {
        setFeed((prev) => [...prev, { type: "chat", msg, timestamp: Date.now() }]);
        setStreamingText((prev) => ({ ...prev, [msg.npcId]: "" }));

        // Fire TTS only if not already streamed sentence-by-sentence
        if (!ttsStreamedRef.current.delete(msg.npcId)) {
          const emo = storeRef.current.get(msg.npcId)?.emotionalState;
          ttsRef.current.speak(msg.npcId, msg.text, emo, languageRef.current);
        }
        ttsSentIndexRef.current.delete(msg.npcId);

        // Mark speech bubble as completed, schedule removal
        setBubbles(prev => prev.map(b =>
          b.npcId === msg.npcId && b.type === "speech"
            ? { ...b, text: msg.text, completedAt: Date.now() }
            : b
        ));
        const timerKey = msg.npcId + ":speech";
        const prev = bubbleTimersRef.current.get(timerKey);
        if (prev) clearTimeout(prev);
        bubbleTimersRef.current.set(timerKey, window.setTimeout(() => {
          setBubbles(p => p.filter(b => !(b.npcId === msg.npcId && b.type === "speech")));
          bubbleTimersRef.current.delete(timerKey);
        }, 3000));

        // Show action bubble if this turn had an action
        if (msg.rawResponse?.action) {
          const actionText = `* ${ACTION_LABELS[msg.rawResponse.action.action]} *`;
          const npcId = msg.npcId;
          setBubbles(prev => [
            ...prev.filter(b => !(b.npcId === npcId && b.type === "action")),
            { npcId, text: actionText, type: "action", startedAt: Date.now(), completedAt: Date.now() },
          ]);
          const actionTimerKey = npcId + ":action";
          const prevActionTimer = bubbleTimersRef.current.get(actionTimerKey);
          if (prevActionTimer) clearTimeout(prevActionTimer);
          bubbleTimersRef.current.set(actionTimerKey, window.setTimeout(() => {
            setBubbles(p => p.filter(b => !(b.npcId === npcId && b.type === "action")));
            bubbleTimersRef.current.delete(actionTimerKey);
          }, 3500));
        }

        // Snapshot the speaker's emotional state and relationships
        const speaker = storeRef.current.get(msg.npcId);
        if (speaker) {
          const snapshot: NpcSnapshot = {
            timestamp: Date.now(),
            emotions: { ...speaker.emotionalState },
            relationships: { ...speaker.relationships },
          };
          setNpcHistory((prev) => ({
            ...prev,
            [msg.npcId]: [...(prev[msg.npcId] ?? []), snapshot],
          }));
        }
      },
      onConversationStart: (session) => {
        const [a, b] = session.participantIds;
        worldRef.current?.freezeNpc(a);
        worldRef.current?.freezeNpc(b);
        // Clear any activity bubbles for participants
        setBubbles(prev => prev.filter(bl =>
          !((bl.npcId === a || bl.npcId === b) && bl.type === "action")
        ));
        setActiveConversationPair(session.participantIds);
      },
      onConversationEnd: (session) => {
        const [a, b] = session.participantIds;
        worldRef.current?.unfreezeNpc(a);
        worldRef.current?.unfreezeNpc(b);
        worldRef.current?.recordSocialContact(a);
        worldRef.current?.recordSocialContact(b);
        setActiveConversationPair(null);
      },
      onActivity: (event) => {
        setFeed((prev) => [...prev, { type: "activity", event }]);
        if (event.activityType === "thought" && event.npcId) {
          const npcId = event.npcId;
          // Extract thought text from format: 'Name thinks: "thought"'
          const match = event.text.match(/thinks:\s*"(.+)"/);
          const text = match?.[1] ?? event.text;
          // Don't show thought if NPC has active speech bubble
          setBubbles(prev => {
            const hasSpeech = prev.some(b => b.npcId === npcId && b.type === "speech");
            if (hasSpeech) return prev;
            return [
              ...prev.filter(b => !(b.npcId === npcId && b.type === "thought")),
              { npcId, text, type: "thought", startedAt: Date.now(), completedAt: Date.now() },
            ];
          });
          const timerKey = npcId + ":thought";
          const prev = bubbleTimersRef.current.get(timerKey);
          if (prev) clearTimeout(prev);
          bubbleTimersRef.current.set(timerKey, window.setTimeout(() => {
            setBubbles(p => p.filter(b => !(b.npcId === npcId && b.type === "thought")));
            bubbleTimersRef.current.delete(timerKey);
          }, 4000));
        }
      },
      onSpeakerChange: (npcId) => {
        setCurrentSpeaker(npcId);
        if (npcId) {
          setStreamingText((prev) => ({ ...prev, [npcId]: "" }));
        }
      },
      onFloater: (floater) => {
        setFloaters(prev => [...prev, floater]);
        setTimeout(() => {
          setFloaters(prev => prev.filter(f => f.id !== floater.id));
        }, 4700 + floater.delay);
      },
      onEavesdropReaction: (eavesdropperId, text) => {
        const now = Date.now();
        setBubbles(prev => [
          ...prev.filter(b => !(b.npcId === eavesdropperId && b.type === "thought")),
          { npcId: eavesdropperId, text, type: "thought", startedAt: now },
        ]);
        const key = `${eavesdropperId}-eavesdrop`;
        const existing = bubbleTimersRef.current.get(key);
        if (existing) clearTimeout(existing);
        const timer = window.setTimeout(() => {
          setBubbles(prev => prev.filter(b =>
            !(b.npcId === eavesdropperId && b.type === "thought" && b.startedAt === now)
          ));
          bubbleTimersRef.current.delete(key);
        }, 4000);
        bubbleTimersRef.current.set(key, timer);
      },
    });

    // Create day cycle
    const dayCycle = new DayCycle({
      npcStore: storeRef.current,
      memoryService: memoryRef.current,
      language: languageRef.current,
      onPhaseChange: (state) => {
        setDayLabel(dayCycle.getLabel());
        setDayPhase(state.phase);
        setFeed(prev => [...prev, {
          type: "activity",
          event: {
            timestamp: new Date(),
            text: `-- ${state.phase.charAt(0).toUpperCase() + state.phase.slice(1)} of Day ${state.day} --`,
          },
        }]);
      },
      onPlanResolved: (promise, outcome, promiserName, promiseeName) => {
        const kept = promise.status === "kept";
        setFeed(prev => [...prev, {
          type: "activity",
          event: {
            timestamp: new Date(),
            text: `${kept ? "[Plan resolved]" : "[Plan fell through]"} ${promiserName} & ${promiseeName}: ${outcome}`,
          },
        }]);
      },
    });
    dayCycleRef.current = dayCycle;
    setDayLabel(dayCycle.getLabel());

    managerRef.current = manager;
    manager.setWorldSimulation(world);
    manager.setDayCycle(dayCycle);
    manager.setLanguage(languageRef.current);

    // Pre-assign TTS voices to all NPCs
    for (const npc of allNpcs) {
      ttsRef.current.assignVoice(npc.id);
    }

    setStatus("running");
    manager.start();
    world.start();
  }, []);

  const handlePause = useCallback(() => {
    const mgr = managerRef.current;
    const world = worldRef.current;
    if (!mgr) return;
    if (status === "paused") {
      mgr.resume();
      world?.resume();
      setStatus("running");
    } else {
      mgr.pause();
      world?.pause();
      setStatus("paused");
    }
  }, [status]);

  const handleStop = useCallback(() => {
    ttsRef.current.stop();
    setRoster(storeRef.current.getAll());
    managerRef.current?.stop();
    managerRef.current = null;
    worldRef.current?.stop();
    worldRef.current = null;
    dayCycleRef.current = null;
    setDayLabel("");
    setStatus("idle");
    setCurrentSpeaker(null);
    setActiveConversationPair(null);
    setBubbles([]);
    setFloaters([]);
    for (const t of bubbleTimersRef.current.values()) clearTimeout(t);
    bubbleTimersRef.current.clear();
  }, []);

  const handleTrigger = useCallback(() => {
    const allNpcs = storeRef.current.getAll();
    if (allNpcs.length >= 2) {
      managerRef.current?.triggerConversation(allNpcs[0].id, allNpcs[1].id);
    }
  }, []);

  const handleSpawnNpc = useCallback((npc: NPC) => {
    storeRef.current.addNpc(npc);
    if (worldRef.current) {
      worldRef.current.addNpc(npc.id);
    }
  }, []);

  const handleWhisper = useCallback((npcId: string, message: string) => {
    memoryRef.current.add(
      npcId,
      {
        text: `A mysterious voice whispered to me: "${message}"`,
        importance: 0.8,
        recency: 1,
        emotionalWeight: 0.6,
        involvedNpcIds: [],
        type: "observation",
        timestamp: Date.now(),
      },
      "shortTermMemory"
    );
    const name = storeRef.current.get(npcId)?.name ?? npcId;
    setFeed((prev) => [
      ...prev,
      {
        type: "activity",
        event: {
          timestamp: new Date(),
          text: `[DM] Whispered to ${name}: "${message}"`,
          activityType: "dm",
        },
      },
    ]);
  }, []);

  const handleWorldEvent = useCallback((text: string) => {
    for (const npc of storeRef.current.getAll()) {
      memoryRef.current.add(
        npc.id,
        {
          text: `Something happened: ${text}`,
          importance: 0.7,
          recency: 1,
          emotionalWeight: 0.5,
          involvedNpcIds: [],
          type: "observation",
          timestamp: Date.now(),
        },
        "shortTermMemory"
      );
    }
    setFeed((prev) => [
      ...prev,
      {
        type: "activity",
        event: {
          timestamp: new Date(),
          text: `[DM] World Event: ${text}`,
          activityType: "dm",
        },
      },
    ]);
  }, []);

  const handleForceEncounter = useCallback((aId: string, bId: string) => {
    managerRef.current?.forceConversation(aId, bId);
  }, []);


  const handlePlantRumor = useCallback(
    (npcId: string, aboutNpcId: string, rumor: string) => {
      const aboutName = storeRef.current.get(aboutNpcId)?.name ?? aboutNpcId;
      const recipientName = storeRef.current.get(npcId)?.name ?? npcId;
      memoryRef.current.add(
        npcId,
        {
          text: `I heard a rumor about ${aboutName}: ${rumor}`,
          importance: 0.6,
          recency: 1,
          emotionalWeight: 0.4,
          involvedNpcIds: [],
          aboutNpcIds: [aboutNpcId],
          type: "gossip",
          sentiment: 0,
          timestamp: Date.now(),
        },
        "shortTermMemory"
      );
      setFeed((prev) => [
        ...prev,
        {
          type: "activity",
          event: {
            timestamp: new Date(),
            text: `[DM] Planted rumor about ${aboutName} with ${recipientName}`,
            activityType: "dm",
          },
        },
      ]);
    },
    []
  );

  if (status === "idle") {
    return (
      <div className="app">
        <SetupScreen
          roster={roster}
          language={language}
          onAddToRoster={handleAddToRoster}
          onRemoveFromRoster={handleRemoveFromRoster}
          onLanguageChange={setLanguage}
          onStartSimulation={handleStartSimulation}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="main-content">
        <FeedPanel
          npcs={npcs}
          feed={feed}
          currentSpeaker={currentSpeaker}
        />
        <div className="world-panel">
          {dayLabel && <div className="day-label">{dayLabel}</div>}
          <WorldCanvas
            getSnapshot={() =>
              worldRef.current?.getSnapshot() ?? {
                npcs: [],
                waypoints: [],
                tickIntervalMs: 285,
              }
            }
            getNpc={(id) => storeRef.current.get(id)}
            currentSpeaker={currentSpeaker}
            activeConversationPair={activeConversationPair}
            bubbles={bubbles}
            floaters={floaters}
            dayPhase={dayPhase}
            onNpcClick={setSelectedNpcId}
          />
        </div>
        <NpcInspector
          npcs={npcs}
          selectedNpcId={selectedNpcId}
          npcHistory={npcHistory}
          dayLabel={dayLabel}
          onSelectNpc={setSelectedNpcId}
        />
      </div>
      <div className="controls">
        <button onClick={handlePause} className="btn btn-pause">
          {status === "paused" ? "Resume" : "Pause"}
        </button>
        <button onClick={handleStop} className="btn btn-stop">
          Stop
        </button>
        <button onClick={handleTrigger} className="btn btn-trigger">
          Trigger Conversation
        </button>
        <button
          onClick={() => setDmToolsOpen(true)}
          className="btn btn-dm"
        >
          DM Tools
        </button>
        <button
          onClick={() => setNpcViewerOpen(true)}
          className="btn btn-npcs"
        >
          NPCs
        </button>
        <button
          onClick={() => setCreatorOpen(true)}
          className="btn btn-create"
        >
          + NPC
        </button>
        <button
          onClick={() => {
            const next = !ttsEnabled;
            setTtsEnabled(next);
            ttsRef.current.setOptions({ enabled: next });
            if (next) {
              // Warm up AudioContext during user gesture
              ttsRef.current.warmUp();
              // Check server availability on enable
              ttsRef.current.checkServer().then((ok) => {
                if (!ok) {
                  console.warn("[tts] Server not available at localhost:8787");
                  setTtsEnabled(false);
                  ttsRef.current.setOptions({ enabled: false });
                }
              });
            } else {
              ttsRef.current.stop();
            }
          }}
          className={`btn ${ttsEnabled ? "btn-tts-on" : "btn-tts-off"}`}
          title={ttsEnabled ? "Disable TTS" : "Enable TTS (requires tts-server)"}
        >
          {ttsEnabled ? "TTS On" : "TTS Off"}
        </button>
      </div>
      {creatorOpen && (
        <NpcCreator
          onClose={() => setCreatorOpen(false)}
          onCreateNpc={handleSpawnNpc}
          existingIds={npcs.map((n) => n.id)}
        />
      )}
      {dmToolsOpen && (
        <DmTools
          npcs={npcs}
          onWhisper={handleWhisper}
          onWorldEvent={handleWorldEvent}
          onForceEncounter={handleForceEncounter}
          onPlantRumor={handlePlantRumor}
          onClose={() => setDmToolsOpen(false)}
        />
      )}
      {npcViewerOpen && (
        <div className="modal-overlay" onClick={() => setNpcViewerOpen(false)}>
          <div
            className="modal-content npc-viewer-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <CharacterViewer
              npcs={npcs}
              selectedNpcId={selectedNpcId}
              onSelectNpc={setSelectedNpcId}
              npcHistory={npcHistory}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
