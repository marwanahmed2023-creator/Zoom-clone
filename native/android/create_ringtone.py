import math
import struct
import wave
from pathlib import Path

# A soft, friendly bell-like melody: a short rising-and-falling three-note phrase.
# Gentle harmonics and smooth envelopes keep it warm rather than a harsh telephone tone.
rate = 24000
notes = [
    (523.25, 0.20),  # C5
    (659.25, 0.20),  # E5
    (783.99, 0.30),  # G5
    (659.25, 0.20),  # E5
    (523.25, 0.34),  # C5
]
gap = 0.055
cycle = sum(duration for _, duration in notes) + gap * (len(notes) - 1) + 0.55
frames = []

for i in range(int(rate * cycle)):
    t = i / rate
    cursor = 0.0
    sample = 0.0
    for frequency, duration in notes:
        local = t - cursor
        if 0 <= local < duration:
            attack = min(1.0, local / 0.025)
            decay = math.exp(-2.6 * local / duration)
            release = min(1.0, (duration - local) / 0.045)
            envelope = attack * decay * release
            fundamental = math.sin(2 * math.pi * frequency * local)
            overtone = 0.24 * math.sin(2 * math.pi * frequency * 2.01 * local)
            soft_harmonic = 0.08 * math.sin(2 * math.pi * frequency * 3.0 * local)
            sample += envelope * (fundamental + overtone + soft_harmonic)
            break
        cursor += duration + gap
    value = int(6500 * sample)
    frames.append(struct.pack("<h", max(-32767, min(32767, value))))

target = Path("android/app/src/main/res/raw/meet_ringtone.wav")
target.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(target), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(rate)
    output.writeframes(b"".join(frames))
