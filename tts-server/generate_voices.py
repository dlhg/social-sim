"""
Bootstrap script: generates reference audio clips for Chatterbox Turbo
by synthesizing short monologues using the existing Kokoro voices.

Run once to populate tts-server/voices/ with 13 clips:
  python tts-server/generate_voices.py

Each clip is ~10 seconds of natural speech that Chatterbox will use
as a voice cloning reference.
"""

from pathlib import Path
import soundfile as sf
import numpy as np

VOICES_DIR = Path(__file__).parent / "voices"
VOICES_DIR.mkdir(exist_ok=True)

# Kokoro voices to clone from, paired with new voice IDs
VOICE_MAP = [
    ("af_heart",     "voice_01", "warm female"),
    ("am_adam",      "voice_02", "neutral male"),
    ("bf_emma",      "voice_03", "british female"),
    ("am_fenrir",    "voice_04", "deep male"),
    ("af_bella",     "voice_05", "energetic female"),
    ("bm_george",    "voice_06", "british male"),
    ("af_nova",      "voice_07", "clear female"),
    ("am_puck",      "voice_08", "playful male"),
    ("bf_isabella",  "voice_09", "soft female"),
    ("am_eric",      "voice_10", "steady male"),
    ("af_sky",       "voice_11", "bright female"),
    ("bm_lewis",     "voice_12", "calm male"),
    ("af_nicole",    "voice_13", "smooth female"),
]

# Short monologues — varied content so Chatterbox can capture natural cadence
MONOLOGUES = [
    "I've been thinking about it all morning, and honestly, I think we should take a different approach. Something that feels more natural, you know? Let me explain what I had in mind.",
    "Right, so here's the thing. The weather's been unpredictable lately, and that changes everything about our plans. We need to be flexible. That's just how it goes sometimes.",
    "Oh, that's quite interesting, isn't it? I hadn't considered that perspective before. You make a fair point though. Let me think about how we might work that into the overall plan.",
    "Listen, I don't say this lightly, but something needs to change around here. We've been going back and forth for too long. It's time to make a decision and commit to it.",
    "You know what? I actually love this idea! It's creative, it's bold, and I think people are really going to respond well to it. Let's figure out how to make it happen!",
    "Well, I suppose there are several ways we could look at this situation. On one hand, the risks are quite real. But on the other hand, the potential rewards are extraordinary.",
    "I was walking through the park yesterday when something caught my attention. A small detail, really, but it made me realize how much we overlook in our daily routines.",
    "Ha! That's actually pretty funny when you think about it. I mean, who would have expected things to turn out this way? Life has a strange sense of humor sometimes.",
    "It's a delicate matter, and I want to be thoughtful about how I say this. There are feelings involved, and the last thing I want is for anyone to feel dismissed or overlooked.",
    "The data speaks for itself, frankly. We've seen consistent improvements across every metric we track. Now it's about maintaining that momentum going forward into the next quarter.",
    "Oh my gosh, have you seen the sunrise this morning? It was absolutely gorgeous! All these shades of pink and gold stretching across the sky. I wish I'd taken a picture!",
    "I find these conversations rather fascinating, to be honest. There's always something new to learn when you take the time to really listen to what someone else has to say.",
    "So I've been reading this book about the history of navigation, and it turns out the early explorers were far more sophisticated than most people give them credit for.",
]


def main():
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code="a")
    print(f"[generate_voices] Kokoro loaded, generating {len(VOICE_MAP)} reference clips...")

    for i, (kokoro_voice, voice_id, desc) in enumerate(VOICE_MAP):
        out_path = VOICES_DIR / f"{voice_id}.wav"
        if out_path.exists():
            print(f"  [{voice_id}] already exists, skipping")
            continue

        print(f"  [{voice_id}] {desc} (from {kokoro_voice})...")
        voice_pack = pipeline.load_voice(kokoro_voice)
        text = MONOLOGUES[i % len(MONOLOGUES)]

        audio_chunks = []
        for _gs, _ps, audio in pipeline(text, voice=voice_pack, speed=1.0):
            audio_chunks.append(audio)

        if not audio_chunks:
            print(f"  [{voice_id}] WARNING: no audio produced, skipping")
            continue

        full_audio = np.concatenate(audio_chunks)
        sf.write(str(out_path), full_audio, 24000, format="WAV", subtype="PCM_16")
        duration = len(full_audio) / 24000
        print(f"  [{voice_id}] saved ({duration:.1f}s)")

    print("[generate_voices] Done!")


if __name__ == "__main__":
    main()
