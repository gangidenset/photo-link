"""assets/icon-source.png から PWA・ブラウザ用のアイコンを生成する

使い方: npm run icons   (Python 3 + Pillow が必要: pip install pillow)

元画像は「白い背景の上に角丸の四角形」のデザインのため、用途ごとに作り分ける。
  - icon-192 / icon-512 / favicon: 角の白い部分を透明にする
  - apple-touch-icon / maskable: OS が自分で角丸や円に切り抜くため、四角いっぱいに絵を広げる
    (白い角の部分は、ぼかした元画像で埋める)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon-source.png"
PUBLIC = ROOT / "public"


def corner_mask(img: Image.Image) -> Image.Image:
    """四隅からつながる白っぽい部分を 0、それ以外を 255 にしたマスク"""
    rgb = img.convert("RGB")
    w, h = rgb.size
    # 白さ (RGB の最小値) で 2 値化し、四隅から塗りつぶして「外側の白」だけを特定
    whiteness = ImageChops.darker(ImageChops.darker(*rgb.split()[:2]), rgb.split()[2])
    binary = whiteness.point(lambda v: 255 if v > 235 else 0)
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if binary.getpixel(xy) == 255:
            ImageDraw.floodfill(binary, xy, 128)
    mask = binary.point(lambda v: 0 if v == 128 else 255)
    # 境界のギザギザを抑える
    return mask.filter(ImageFilter.GaussianBlur(1.2))


def transparent_corners(img: Image.Image) -> Image.Image:
    out = img.convert("RGBA")
    out.putalpha(corner_mask(img))
    return out


def full_bleed(img: Image.Image, scale: float = 1.0) -> Image.Image:
    """四角いっぱいの画像 (白い角は、ぼかした絵で埋める)。scale < 1 で中央に縮小配置"""
    w, h = img.size
    fg = transparent_corners(img)
    bg = img.convert("RGB").resize((int(w * 1.25), int(h * 1.25)), Image.LANCZOS)
    left, top = (bg.width - w) // 2, (bg.height - h) // 2
    bg = bg.crop((left, top, left + w, top + h)).filter(ImageFilter.GaussianBlur(w / 20))
    canvas = bg.convert("RGBA")
    if scale != 1.0:
        fg = fg.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    canvas.alpha_composite(fg, ((w - fg.width) // 2, (h - fg.height) // 2))
    return canvas.convert("RGB")


def maskable(img: Image.Image, scale: float = 0.8) -> Image.Image:
    """Android の円形切り抜き用: 絵を縮小し、縁をぼかして背景になじませる"""
    w, h = img.size
    full = full_bleed(img)
    bg = full.resize((w // 8, h // 8), Image.LANCZOS).resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(w / 15))
    fg = full.resize((int(w * scale), int(h * scale)), Image.LANCZOS).convert("RGBA")
    feather = int(fg.width * 0.06)
    alpha = Image.new("L", fg.size, 0)
    ImageDraw.Draw(alpha).rounded_rectangle(
        (feather, feather, fg.width - feather, fg.height - feather), radius=fg.width // 5, fill=255
    )
    fg.putalpha(alpha.filter(ImageFilter.GaussianBlur(feather / 2)))
    canvas = bg.convert("RGBA")
    canvas.alpha_composite(fg, ((w - fg.width) // 2, (h - fg.height) // 2))
    return canvas.convert("RGB")


def save(img: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print("generated", path.relative_to(ROOT))


def main() -> None:
    src = Image.open(SRC)
    rounded = transparent_corners(src)
    save(rounded, PUBLIC / "icons" / "icon-192.png", 192)
    save(rounded, PUBLIC / "icons" / "icon-512.png", 512)
    save(rounded, PUBLIC / "favicon.png", 64)
    save(full_bleed(src), PUBLIC / "apple-touch-icon.png", 180)
    # maskable: Android は中央 80% の円を残して切り抜くため、絵を縮小して余白を取る
    save(maskable(src, scale=0.86), PUBLIC / "icons" / "icon-maskable-512.png", 512)


if __name__ == "__main__":
    main()
