"""
Chatterbox Turbo TTS server — expressive English voice synthesis.

Run with the chatterbox venv:
  source tts-server/.venv-chatterbox/bin/activate
  python tts-server/chatterbox_server.py

Listens on http://localhost:8788
"""

import io
import os
from pathlib import Path
from flask import Flask, request, Response, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

VOICES_DIR = Path(__file__).parent / "voices"

_model = None


def get_model():
    global _model
    if _model is None:
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        # Patch out watermarker — resemble-perth native lib fails on Apple Silicon
        import perth
        if perth.PerthImplicitWatermarker is None:
            class _NoOpWatermarker:
                def apply_watermark(self, wav, sample_rate=None):
                    return wav
            perth.PerthImplicitWatermarker = _NoOpWatermarker
        if torch.backends.mps.is_available():
            device = "mps"
        elif torch.cuda.is_available():
            device = "cuda"
        else:
            device = "cpu"
        _model = ChatterboxTurboTTS.from_pretrained(device=device)
        print(f"[chatterbox] Model loaded on {device}")
    return _model


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "engine": "chatterbox-turbo"})


@app.route("/speak", methods=["POST"])
def speak():
    """
    Synthesize English speech with Chatterbox Turbo.

    JSON body:
      { "text": "Hello", "voice": "voice_01" }

    Returns: audio/wav
    """
    import torchaudio as ta

    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    voice_id = data.get("voice", "voice_01")

    if not text:
        return Response("No text provided", status=400)

    ref_path = VOICES_DIR / f"{voice_id}.wav"
    if not ref_path.exists():
        return Response(f"Reference audio not found: {ref_path}", status=404)

    model = get_model()

    try:
        wav_tensor = model.generate(
            text,
            audio_prompt_path=str(ref_path),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response(f"Synthesis failed: {e}", status=500)

    buf = io.BytesIO()
    ta.save(buf, wav_tensor, model.sr, format="wav")

    return Response(buf.getvalue(), mimetype="audio/wav")


if __name__ == "__main__":
    port = int(os.environ.get("CHATTERBOX_PORT", 8788))
    print(f"[chatterbox] Starting Chatterbox Turbo server on http://localhost:{port}")
    print(f"[chatterbox] Voice clips dir: {VOICES_DIR}")
    print(f"[chatterbox] Model will load on first request...")
    app.run(host="127.0.0.1", port=port, threaded=True)
