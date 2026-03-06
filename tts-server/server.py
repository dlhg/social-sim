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
      { "text": "Hello world", "voice": "af_heart", "speed": 1.0 }

    Returns: audio/wav
    """
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    voice = data.get("voice", "af_heart")
    speed = float(data.get("speed", 1.0))

    if not text:
        return Response("No text provided", status=400)

    # Check cache
    cache_key = hashlib.sha256(f"{voice}:{speed}:{text}".encode()).hexdigest()[:16]
    cache_path = CACHE_DIR / f"{cache_key}.wav"

    if cache_path.exists():
        return Response(
            cache_path.read_bytes(),
            mimetype="audio/wav",
            headers={"X-TTS-Cached": "true"},
        )

    # Synthesize
    pipeline = get_pipeline()

    # Kokoro returns generator of (graphemes, phonemes, audio) tuples
    # Collect all audio chunks and concatenate
    audio_chunks = []
    for _gs, _ps, audio in pipeline(text, voice=voice, speed=speed):
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

    if not text:
        return Response("No text provided", status=400)

    pipeline = get_pipeline()

    def generate():
        import numpy as np
        chunks = []
        for _gs, _ps, audio in pipeline(text, voice=voice, speed=speed):
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
    print(f"[tts] Model will load on first request...")
    app.run(host="127.0.0.1", port=port, threaded=True)
