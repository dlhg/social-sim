import { useCallback, useEffect, useRef, useState } from "react";
import { WorldCanvas } from "./components/WorldCanvas";
import { FeedPanel } from "./components/SidePanel";
import { CharacterViewer } from "./components/CharacterViewer";
import { NpcCreator } from "./components/NpcCreator";
import { SetupScreen } from "./components/SetupScreen";
import { DmTools } from "./components/DmTools";
import { NpcStore } from "./npc-store";
import { ConversationManager } from "./conversation-manager";
import { WorldSimulation } from "./world-simulation";
import { DayCycle } from "./day-cycle";
import type { NPC, BubbleData, FloaterData, ActionType, WaypointActivityId } from "./types";
import { ACTIVITIES } from "./activities";
import { pickInteraction, executeInteraction } from "./interactions";
import type { NpcSnapshot, FeedItem, PanelMode } from "./components/SidePanel";
import "./App.css";

/** Extract the "speech" value from a partial JSON stream, stripping JSON syntax. */
function extractSpeechFromStream(raw: string): string {
  // Match "speech": "..." or "speech":"..."
  const match = raw.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)("?)/s);
  if (!match) return "";
  let text = match[1];
  // Unescape JSON string escapes
  text = text.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return text.trimEnd();
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
  const [panelMode, setPanelMode] = useState<PanelMode>("partial");
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
    executeInteraction(result, storeRef.current);

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
      gridWidth: 24,
      gridHeight: 16,
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

        // Generate an observation based on personality + relationship
        const rel = observer.relationships[actorId] ?? 0;
        const traits = observer.personalityTraits.map(t => t.toLowerCase());
        let opinion: string;
        if (rel > 0.3) {
          opinion = `I noticed ${actor.name} ${act.label}. Good for them.`;
        } else if (rel < -0.2) {
          opinion = `I saw ${actor.name} ${act.label}. Typical.`;
        } else if (traits.includes("curious") || traits.includes("perceptive")) {
          opinion = `I noticed ${actor.name} ${act.label}. Interesting.`;
        } else {
          opinion = `I saw ${actor.name} ${act.label} nearby.`;
        }

        // Create memory
        storeRef.current.addMemory(observerId, {
          text: opinion,
          importance: 0.2,
          recency: 1,
          emotionalWeight: 0.15,
          involvedNpcIds: [actorId],
          timestamp: Date.now(),
          type: "observation",
        }, "shortTermMemory");

        // Show as thought in feed
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
    const manager = new ConversationManager(storeRef.current, {
      onStreamToken: (npcId, fullText) => {
        setStreamingText((prev) => ({ ...prev, [npcId]: fullText }));
        const speechText = extractSpeechFromStream(fullText);
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
        }
      },
      onTurnComplete: (msg) => {
        setFeed((prev) => [...prev, { type: "chat", msg, timestamp: Date.now() }]);
        setStreamingText((prev) => ({ ...prev, [msg.npcId]: "" }));

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
    });

    // Create day cycle
    const dayCycle = new DayCycle({
      npcStore: storeRef.current,
      language: languageRef.current,
      onPhaseChange: (state) => {
        setDayLabel(dayCycle.getLabel());
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
    storeRef.current.addMemory(
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
      storeRef.current.addMemory(
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

  const handleTogglePanel = useCallback(() => {
    setPanelMode((prev) => {
      if (prev === "collapsed") return "partial";
      if (prev === "partial") return "expanded";
      return "collapsed";
    });
  }, []);

  const handlePlantRumor = useCallback(
    (npcId: string, aboutNpcId: string, rumor: string) => {
      const aboutName = storeRef.current.get(aboutNpcId)?.name ?? aboutNpcId;
      const recipientName = storeRef.current.get(npcId)?.name ?? npcId;
      storeRef.current.addMemory(
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
          panelMode={panelMode}
          onTogglePanel={handleTogglePanel}
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
          />
        </div>
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
