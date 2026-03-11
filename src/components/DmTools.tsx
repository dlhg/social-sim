import { useState } from "react";
import type { NPC } from "../types";

interface DmToolsProps {
  npcs: NPC[];
  onWhisper: (npcId: string, message: string) => void;
  onWorldEvent: (text: string) => void;
  onForceEncounter: (npcAId: string, npcBId: string) => void;
  onPlantRumor: (npcId: string, aboutNpcId: string, rumor: string) => void;
  onClose: () => void;
}

export function DmTools({
  npcs,
  onWhisper,
  onWorldEvent,
  onForceEncounter,
  onPlantRumor,
  onClose,
}: DmToolsProps) {
  const [activeTool, setActiveTool] = useState<
    "whisper" | "event" | "encounter" | "rumor"
  >("whisper");

  // Whisper state
  const [whisperNpcId, setWhisperNpcId] = useState(npcs[0]?.id ?? "");
  const [whisperMsg, setWhisperMsg] = useState("");

  // Event state
  const [eventText, setEventText] = useState("");

  // Encounter state
  const [encounterA, setEncounterA] = useState(npcs[0]?.id ?? "");
  const [encounterB, setEncounterB] = useState(npcs[1]?.id ?? "");

  // Rumor state
  const [rumorRecipient, setRumorRecipient] = useState(npcs[0]?.id ?? "");
  const [rumorAbout, setRumorAbout] = useState(npcs[1]?.id ?? "");
  const [rumorText, setRumorText] = useState("");

  const tools = [
    { id: "whisper" as const, label: "Whisper" },
    { id: "event" as const, label: "Event" },
    { id: "encounter" as const, label: "Force Meet" },
    { id: "rumor" as const, label: "Rumor" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content dm-tools" onClick={(e) => e.stopPropagation()}>
        <h3>DM Tools</h3>

        <div className="dm-tool-tabs">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`dm-tool-tab${activeTool === t.id ? " active" : ""}`}
              onClick={() => setActiveTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="dm-tool-body">
          {activeTool === "whisper" && (
            <>
              <label>Whisper to</label>
              <select
                value={whisperNpcId}
                onChange={(e) => setWhisperNpcId(e.target.value)}
              >
                {npcs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <label>Message</label>
              <input
                type="text"
                value={whisperMsg}
                onChange={(e) => setWhisperMsg(e.target.value)}
                placeholder="A mysterious voice tells you..."
              />
              <button
                className="btn-dm-action"
                disabled={!whisperMsg.trim()}
                onClick={() => {
                  onWhisper(whisperNpcId, whisperMsg.trim());
                  setWhisperMsg("");
                }}
              >
                Send Whisper
              </button>
            </>
          )}

          {activeTool === "event" && (
            <>
              <label>World Event</label>
              <input
                type="text"
                value={eventText}
                onChange={(e) => setEventText(e.target.value)}
                placeholder="A strange noise echoes from the well..."
              />
              <div className="dm-presets">
                {[
                  "A sudden thunderstorm darkens the sky",
                  "A stranger arrives at the market",
                  "Someone left a mysterious note at the fountain",
                  "A loud argument is heard in the distance",
                ].map((preset) => (
                  <button
                    key={preset}
                    className="dm-preset-btn"
                    onClick={() => setEventText(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <button
                className="btn-dm-action"
                disabled={!eventText.trim()}
                onClick={() => {
                  onWorldEvent(eventText.trim());
                  setEventText("");
                }}
              >
                Broadcast Event
              </button>
            </>
          )}

          {activeTool === "encounter" && (
            <>
              <label>First NPC</label>
              <select
                value={encounterA}
                onChange={(e) => setEncounterA(e.target.value)}
              >
                {npcs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <label>Second NPC</label>
              <select
                value={encounterB}
                onChange={(e) => setEncounterB(e.target.value)}
              >
                {npcs
                  .filter((n) => n.id !== encounterA)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
              <button
                className="btn-dm-action"
                disabled={encounterA === encounterB}
                onClick={() => {
                  onForceEncounter(encounterA, encounterB);
                  onClose();
                }}
              >
                Force Encounter
              </button>
            </>
          )}

          {activeTool === "rumor" && (
            <>
              <label>Tell rumor to</label>
              <select
                value={rumorRecipient}
                onChange={(e) => setRumorRecipient(e.target.value)}
              >
                {npcs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <label>About</label>
              <select
                value={rumorAbout}
                onChange={(e) => setRumorAbout(e.target.value)}
              >
                {npcs
                  .filter((n) => n.id !== rumorRecipient)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
              <label>Rumor</label>
              <input
                type="text"
                value={rumorText}
                onChange={(e) => setRumorText(e.target.value)}
                placeholder="They've been secretly meeting with..."
              />
              <button
                className="btn-dm-action"
                disabled={!rumorText.trim() || rumorRecipient === rumorAbout}
                onClick={() => {
                  onPlantRumor(rumorRecipient, rumorAbout, rumorText.trim());
                  setRumorText("");
                }}
              >
                Plant Rumor
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
