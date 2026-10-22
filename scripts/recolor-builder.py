"""Generate copper-hat variants of Tiny Swords Pawn sheets used by Builders."""
from collections import deque
from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
SHEETS = (
    "Pawn_Idle.png",
    "Pawn_Run.png",
    "Pawn_Interact Axe.png",
    "Pawn_Interact Pickaxe.png",
    "Pawn_Run Wood.png",
    "Pawn_Run Pickaxe.png",
    "Pawn_Interact Hammer.png",
)
FRAME = 192
HAT_PALETTE = {
    (151, 123, 107): (185, 91, 48),   # copper mid-tone
    (200, 168, 118): (242, 164, 82),  # highlight
    (173, 160, 129): (220, 132, 65), # warm light shade
}


def recolor_hat(frame: Image.Image, label: str) -> Image.Image:
    pixels = frame.load()
    width, height = frame.size
    candidates: set[tuple[int, int]] = set()
    for y in range(52, min(108, height)):
        for x in range(48, min(136, width)):
            if pixels[x, y][:3] in HAT_PALETTE and pixels[x, y][3] > 0:
                candidates.add((x, y))

    components: list[list[tuple[int, int]]] = []
    while candidates:
        start = candidates.pop()
        component = [start]
        queue = deque([start])
        while queue:
            x, y = queue.popleft()
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1),
                           (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1), (x + 1, y + 1)):
                if (nx, ny) in candidates:
                    candidates.remove((nx, ny))
                    component.append((nx, ny))
                    queue.append((nx, ny))
        components.append(component)

    # The hat is the largest connected component of its material palette in the upper head region.
    hat = max(components, key=len, default=[])
    if len(hat) < 90:
        raise RuntimeError(f"Could not safely isolate builder hat in {label}: mask area {len(hat)}")
    for x, y in hat:
        r, g, b, a = pixels[x, y]
        pixels[x, y] = (*HAT_PALETTE[(r, g, b)], a)
    return frame


def main() -> None:
    for team_name in ("Yellow Units", "Red Units"):
        source_dir = ASSETS / "tiny-swords" / "Units" / team_name / "Pawn"
        output_dir = ASSETS / "generated" / "builder" / team_name / "Pawn"
        output_dir.mkdir(parents=True, exist_ok=True)
        for name in SHEETS:
            source = Image.open(source_dir / name).convert("RGBA")
            if source.width % FRAME or source.height != FRAME:
                raise RuntimeError(f"Unexpected sheet dimensions for {team_name}/{name}: {source.size}")
            result = Image.new("RGBA", source.size)
            for index, left in enumerate(range(0, source.width, FRAME)):
                frame = source.crop((left, 0, left + FRAME, FRAME))
                recolor_hat(frame, f"{team_name}/{name} frame {index}")
                result.alpha_composite(frame, (left, 0))
            result.save(output_dir / name, optimize=True)
    print(f"Generated {len(SHEETS) * 2} builder sheets with copper headgear.")


if __name__ == "__main__":
    main()
