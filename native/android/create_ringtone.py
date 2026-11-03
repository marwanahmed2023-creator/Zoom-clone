import math
import struct
import wave
from pathlib import Path

# Generate a small dual-tone telephone-style ring and package it in the APK.
rate = 22050
duration = 1.2
samples = []
for i in range(int(rate * duration)):
    t = i / rate
    phase = t % 0.6
    active = phase < 0.42
    envelope = 0.0 if not active else min(1.0, phase / 0.018, (0.42 - phase) / 0.025)
    value = int(11500 * envelope * (math.sin(2 * math.pi * 440 * t) + math.sin(2 * math.pi * 480 * t)) / 2)
    samples.append(struct.pack("<h", value))

target = Path("android/app/src/main/res/raw/meet_ringtone.wav")
target.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(target), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(rate)
    output.writeframes(b"".join(samples))
