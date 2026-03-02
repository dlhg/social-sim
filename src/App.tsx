import { useCallback, useEffect, useRef, useState } from "react";
import { WorldCanvas } from "./components/WorldCanvas";
import { SidePanel } from "./components/SidePanel";
import { NpcCreator } from "./components/NpcCreator";
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
    </div>
  );
}

export default App;
