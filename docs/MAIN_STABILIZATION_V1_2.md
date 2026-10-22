# RTS — V1.2 Stabilization / Organic Map Baseline

This branch starts from `main@a8f5bef` to protect the newly implemented
`MAP_ORGANIC_01`, fullscreen HUD, combat FX and calibrated Tiny Swords visuals.
Do **not** merge the older stacked PRs #1 → #2 → #4 wholesale: they were
developed against the previous rectangular/symmetric map and presentation.

## Immediate fixes
- First offensive wave needs two field fighters plus a home guard, not three
  field fighters. Keep the defender when the home base is threatened.
- The last surviving raider can keep pressure on a **visible** nearby enemy base.
- A builder actually **visible** within 12 cells of that base is a priority target
  during siege; the AI cannot inspect hidden enemies or their tasks.
- Record combat and attacks to base in the headless seeded tournament.
- Guard real terrain navigation and tests with CI.

## Third-party art hygiene
- `public/assets/tiny-swords/` remains gitignored.
- Derived builder PNGs are excluded from the public branch (the build can
  fall back to the original Pawn look or temporary geometric render).
- Owners who obtained Pixel Frog's original Tiny Swords Free Pack may install
  the art locally: `npm run assets:install`.
- To restore the copper-hat **local** builder variant, run
  `python -m pip install Pillow` and `python scripts/recolor-builder.py`
  after installation. This intentionally generates local files only.
- The old history still contains derived assets; removing them from this
  branch does not rewrite Git history. Separate history remediation may be
  needed after reviewing the license.
- VisualRegistry tests only validate PNG presence if the owner's official
  pack is locally available; CI never fetches mirrors of licensed work.

## Gates
```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run simulate -- --games=4 --seed=123 --max-seconds=1200 --out=reports-ci
```
Compare the organic map against future seeds and GPU hardware before claiming
balance or 60 FPS. GitHub Actions uploads a Vite build with base path `/RTS/`.
The `main` branch is not modified by this PR.
