import { useCallback, useEffect, useRef, useState } from "react";
import { WorldCanvas } from "./components/WorldCanvas";
import { SidePanel } from "./components/SidePanel";
import { NpcCreator } from "./components/NpcCreator";
import { DmTools } from "./components/DmTools";
import { NpcStore } from "./npc-store";
import { initialNpcs } from "./npcs";
import { ConversationManager } from "./conversation-manager";
import { WorldSimulation } from "./world-simulation";
import type { NPC } from "./types";
import type { TabId, NpcSnapshot, FeedItem } from "./components/SidePanel";
import "./App.css";

function App() {
  const storeRef = useRef(new NpcStore(initialNpcs));
  const [npcs, setNpcs] = useState<NPC[]>(() => storeRef.current.getAll());
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [streamingText, setStreamingText] = useState<Record<string, string>>(
    {}
  );
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [activeConversationPair, setActiveConversationPair] = useState<
    [string, string] | null
  >(null);
  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [dmToolsOpen, setDmToolsOpen] = useState(false);

  // New state for side panel
  const [activeTab, setActiveTab] = useState<TabId>("feed");
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [npcHistory, setNpcHistory] = useState<Record<string, NpcSnapshot[]>>(
    {}
  );

  const managerRef = useRef<ConversationManager | null>(null);
  const worldRef = useRef<WorldSimulation | null>(null);

  useEffect(() => {
    return storeRef.current.subscribe(() => {
      setNpcs(storeRef.current.getAll());
    });
  }, []);

  const handleStart = useCallback(() => {
    setFeed([]);
    setStreamingText({});
    setCurrentSpeaker(null);
    setActiveConversationPair(null);
    setNpcHistory({});

    // Create world simulation
    const world = new WorldSimulation({
      gridWidth: 24,
      gridHeight: 16,
      tickIntervalMs: 200,
      onProximity: (aId, bId) => {
        managerRef.current?.triggerConversation(aId, bId);
      },
      npcStore: storeRef.current,
    });

    // Register NPCs at different starting positions (spread across waypoints)
    const allNpcs = storeRef.current.getAll();
    const startPositions = [
      { x: 12, y: 8 }, // Fountain
      { x: 4, y: 12 }, // Park Bench
      { x: 20, y: 4 }, // Old Tree
      { x: 7, y: 3 }, // Garden
      { x: 18, y: 13 }, // Market
      { x: 3, y: 7 }, // Well
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
      },
      onTurnComplete: (msg) => {
        setFeed((prev) => [...prev, { type: "chat", msg, timestamp: Date.now() }]);
        setStreamingText((prev) => ({ ...prev, [msg.npcId]: "" }));

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
      },
      onSpeakerChange: (npcId) => {
        setCurrentSpeaker(npcId);
        if (npcId) {
          setStreamingText((prev) => ({ ...prev, [npcId]: "" }));
        }
      },
    });

    managerRef.current = manager;
    manager.setWorldSimulation(world);
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
    managerRef.current?.stop();
    managerRef.current = null;
    worldRef.current?.stop();
    worldRef.current = null;
    setStatus("idle");
    setCurrentSpeaker(null);
    setActiveConversationPair(null);
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

  return (
    <div className="app">
      <div className="main-content">
        <div className="world-panel">
          <WorldCanvas
            getSnapshot={() =>
              worldRef.current?.getSnapshot() ?? {
                npcs: [],
                waypoints: [],
                tickIntervalMs: 200,
              }
            }
            getNpc={(id) => storeRef.current.get(id)}
            currentSpeaker={currentSpeaker}
            activeConversationPair={activeConversationPair}
          />
        </div>
        <SidePanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          npcs={npcs}
          feed={feed}
          currentSpeaker={currentSpeaker}
          selectedNpcId={selectedNpcId}
          onSelectNpc={setSelectedNpcId}
          npcHistory={npcHistory}
        />
      </div>
      <div className="controls">
        {status === "idle" ? (
          <button onClick={handleStart} className="btn btn-start">
            Start
          </button>
        ) : (
          <>
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
          </>
        )}
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
    </div>
  );
}

export default App;
