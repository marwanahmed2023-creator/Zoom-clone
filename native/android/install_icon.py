from pathlib import Path
import cairosvg
svg = Path("native/android/meet-icon.svg")
out = Path("android/app/src/main/res")
sizes = {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}
for density,size in sizes.items():
    folder = out / ("mipmap-" + density)
    folder.mkdir(parents=True, exist_ok=True)
    png = cairosvg.svg2png(url=str(svg), output_width=size, output_height=size)
    for name in ("ic_launcher.png","ic_launcher_round.png","ic_launcher_foreground.png"):
        (folder / name).write_bytes(png)
adaptive = out / "mipmap-anydpi-v26"
adaptive.mkdir(parents=True, exist_ok=True)
xml = '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>'
(adaptive / "ic_launcher.xml").write_text(xml)
(adaptive / "ic_launcher_round.xml").write_text(xml)
colors = out / "values"
colors.mkdir(parents=True, exist_ok=True)
(colors / "ic_launcher_background.xml").write_text('<resources><color name="ic_launcher_background">#07134D</color></resources>')
