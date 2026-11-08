# Pixel mouse pet artwork

Generated with the built-in Imagegen tool on 2026-11-07 from the user's mouse reference as style and subject guidance. The stock reference was not copied into the repository. This new sprite sheet is AI-generated; no license is asserted for the supplied reference. Existing pet SVGs are retained.

Selected output: `pixel-mouse-idle-v1.png`, 1254 x 1254 RGBA PNG, 4 columns by 4 rows, 16 idle frames. Playback crops equal cells through CSS; the source image is kept byte-for-byte with generated transparency. Some near-transparent pixels have arbitrary RGB values; the asset was inspected composited rather than by unassociated RGB alone.

Model output alone does not prove perfect frame alignment or native desktop appearance. Check the composited animation, the 128px product footprint, all six semantic states, and both reduced-motion settings. The supplied image is a reference only; no stock watermark is removed from a shipped source asset.

## Generation prompt

```text
Use case: stylized-concept. Asset type: original transparent 8-bit pixel-art SPRITE SHEET for an animated desktop pet. The supplied mouse picture is a STYLE/SUBJECT REFERENCE ONLY, not an edit target; create your own clean original mouse drawing, do not reproduce any stock image or its watermark.
Primary request: a charming tiny grey mouse in strict retro 8-bit pixel art, oversized round ears, light grey ear interiors, black square eyes, tiny pink nose, short pink paws, thin long pink stepped tail curving to the right, standing upright and facing slightly left like the reference. Simple expressive silhouette that reads at 64px. Restrained grey + soft pink palette, hard square pixel edges, flat colors with only 2 grey shadow tones, no smoothing, no antialiasing, no gradients, no paper texture, no blur, no 3D.
OUTPUT LAYOUT IS CRITICAL: exactly a 4-column by 4-row evenly spaced sprite sheet, 16 equal square cells filling a square canvas. Suggested canvas 1024x1024, each cell exactly 256x256. NO grid lines, labels, numbers, border, shadows, caption, watermark, or background. True transparent alpha everywhere outside the mouse. Each cell contains the SAME mouse at the SAME scale and pixel grid, same horizontal anchor, same baseline and constant ample transparent padding; tail and ears fully inside each cell. Each sprite occupies roughly 75 percent of its cell. No extra characters or props.
ANIMATION: a seamless restrained 16-frame idle loop in reading order left to right top to bottom: frames 1-4 neutral and gentle breathing; frames 5-8 one tiny blink, eyes close briefly and reopen; frames 9-12 gentle breathing and slight tail tip sway; frames 13-16 return to neutral. Keep paws planted on identical baseline, no walking or jumping or turning, no change of character proportions. Last pose must match first for a seamless loop. Movement only 1 logical pixel in the body/ears/tail, no whole-sprite drifting or shrinking. Each cell must be a single animation frame, NOT a collage. Original game-ready sprite art on genuine transparency.
```

## Targeted cleanup prompt

```text
Edit only the supplied ORIGINAL generated mouse animation sprite sheet to make it production-ready. Keep the grey mouse design with oversized round ears, tiny black eyes, pink nose/paws and pink tail, and preserve the 4 columns by 4 rows / 16-frame layout and gentle idle blink/tail animation. The supplied original GENERATED sheet has severe extraneous red, black and white noisy blobs in all the space between sprites. REMOVE ALL OF THOSE BLOBS COMPLETELY. Every single pixel outside the 16 mouse silhouettes must be genuinely transparent alpha zero. Nothing else belongs in the image. No background, colored spill, matte, shadow, texture, noise, decorations, watermark, labels, grids or borders. Each mouse has uniform clean hard square 8-bit pixels with no antialiasing, gray outlines not shadow, and 25% empty transparent padding within its cell. Align every mouse's planted feet at the identical y baseline within each cell and center the body in the same location, identical scale throughout. Perfect 4x4 equal square cells covering the entire square canvas. First and last poses match for a seamless gentle loop. Only the mouse sprites are opaque; completely empty transparent space surrounds them.
```

## Delivery

Asset generated using the built-in tool, not a CLI or API-key fallback. Final consuming code and validation are reported in the focused pet redesign PR.

SHA-256 of the unchanged supplied PNG: `215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e`.

Implementation validation: focused pet tests, TypeScript check, and production web build passed. A headless Chromium check decoded the original 1254px PNG and verified the 128px viewport, all 16 row-major cells and wrap, six state treatments, no legacy transforms, and stable first-frame output under local and system reduced motion with either CSS import order. This is synthetic renderer evidence, not native desktop or user visual acceptance.
