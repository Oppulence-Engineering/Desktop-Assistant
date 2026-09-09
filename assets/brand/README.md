# Brand assets

Source of truth for the Oppulence mark. Regenerate every derived icon from
here rather than resizing a downstream copy.

## Files

| File | What it is |
| --- | --- |
| `oppulence-logo-source-1024.png` | The pack file exactly as delivered. Untouched, opaque white background. |
| `oppulence-mark-1024.png` | The working master: same art with the background masked to transparency. |
| `oppulence-lockup-light-bg.png` | Mark + wordmark, dark text, for light backgrounds. |
| `oppulence-lockup-dark-bg.png` | Mark + wordmark, light text, for dark backgrounds. |

The delivered pack also contained 16 pre-rendered sizes (`favicon-*`,
`icon-*`, `apple-touch-icon-*`). They are not stored here because each is a
plain resize of the 1024 source, so keeping them would mean two places to
update. Every in-repo icon is generated from `oppulence-mark-1024.png`.

## Why the master is not the delivered file

The delivered art sits on an opaque white background, which renders as a
white box on any dark surface. The transparent master is produced by masking
that background rather than flood-filling it: a plain flood-fill also eats
the near-white top-right tile, leaving pinholes through the mark.

```bash
magick oppulence-logo-source-1024.png -alpha off -fuzz 2% -fill '#FF00FF' \
  -draw 'color 0,0 floodfill'       -draw 'color 1023,0 floodfill' \
  -draw 'color 0,1023 floodfill'    -draw 'color 1023,1023 floodfill' \
  bgfilled.png
magick bgfilled.png -fuzz 0% -fill white -opaque '#FF00FF' \
  -fill black +opaque white -colorspace gray mask-raw.png
magick mask-raw.png -morphology Open Disk:5 mask-clean.png   # closes pinholes
magick oppulence-logo-source-1024.png \( mask-clean.png -negate \) \
  -alpha off -compose CopyOpacity -composite masked.png
# Trim the transparent margin and re-center, so derived square icons get an
# even bleed instead of inheriting the source's off-centre padding.
magick masked.png -trim +repage -resize 1000x1000 \
  -background none -gravity center -extent 1024x1024 oppulence-mark-1024.png
```

Verified: this sequence reproduces the committed `oppulence-mark-1024.png`
byte-for-byte (`magick compare -metric RMSE` returns 0).

## Regenerating an icon

```bash
magick assets/brand/oppulence-mark-1024.png -resize 512x512 \
  -background none -gravity center -extent 512x512 -strip <target>.png
```

For `.ico`, bundle 16/32/48/64/128/256 into one file. For macOS `.icns`,
build an `.iconset` with `@1x`/`@2x` pairs and run `iconutil -c icns`.

## The mark is full color

The previous mark was a black silhouette, so light-on-dark surfaces corrected
it with `filter: invert(1)`. Inverting this one turns the brand blue orange.
Do not reintroduce those filters.

## Name spelling

The product is **Oppulence**, with two p's, as `PRODUCT_NAME` in
`apps/x/packages/shared/src/branding.ts` declares. The delivered brand pack
spelled it "Opulence" in its `site.webmanifest` and filenames; that was a
mistake in the pack, not a rename, so every in-repo manifest and asset uses
the two-p spelling. Anything regenerated from a future pack should be checked
for the same slip.
