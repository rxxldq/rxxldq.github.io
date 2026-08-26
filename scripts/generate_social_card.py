"""Regenerate the Open Graph share image from the site's background artwork."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 1200, 630
PAPER = (251, 250, 247, 255)
INK = (24, 24, 22, 255)
QUIET = (91, 88, 82, 255)


def contain(font_path: str, text: str, max_width: int, start_size: int) -> ImageFont.FreeTypeFont:
    size = start_size
    while size > 20:
        font = ImageFont.truetype(font_path, size)
        if font.getlength(text) <= max_width:
            return font
        size -= 1
    return ImageFont.truetype(font_path, size)


canvas = Image.new("RGBA", (WIDTH, HEIGHT), PAPER)

# Keep the same artwork used faintly behind the live site, but make it legible
# enough to survive the compression and cropping used by messaging apps.
art = Image.open(ROOT / "images" / "map.png").convert("RGBA")
art.thumbnail((690, 850), Image.Resampling.LANCZOS)
alpha = art.getchannel("A").point(lambda value: round(value * 0.16))
art.putalpha(alpha)
canvas.alpha_composite(art, (WIDTH - art.width + 35, (HEIGHT - art.height) // 2))

draw = ImageDraw.Draw(canvas)
title = "L’imagination au pouvoir !"
subtitle = "让想象力夺权"
title_font = contain(r"C:\Windows\Fonts\georgiab.ttf", title, 820, 74)
subtitle_font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 32)

left = 88
title_y = 232
draw.text((left, title_y), title, font=title_font, fill=INK)
title_box = draw.textbbox((left, title_y), title, font=title_font)
draw.text((left + 2, title_box[3] + 24), subtitle, font=subtitle_font, fill=QUIET)

output = ROOT / "images" / "share-cover.png"
canvas.convert("RGB").save(output, "PNG", optimize=True)
print(output)
