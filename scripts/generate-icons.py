"""assets/icon-source.png から PWA・ブラウザ用のアイコンを生成する

使い方: npm run icons   (Python 3 + Pillow が必要: pip install pillow)

元画像のデザインに応じて、用途ごとに作り分ける。
  A. 白い背景の上に角丸の四角形があるデザイン
     - icon-192 / icon-512 / favicon: 角の白い部分を透明にする
     - apple-touch-icon / maskable: 白い角の部分を、ぼかした元画像で埋めて四角いっぱいに広げる
  B. 背景が四隅まで広がっているデザイン (単色の背景など)
     - icon-192 / icon-512 / favicon: 角を丸く切り抜く
     - apple-touch-icon: そのまま (iPhone が自分で角を丸める)
     - maskable: Android の円形切り抜きに収まるよう縮小し、背景色で余白を埋める
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


def has_white_corners(img: Image.Image) -> bool:
    rgb = img.convert("RGB")
    w, h = rgb.size
    return all(min(rgb.getpixel(xy)) > 235 for xy in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)])


def rounded_corners(img: Image.Image, radius_ratio: float = 0.225) -> Image.Image:
    """角を丸く切り抜く (アプリアイコン風)。4 倍で描いて縮小し、縁を滑らかにする"""
    out = img.convert("RGBA")
    w, h = out.size
    big = Image.new("L", (w * 4, h * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * 4 - 1, h * 4 - 1), radius=int(w * 4 * radius_ratio), fill=255)
    out.putalpha(big.resize((w, h), Image.LANCZOS))
    return out


def corner_color(img: Image.Image) -> tuple[int, int, int]:
    rgb = img.convert("RGB")
    w, h = rgb.size
    pts = [rgb.getpixel(xy) for xy in [(4, 4), (w - 5, 4), (4, h - 5), (w - 5, h - 5)]]
    return tuple(sum(c[i] for c in pts) // len(pts) for i in range(3))  # type: ignore[return-value]


def padded(img: Image.Image, scale: float) -> Image.Image:
    """背景色の上に縮小して配置 (maskable 用)"""
    w, h = img.size
    canvas = Image.new("RGB", (w, h), corner_color(img))
    small = img.convert("RGB").resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    canvas.paste(small, ((w - small.width) // 2, (h - small.height) // 2))
    return canvas


def main() -> None:
    src = Image.open(SRC)
    if has_white_corners(src):
        rounded = transparent_corners(src)
        apple = full_bleed(src)
        # maskable: Android は中央 80% の円を残して切り抜くため、絵を縮小して余白を取る
        mask = maskable(src, scale=0.86)
    else:
        rounded = rounded_corners(src)
        apple = src.convert("RGB")
        mask = padded(src, scale=0.82)
    save(rounded, PUBLIC / "icons" / "icon-192.png", 192)
    save(rounded, PUBLIC / "icons" / "icon-512.png", 512)
    save(rounded, PUBLIC / "favicon.png", 64)
    save(apple, PUBLIC / "apple-touch-icon.png", 180)
    save(mask, PUBLIC / "icons" / "icon-maskable-512.png", 512)


if __name__ == "__main__":
    main()
