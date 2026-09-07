from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "packages" / "client"
PUBLIC = CLIENT / "public"
OUT = PUBLIC / "cards"
OUT.mkdir(parents=True, exist_ok=True)

FONT = Path("C:/Windows/Fonts/msyh.ttc")
FONT_BOLD = Path("C:/Windows/Fonts/msyhbd.ttc")

def font(size, bold=False):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT), size)

def cover(img, size):
    ratio = max(size[0] / img.width, size[1] / img.height)
    img = img.resize((round(img.width * ratio), round(img.height * ratio)), Image.Resampling.LANCZOS)
    left = (img.width - size[0]) // 2
    top = (img.height - size[1]) // 2
    return img.crop((left, top, left + size[0], top + size[1]))

def make_character_cards():
    frame = Image.open(OUT / "role-frame.png").convert("RGBA").resize((768, 1152), Image.Resampling.LANCZOS)
    portraits = PUBLIC / "characters"
    data = [
        ("chr_captain", "船长", "开局亮出此牌：你是第一任船长。"),
        ("chr_kleptomaniac", "窃癖者", "从一名玩家的个人补给偷取 1 把枪。"),
        ("chr_troublemaker", "捣乱者", "枪揭示后，指定一名玩家，其枪按 2 把计算。"),
        ("chr_gunsmith", "军械师", "弃掉 1 把枪以亮出此牌。"),
        ("chr_peacemaker", "和平使者", "枪揭示后，指定玩家收回其揭示的枪。"),
        ("chr_gunslinger", "枪手", "从供应区取 2 把枪加入个人补给。"),
        ("chr_minstrel", "吟游诗人", "任命后指定两名玩家跳过下一次哗变。"),
        ("chr_bosun", "水手长", "抽牌前交换副手与领航员职位徽章。"),
        ("chr_herbalist", "草药师", "任命前把一张停职牌移给另一名玩家。"),
        ("chr_lookout", "瞭望员", "查看牌堆顶导航牌并决定弃掉或放回。"),
        ("chr_master_strategist", "大战略家", "枪揭示后，哗变结束时收回自己的枪。"),
        ("chr_smuggler", "走私者", "指定船长或副手抽取 3 张导航牌。"),
        ("chr_agitator", "煽动者", "指定两名玩家必须各至少揭示 1 把枪。"),
        ("chr_consultant", "顾问", "任命前指定新任副手。"),
        ("chr_chief_cook", "主厨", "任命后船长职沿顺时针移交。"),
        ("chr_rabble_rouser", "蛊惑者", "本次哗变所需枪数减半，向上取整。"),
        ("chr_archivist", "档案员", "指定船长或副手弃牌并重抽 2 张。"),
        ("chr_mentor", "导师", "指定一名玩家将角色牌翻回背面。"),
        ("chr_spiritualist", "通灵者", "指定两名玩家各交出 1 把枪。"),
        ("chr_debt_collector", "讨债人", "指定航海组成员给其他成员各 1 把枪。"),
        ("chr_equalizer", "平权者", "下一次哗变只需 1 把枪即可成功。"),
        ("chr_instigator", "教唆者", "指定一名玩家加入其全部枪，或翻回背面。"),
    ]
    for cid, name, text in data:
        source = portraits / f"{cid}.jpg"
        if not source.exists():
            continue
        card = frame.copy()
        source_image = Image.open(source).convert("RGB")
        # Existing role art contains a title strip at the bottom; keep the illustration only.
        source_image = source_image.crop((0, 0, source_image.width, round(source_image.height * 0.78)))
        art = cover(source_image, (594, 760)).convert("RGBA")
        card.alpha_composite(art, (87, 112))
        draw = ImageDraw.Draw(card)
        draw.rectangle((87, 875, 681, 1038), fill=(183, 143, 76, 235))
        draw.text((384, 910), name, font=font(34, True), fill=(35, 25, 15), anchor="mm")
        draw.text((384, 972), "ABILITY · 角色能力", font=font(17, True), fill=(49, 35, 20), anchor="mm")
        draw.multiline_text((384, 1008), text, font=font(15), fill=(49, 35, 20), anchor="mm", align="center", spacing=3, stroke_width=0)
        card.convert("RGB").save(OUT / f"role-{cid}.jpg", quality=92, optimize=True)

def crop_cards(source, names, boxes, prefix):
    image = Image.open(source).convert("RGBA")
    for name, box in zip(names, boxes):
        card = image.crop(box)
        # The source sheets use white spacing; make only the near-white outer area transparent.
        px = card.load()
        for y in range(card.height):
            for x in range(card.width):
                r, g, b, a = px[x, y]
                if r > 246 and g > 246 and b > 246:
                    px[x, y] = (255, 255, 255, 0)
        card.save(OUT / f"{prefix}-{name}.png", optimize=True)

def main():
    make_character_cards()
    media = next(Path(__import__('tempfile').gettempdir()).glob("kraken_docx_media_*")) / "word" / "media"
    crop_cards(media / "image5.jpeg", ["conversion-1", "conversion-2", "conversion-3", "guns-stash", "cabin-search"], [(0, 0, 405, 365), (405, 0, 810, 365), (810, 0, 1216, 365), (210, 365, 610, 729), (610, 365, 1010, 729)], "ritual")
    crop_cards(media / "image6.jpeg", ["cult-uprising", "drunk-east", "disarmed", "drunk-west", "mermaid", "telescope", "armed"], [(55, 0, 405, 380), (405, 0, 785, 380), (785, 0, 1160, 380), (0, 395, 300, 796), (300, 395, 590, 796), (590, 395, 895, 796), (895, 395, 1194, 796)], "nav")

if __name__ == "__main__":
    main()
