# Hive brand

Quick reference for the logo, colours and type. The files in this folder are generated; rebuild them with `node scripts/build-brand.cjs` instead of editing them by hand.

## The mark

Three cells of a honeycomb: two filled, one still open. It's the same idea as the progress strip on the board, where cells fill with honey as steps finish.

## Colours

| Name | Hex | Use |
|---|---|---|
| Honey | `#f5b700` | The mark, progress, and anything that needs you |
| Honey on light | `#d99c00` | The mark on white backgrounds |
| Ink | `#050506` | Background |
| White | `#ffffff` | Text |
| Wax | `#24262d` | Steps not done yet |

Honey is the only accent. Red (`#ff5d5d`) and blue (`#7cc4ff`) appear only to tag problems and decisions in briefings.

## Type

- **Unbounded** 600: the wordmark only.
- **Geist**: interface text.
- **Geist Mono**: numbers, times and percentages.

All three load from Google Fonts.

## Files

```
docs/brand/
├── mark/          the mark alone
│   ├── on-dark.svg      honey, for dark backgrounds
│   ├── on-light.svg     deeper honey, for light backgrounds
│   ├── card-dark.svg    on a rounded ink square
│   └── card-light.svg   on a rounded white square
├── wordmark/      mark + "hive" (PNG, because GitHub doesn't load web fonts inside SVGs)
│   ├── on-dark.png
│   └── on-light.png
└── raster/
    ├── mark-{64,180,256,512}.png
    ├── favicon-{16,32}.png
    ├── org-avatar.png       GitHub organisation or profile picture
    └── social-preview.png   GitHub social preview (1280x640)
```

The app's own icons (`public/logo.svg`, `apple-touch-icon.png`, `icon-*.png`) come from the same script.
