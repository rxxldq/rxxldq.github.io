"""Generate a restrained website calling card from the archive's own artwork."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 1080, 1080
PAPER = (251, 250, 247, 255)
INK = (24, 24, 22, 255)
QUIET = (96, 93, 87, 255)


def fit(font_path: str, text: str, max_width: int, start_size: int) -> ImageFont.FreeTypeFont:
    size = start_size
    while size > 20:
        font = ImageFont.truetype(font_path, size)
        if font.getlength(text) <= max_width:
            return font
        size -= 1
    return ImageFont.truetype(font_path, size)


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int, int],
    tracking: float,
) -> None:
    """Draw a line with restrained editorial letter spacing."""
    x, y = position
    for character in text:
        draw.text((x, y), character, font=font, fill=fill)
        x += font.getlength(character) + tracking


canvas = Image.new("RGBA", (WIDTH, HEIGHT), PAPER)

# A barely visible warm paper grain keeps the large quiet areas from feeling
# digitally flat. The blend is deliberately weak so text remains crisp.
grain = Image.effect_noise((WIDTH, HEIGHT), 7).convert("L")
paper_texture = ImageOps.colorize(
    grain,
    black=(247, 245, 240),
    white=(255, 254, 251),
).convert("RGBA")
canvas = Image.blend(canvas, paper_texture, 0.055)

# Reuse the site's original character artwork. It stays to one side rather than
# sitting directly under the address, preserving a quieter editorial layout.
art = Image.open(ROOT / "images" / "map.png").convert("RGBA")
art.thumbnail((700, 880), Image.Resampling.LANCZOS)
alpha = art.getchannel("A").point(lambda value: round(value * 0.29))
art.putalpha(alpha)
canvas.alpha_composite(art, (WIDTH - art.width + 146, 86))

draw = ImageDraw.Draw(canvas)
address_name = "RXXLDQ"
address_suffix = ".github.io"
french = "L’imagination au pouvoir !"
chinese = "让想象力夺权"

address_name_font = ImageFont.truetype(r"C:\Windows\Fonts\segoeuil.ttf", 116)
address_suffix_font = ImageFont.truetype(r"C:\Windows\Fonts\segoeuil.ttf", 46)
french_font = ImageFont.truetype(r"C:\Windows\Fonts\segoeuil.ttf", 25)
chinese_font = ImageFont.truetype(r"C:\Windows\Fonts\msyhl.ttc", 19)

left = 76
draw_tracked(draw, (left, 398), address_name, address_name_font, INK, 6.2)
draw_tracked(
    draw,
    (left + 4, 532),
    address_suffix,
    address_suffix_font,
    (76, 73, 68, 255),
    1.2,
)

# The title sits like a quiet signature in the clearer lower-left corner.
french_y = 924
draw.text((left + 2, french_y), french, font=french_font, fill=QUIET)
french_box = draw.textbbox((left + 2, french_y), french, font=french_font)
draw.text((left + 3, french_box[3] + 10), chinese, font=chinese_font, fill=QUIET)

output = ROOT / "images" / "site-card.png"
canvas.convert("RGB").save(output, "PNG", optimize=True)
print(output)
