"""
Lightweight local TTS server using Kokoro (82M params).
Streams WAV audio back over HTTP for each NPC speech line.

Install:
  pip install kokoro soundfile flask flask-cors

First run downloads the model (~300MB) from HuggingFace automatically.

Usage:
  python tts-server/server.py
  # Listens on http://localhost:8787
"""

import io
import hashlib
import os
from pathlib import Path
from flask import Flask, request, Response, jsonify
from flask_cors import CORS
import soundfile as sf

app = Flask(__name__)
CORS(app)

# Lazy-init so the server starts fast
_pipeline = None

# On-disk cache to avoid re-synthesizing identical lines
CACHE_DIR = Path(__file__).parent / ".tts-cache"
CACHE_DIR.mkdir(exist_ok=True)


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        from kokoro import KPipeline
        _pipeline = KPipeline(lang_code="a")  # American English
        print("[tts] Kokoro pipeline loaded")
    return _pipeline


# ── Available voice pool ──────────────────────────
# These are the English voices we rotate through for NPCs.
# Mixing male/female, American/British for variety.
VOICE_POOL = [
    "af_heart",      # warm female
    "am_adam",        # neutral male
    "bf_emma",        # british female
    "am_fenrir",      # deep male
    "af_bella",       # energetic female
    "bm_george",      # british male
    "af_nova",        # clear female
    "am_puck",        # playful male
    "bf_isabella",    # soft british female
    "am_eric",        # steady male
    "af_sky",         # bright female
    "bm_lewis",       # calm british male
    "af_nicole",      # smooth female
]

# ── Emotion → speech speed mapping ────────────────
# Returns a speed multiplier based on the dominant emotional state.
# Base speed comes from the request; this applies a modifier on top.

def compute_emotion_speed(emotions: dict) -> float:
    """Map emotional state to a speed modifier (0.85 – 1.25)."""
    if not emotions:
        return 1.0

    anger = emotions.get("anger", 0)
    joy = emotions.get("joy", 0)
    sadness = emotions.get("sadness", 0)
    fear = emotions.get("fear", 0)
    curiosity = emotions.get("curiosity", 0)
    disgust = emotions.get("disgust", 0)
    guilt = emotions.get("guilt", 0)

    # Weighted contribution: each emotion pulls speed in a direction
    # Positive = faster, negative = slower
    speed_delta = 0.0
    speed_delta += anger * 0.20       # anger → faster, clipped
    speed_delta += joy * 0.15         # joy → slightly faster, upbeat
    speed_delta += fear * 0.18        # fear → faster, nervous
    speed_delta += curiosity * 0.05   # curiosity → very slightly faster
    speed_delta -= sadness * 0.20     # sadness → slower, heavy
    speed_delta -= guilt * 0.15       # guilt → slower, hesitant
    speed_delta -= disgust * 0.10     # disgust → slower, deliberate

    # Clamp to reasonable range
    return max(0.85, min(1.25, 1.0 + speed_delta))


# ── Emotion → voice blending ─────────────────────
# Slightly blend the NPC's base voice toward an "emotional modifier"
# voice to shift the tonal quality.

# Modifier voices: chosen for their tonal character
EMOTION_VOICE_MODIFIERS = {
    "intense": "am_fenrir",     # deep, intense → anger, confrontation
    "bright": "af_bella",       # energetic, bright → joy, excitement
    "soft": "bf_isabella",      # soft, gentle → sadness, vulnerability
    "nervous": "af_sky",        # bright, quick → fear, anxiety
}


def compute_voice_blend(base_voice: str, emotions: dict):
    """
    Return (voice_spec, blend_key) where voice_spec is either:
    - the base voice name (no blending needed)
    - a pre-blended tensor (needs to be passed directly)
    blend_key is a string for cache keying.
    """
    if not emotions:
        return base_voice, base_voice

    # Find dominant emotion (excluding trust/curiosity which don't need voice shifts)
    emotion_scores = {
        "intense": max(emotions.get("anger", 0), emotions.get("disgust", 0) * 0.6),
        "bright": emotions.get("joy", 0),
        "soft": max(emotions.get("sadness", 0), emotions.get("guilt", 0) * 0.7),
        "nervous": emotions.get("fear", 0),
    }

    dominant = max(emotion_scores, key=emotion_scores.get)
    strength = emotion_scores[dominant]

    # Only blend if the emotion is meaningfully strong
    if strength < 0.35:
        return base_voice, base_voice

    modifier_voice = EMOTION_VOICE_MODIFIERS[dominant]

    # Don't blend a voice with itself
    if modifier_voice == base_voice:
        return base_voice, base_voice

    # Blend weight: scales from 0 at threshold to 0.25 at max
    blend_weight = min(0.25, (strength - 0.35) * 0.38)
    blend_key = f"{base_voice}+{modifier_voice}@{blend_weight:.2f}"

    return (base_voice, modifier_voice, blend_weight), blend_key


def resolve_voice_pack(pipeline, voice_spec):
    """
    Given a voice_spec from compute_voice_blend, return a voice tensor.
    voice_spec is either a string (plain voice name) or a tuple
    (base, modifier, weight) for blending.
    """
    import torch

    if isinstance(voice_spec, str):
        return pipeline.load_voice(voice_spec)

    base_name, modifier_name, weight = voice_spec
    base_pack = pipeline.load_single_voice(base_name)
    modifier_pack = pipeline.load_single_voice(modifier_name)
    # Weighted interpolation
    blended = (1.0 - weight) * base_pack + weight * modifier_pack
    return blended.to(base_pack.device)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "engine": "kokoro"})


@app.route("/voices", methods=["GET"])
def voices():
    """Return the voice pool so the frontend can assign voices to NPCs."""
    return jsonify({"voices": VOICE_POOL})


@app.route("/speak", methods=["POST"])
def speak():
    """
    Synthesize speech and return WAV audio.

    JSON body:
      { "text": "Hello world", "voice": "af_heart", "speed": 1.0,
        "emotions": {"anger": 0, "joy": 0.5, ...} }

    Returns: audio/wav
    """
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    voice = data.get("voice", "af_heart")
    speed = float(data.get("speed", 1.0))
    emotions = data.get("emotions")

    if not text:
        return Response("No text provided", status=400)

    # Compute emotion-aware speed and voice blend
    emotion_speed = compute_emotion_speed(emotions)
    final_speed = speed * emotion_speed
    voice_spec, blend_key = compute_voice_blend(voice, emotions)

    # Check cache (keyed on blended voice + emotion-adjusted speed + text)
    cache_key = hashlib.sha256(f"{blend_key}:{final_speed:.3f}:{text}".encode()).hexdigest()[:16]
    cache_path = CACHE_DIR / f"{cache_key}.wav"

    if cache_path.exists():
        return Response(
            cache_path.read_bytes(),
            mimetype="audio/wav",
            headers={"X-TTS-Cached": "true"},
        )

    # Synthesize
    pipeline = get_pipeline()
    voice_pack = resolve_voice_pack(pipeline, voice_spec)

    # Kokoro returns generator of (graphemes, phonemes, audio) tuples
    # Collect all audio chunks and concatenate
    audio_chunks = []
    for _gs, _ps, audio in pipeline(text, voice=voice_pack, speed=final_speed):
        audio_chunks.append(audio)

    if not audio_chunks:
        return Response("Synthesis produced no audio", status=500)

    import numpy as np
    full_audio = np.concatenate(audio_chunks)

    # Write to WAV buffer
    buf = io.BytesIO()
    sf.write(buf, full_audio, 24000, format="WAV", subtype="PCM_16")
    wav_bytes = buf.getvalue()

    # Cache it
    cache_path.write_bytes(wav_bytes)

    return Response(
        wav_bytes,
        mimetype="audio/wav",
        headers={"X-TTS-Cached": "false"},
    )


@app.route("/speak-stream", methods=["POST"])
def speak_stream():
    """
    Streaming version: starts sending WAV chunks as soon as the first
    segment is ready, so playback can begin with lower latency.

    Same JSON body as /speak.
    Returns: audio/wav (complete file, but synthesis starts immediately)
    """
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    voice = data.get("voice", "af_heart")
    speed = float(data.get("speed", 1.0))
    emotions = data.get("emotions")

    if not text:
        return Response("No text provided", status=400)

    emotion_speed = compute_emotion_speed(emotions)
    final_speed = speed * emotion_speed
    voice_spec, _blend_key = compute_voice_blend(voice, emotions)

    pipeline = get_pipeline()
    voice_pack = resolve_voice_pack(pipeline, voice_spec)

    def generate():
        import numpy as np
        chunks = []
        for _gs, _ps, audio in pipeline(text, voice=voice_pack, speed=final_speed):
            chunks.append(audio)

        if chunks:
            full_audio = np.concatenate(chunks)
            buf = io.BytesIO()
            sf.write(buf, full_audio, 24000, format="WAV", subtype="PCM_16")
            yield buf.getvalue()

    return Response(generate(), mimetype="audio/wav")


if __name__ == "__main__":
    port = int(os.environ.get("TTS_PORT", 8787))
    print(f"[tts] Starting Kokoro TTS server on http://localhost:{port}")
    print(f"[tts] Cache dir: {CACHE_DIR}")
    print(f"[tts] Voice pool: {len(VOICE_POOL)} voices")
    print(f"[tts] Emotion-aware speed & voice blending enabled")
    print(f"[tts] Model will load on first request...")
    app.run(host="127.0.0.1", port=port, threaded=True)
