"""
Dual-engine TTS server: proxies to Chatterbox Turbo for English,
uses Kokoro directly for other languages.

The Chatterbox server runs in its own venv on port 8788.
This server handles routing and emotion mapping.

Install (Kokoro venv):
  pip install kokoro soundfile flask flask-cors requests

Usage:
  # Terminal 1: Chatterbox server (separate venv)
  source tts-server/.venv-chatterbox/bin/activate
  python tts-server/chatterbox_server.py

  # Terminal 2: Main server (Kokoro venv)
  source tts-server/.venv/bin/activate
  python tts-server/server.py
"""

import io
import os
import uuid
from pathlib import Path
from flask import Flask, request, Response, jsonify, send_file
from flask_cors import CORS
import numpy as np
import soundfile as sf
import requests as http_requests

app = Flask(__name__)
CORS(app)

# Chatterbox Turbo server URL
CHATTERBOX_URL = os.environ.get("CHATTERBOX_URL", "http://localhost:8788")
VOICES_DIR = Path(__file__).parent / "voices"

# ── Voice pool ────────────────────────────────────
# Each ID maps to a reference audio clip used by Chatterbox
VOICE_POOL = [
    "voice_01",   # warm female
    "voice_02",   # neutral male
    "voice_03",   # british female
    "voice_04",   # deep male
    "voice_05",   # energetic female
    "voice_06",   # british male
    "voice_07",   # clear female
    "voice_08",   # playful male
    "voice_09",   # soft female
    "voice_10",   # steady male
    "voice_11",   # bright female
    "voice_12",   # calm male
    "voice_13",   # smooth female
]

VOICE_DESCRIPTIONS = {
    "voice_01": "Warm Female",
    "voice_02": "Neutral Male",
    "voice_03": "British Female",
    "voice_04": "Deep Male",
    "voice_05": "Energetic Female",
    "voice_06": "British Male",
    "voice_07": "Clear Female",
    "voice_08": "Playful Male",
    "voice_09": "Soft Female",
    "voice_10": "Steady Male",
    "voice_11": "Bright Female",
    "voice_12": "Calm Male",
    "voice_13": "Smooth Female",
}

PREVIEW_DIR = VOICES_DIR / "previews"
PREVIEW_DIR.mkdir(exist_ok=True)

PREVIEW_TEXT = "Hello there! This is what I sound like. Nice to meet you."

# Kokoro voice names — used only for non-English fallback
KOKORO_VOICES = [
    "af_heart", "am_adam", "bf_emma", "am_fenrir", "af_bella",
    "bm_george", "af_nova", "am_puck", "bf_isabella", "am_eric",
    "af_sky", "bm_lewis", "af_nicole",
]

# ── Engine routing ────────────────────────────────

def is_english(language: str | None) -> bool:
    lang = (language or "english").lower().strip()
    return lang in ("english", "british english")


def use_chatterbox(language: str | None, engine: str | None) -> bool:
    """Decide whether to use Chatterbox Turbo. Explicit engine choice wins."""
    if engine == "chatterbox":
        return True
    if engine == "kokoro":
        return False
    return is_english(language)


# ── Chatterbox Turbo (English, via proxy) ─────────

def synthesize_chatterbox(text: str, voice_id: str) -> bytes:
    """Proxy synthesis request to the Chatterbox server."""
    resp = http_requests.post(
        f"{CHATTERBOX_URL}/speak",
        json={"text": text, "voice": voice_id},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.content


# ── Kokoro (non-English fallback) ─────────────────

LANGUAGE_TO_LANG_CODE = {
    "english": "a",
    "british english": "b",
    "spanish": "e",
    "french": "f",
    "hindi": "h",
    "italian": "i",
    "portuguese": "p",
    "brazilian portuguese": "p",
    "japanese": "j",
    "chinese": "z",
    "mandarin": "z",
}

_pipelines: dict = {}  # lang_code -> KPipeline
_kokoro_model = None


def get_pipeline(lang_code: str = "a"):
    global _kokoro_model
    from kokoro import KPipeline

    if lang_code in _pipelines:
        return _pipelines[lang_code]

    if _kokoro_model is None:
        pipeline = KPipeline(lang_code=lang_code)
        _kokoro_model = pipeline.model
        print(f"[tts] Kokoro model loaded, first pipeline: {lang_code}")
    else:
        pipeline = KPipeline(lang_code=lang_code, model=_kokoro_model)
        print(f"[tts] Added Kokoro pipeline for lang_code={lang_code}")

    _pipelines[lang_code] = pipeline
    return pipeline


def resolve_lang_code(language: str | None) -> str | None:
    if not language:
        return "a"
    return LANGUAGE_TO_LANG_CODE.get(language.lower().strip())


def synthesize_kokoro(text: str, voice: str, speed: float, lang_code: str) -> bytes:
    import numpy as np

    pipeline = get_pipeline(lang_code)
    voice_pack = pipeline.load_voice(voice)

    audio_chunks = []
    for _gs, _ps, audio in pipeline(text, voice=voice_pack, speed=speed):
        audio_chunks.append(audio)

    if not audio_chunks:
        raise RuntimeError("Synthesis produced no audio")

    full_audio = np.concatenate(audio_chunks)
    buf = io.BytesIO()
    sf.write(buf, full_audio, 24000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ── Emotion → speech speed mapping ────────────────

def compute_emotion_speed(emotions: dict) -> float:
    if not emotions:
        return 1.0

    speed_delta = 0.0
    speed_delta += emotions.get("anger", 0) * 0.20
    speed_delta += emotions.get("joy", 0) * 0.15
    speed_delta += emotions.get("fear", 0) * 0.18
    speed_delta += emotions.get("curiosity", 0) * 0.05
    speed_delta -= emotions.get("sadness", 0) * 0.20
    speed_delta -= emotions.get("guilt", 0) * 0.15
    speed_delta -= emotions.get("disgust", 0) * 0.10

    return max(0.85, min(1.25, 1.0 + speed_delta))


# ── Endpoints ─────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    # Check if Chatterbox server is reachable
    chatterbox_status = "unavailable"
    try:
        r = http_requests.get(f"{CHATTERBOX_URL}/health", timeout=2)
        if r.ok:
            chatterbox_status = "ok"
    except Exception:
        pass

    return jsonify({
        "status": "ok",
        "engines": {
            "english": {"name": "chatterbox-turbo", "status": chatterbox_status},
            "non_english": {"name": "kokoro", "status": "ok"},
        },
        "languages": list(LANGUAGE_TO_LANG_CODE.keys()),
    })


@app.route("/voices", methods=["GET"])
def voices():
    """Return all available voices with metadata."""
    result = []
    for v in VOICE_POOL:
        result.append({
            "id": v,
            "name": VOICE_DESCRIPTIONS.get(v, v),
            "custom": False,
        })

    # Include custom voices (any .wav not in the pool)
    for wav_file in sorted(VOICES_DIR.glob("*.wav")):
        voice_id = wav_file.stem
        if voice_id not in VOICE_POOL:
            # Derive a readable name from the ID
            display = voice_id.replace("custom_", "").replace("-", " ").replace("_", " ").title()
            result.append({
                "id": voice_id,
                "name": display,
                "custom": True,
            })

    return jsonify({"voices": result})


@app.route("/speak", methods=["POST"])
def speak():
    """
    Synthesize speech and return WAV audio.

    JSON body:
      { "text": "Hello world", "voice": "voice_01", "speed": 1.0,
        "emotions": {"anger": 0, "joy": 0.5, ...},
        "language": "English" }
    """
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    voice = data.get("voice", VOICE_POOL[0])
    speed = float(data.get("speed", 1.0))
    emotions = data.get("emotions")
    language = data.get("language")
    engine = data.get("engine")  # "chatterbox" | "kokoro" | None (auto)

    if not text:
        return Response("No text provided", status=400)

    emotion_speed = compute_emotion_speed(emotions)
    final_speed = speed * emotion_speed

    if use_chatterbox(language, engine):
        # ── Chatterbox Turbo path (proxy to port 8788) ──
        try:
            wav_bytes = synthesize_chatterbox(text, voice)
        except http_requests.ConnectionError:
            return Response(
                "Chatterbox server not running (start chatterbox_server.py)",
                status=503,
            )
        except Exception as e:
            print(f"[tts] Chatterbox error: {e}")
            return Response(f"Synthesis failed: {e}", status=500)

        return Response(wav_bytes, mimetype="audio/wav")
    else:
        # ── Kokoro path ──
        lang_code = resolve_lang_code(language)
        if lang_code is None:
            return Response(f"Language not supported for TTS: {language}", status=400)

        try:
            voice_idx = VOICE_POOL.index(voice)
        except ValueError:
            voice_idx = 0
        kokoro_voice = KOKORO_VOICES[voice_idx % len(KOKORO_VOICES)]

        try:
            wav_bytes = synthesize_kokoro(text, kokoro_voice, final_speed, lang_code)
        except Exception as e:
            print(f"[tts] Kokoro error: {e}")
            return Response(f"Synthesis failed: {e}", status=500)

        return Response(wav_bytes, mimetype="audio/wav")


@app.route("/speak-stream", methods=["POST"])
def speak_stream():
    """Same as /speak but streams the response."""
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    voice = data.get("voice", VOICE_POOL[0])
    speed = float(data.get("speed", 1.0))
    emotions = data.get("emotions")
    language = data.get("language")
    engine = data.get("engine")

    if not text:
        return Response("No text provided", status=400)

    emotion_speed = compute_emotion_speed(emotions)
    final_speed = speed * emotion_speed

    if use_chatterbox(language, engine):
        def generate():
            try:
                yield synthesize_chatterbox(text, voice)
            except Exception as e:
                print(f"[tts] Chatterbox stream error: {e}")

        return Response(generate(), mimetype="audio/wav")
    else:
        lang_code = resolve_lang_code(language)
        if lang_code is None:
            return Response(f"Language not supported: {language}", status=400)

        try:
            voice_idx = VOICE_POOL.index(voice)
        except ValueError:
            voice_idx = 0
        kokoro_voice = KOKORO_VOICES[voice_idx % len(KOKORO_VOICES)]

        def generate():
            try:
                yield synthesize_kokoro(text, kokoro_voice, final_speed, lang_code)
            except Exception as e:
                print(f"[tts] Kokoro stream error: {e}")

        return Response(generate(), mimetype="audio/wav")


@app.route("/upload-voice", methods=["POST"])
def upload_voice():
    """
    Upload a reference audio clip for voice cloning.

    Accepts multipart/form-data with:
      - file: audio file (WAV or MP3)
      - voice_id (optional): custom ID, defaults to custom_<uuid>

    Resamples to 24kHz mono WAV, trims to 10s max.
    """
    if "file" not in request.files:
        return Response("No file provided", status=400)

    file = request.files["file"]
    voice_id = request.form.get("voice_id", f"custom_{uuid.uuid4().hex[:8]}")

    try:
        audio_data, sample_rate = sf.read(io.BytesIO(file.read()))
    except Exception as e:
        return Response(f"Could not read audio file: {e}", status=400)

    # Convert to mono if stereo
    if len(audio_data.shape) > 1:
        audio_data = audio_data.mean(axis=1)

    # Resample to 24kHz if needed
    if sample_rate != 24000:
        duration = len(audio_data) / sample_rate
        new_length = int(duration * 24000)
        audio_data = np.interp(
            np.linspace(0, len(audio_data), new_length),
            np.arange(len(audio_data)),
            audio_data,
        )
        sample_rate = 24000

    # Cap at 30 seconds to avoid huge files — longer clips are fine for quality
    max_samples = 30 * sample_rate
    audio_data = audio_data[:max_samples]

    out_path = VOICES_DIR / f"{voice_id}.wav"
    sf.write(str(out_path), audio_data, sample_rate, subtype="PCM_16")

    duration = round(len(audio_data) / sample_rate, 2)
    print(f"[tts] Saved custom voice: {voice_id} ({duration}s)")

    # Auto-generate a Chatterbox preview clip in the background
    import threading
    def _generate_preview():
        try:
            wav_bytes = synthesize_chatterbox(PREVIEW_TEXT, voice_id)
            preview_path = PREVIEW_DIR / f"{voice_id}.wav"
            preview_path.write_bytes(wav_bytes)
            print(f"[tts] Generated preview for custom voice: {voice_id}")
        except Exception as e:
            print(f"[tts] Preview generation failed for {voice_id}: {e}")
    threading.Thread(target=_generate_preview, daemon=True).start()

    return jsonify({
        "voice_id": voice_id,
        "duration_seconds": duration,
    })


@app.route("/voice-clip/<voice_id>", methods=["GET"])
def voice_clip(voice_id: str):
    """Serve a reference audio clip back to the client for preview."""
    path = VOICES_DIR / f"{voice_id}.wav"
    if not path.exists():
        return Response("Voice not found", status=404)
    return send_file(str(path), mimetype="audio/wav")


@app.route("/voice-preview/<voice_id>", methods=["GET"])
def voice_preview(voice_id: str):
    """
    Serve a pre-rendered Chatterbox preview clip for a voice.
    Generates and caches on first request.
    """
    preview_path = PREVIEW_DIR / f"{voice_id}.wav"
    if preview_path.exists():
        return send_file(str(preview_path), mimetype="audio/wav")

    # Verify the voice reference clip exists
    ref_path = VOICES_DIR / f"{voice_id}.wav"
    if not ref_path.exists():
        return Response("Voice not found", status=404)

    # Generate via Chatterbox
    try:
        wav_bytes = synthesize_chatterbox(PREVIEW_TEXT, voice_id)
        preview_path.write_bytes(wav_bytes)
        print(f"[tts] Generated preview for {voice_id}")
        return send_file(str(preview_path), mimetype="audio/wav")
    except Exception as e:
        print(f"[tts] Preview generation failed for {voice_id}: {e}")
        return Response(f"Preview generation failed: {e}", status=503)


if __name__ == "__main__":
    port = int(os.environ.get("TTS_PORT", 8787))
    print(f"[tts] Starting dual-engine TTS server on http://localhost:{port}")
    print(f"[tts] English: Chatterbox Turbo (via {CHATTERBOX_URL})")
    print(f"[tts] Non-English: Kokoro (local)")
    print(f"[tts] Voice pool: {len(VOICE_POOL)} voices")
    print(f"[tts] Supported languages: {', '.join(LANGUAGE_TO_LANG_CODE.keys())}")
    app.run(host="127.0.0.1", port=port, threaded=True)
