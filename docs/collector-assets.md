# Collector artwork

Generated with the built-in ImageGen tool on 2026-09-23 for the approved collector-station redesign. The assets are full-body transparent game sprites, not screenshots or circular portraits.

## Files and layout

| File | Size | Layout |
| --- | --- | --- |
| `public/images/collector/plush-atlas.png` | 1983 × 793 RGBA | 5 columns × 2 rows |
| `public/images/collector/gadget-atlas.png` | 1983 × 793 RGBA | 5 columns × 2 rows |
| `public/images/collector/vault-atlas.png` | 1983 × 793 RGBA | 5 columns × 2 rows |

Every sheet follows the matching `PRIZES_BY_MODE` catalogue order, left to right across row one, then row two. All three files have genuine alpha transparency. Inspection measured fully transparent pixels at 45.5%, 53.3%, and 55.5% respectively. They contain no baked checkerboard.

The shared renderer `src/game/prizeSprites.ts` finds each sprite's alpha bounds, preserving proportions across the cabinet, held prizes and shelf. It checks the transparent gap close to the row division so the Bear King's crown is not clipped. Silhouettes reuse the same alpha mask. Existing vector art is only the load/error fallback. Source images remain unchanged.

## Generation provenance

Generation run: `01a0cdb5-1ef5-7e71-980f-211a873af6cd`. Source output identifiers are retained below; the production files are included in this repository.

- Plush source: `exec-e4c44651-3ad0-4db2-8cc1-bace40aaadc4.png`
- Gadget source: `exec-2d55068e-64b0-4102-8cb0-905c6bbfb9a1.png`
- Vault source: `exec-7bfebf9f-418e-4a3c-a07d-d1897c802148.png`

No external stock photographs were used for these new sprites. The selected mockup informed the soft material style; it was not used as an edit target. No audio was generated as part of this work.

## Final prompts

### plush

```text
Use case: stylized-concept. Asset type: production sprite atlas of 10 full-body collectible plush toys for a polished claw-machine browser game. Create ONE image: exactly 5 equal columns by 2 equal rows, landscape aspect ratio 5:2, genuinely transparent RGBA background. No drawn grid, NO checkerboard, no backdrop, no labels, no text, no floor shadows. Each object centered inside its cell, fully visible with at least 12% transparent padding, separate objects never overlap cell boundaries. Consistent almost-front product view, tactile stitched velvet/felt materials, soft top-left studio light, detailed individual paws/beaks/ears. Charming small real plush toys, no circular portraits/tokens. Clean silhouette and broad readable forms rather than fussy detail.
Exact order left to right:
TOP ROW: 1 warm brown seated BANDIT BEAR, complete teddy body with legs paws ears and dark brown tiny eye-mask detail; 2 golden yellow MELANCHOLY DUCK, entire plump body orange beak orange feet little wings slightly sad embroidered eyes; 3 pink SQUISH HEART cushion character, plump heart with small embroidered happy face and visible stitched edge; 4 snowy white LIL GHOSTY, full draped plush ghost body fluted bottom black oval embroidered eyes tiny smile; 5 pale warm yellow STAR BUDDY, complete five-pointed stuffed star with tiny happy embroidered face.
BOTTOM ROW: 6 caramel BROWN BEAR KING, complete seated teddy body tiny gold fabric crown; 7 smoky muted indigo VOID DUCK, full plump duck body charcoal beak orange eye dot subtle, not scary; 8 mint pale turquoise GLOWGHOST, full ghost plush with ruffled hem, tiny oval embroidered dark eyes; 9 vivid warm orange SUPERNOVA STAR, entire five-point stuffed star, golden yellow stitched edge and happy face; 10 golden-yellow SOLID GOLD BEAR, complete seated bear body with paws and ears, luxurious golden velvet not chrome.
All ten occupy similar perceived area, about 75% of their square cell. Give bears clear separate head and torso, paws and feet like well-designed collectible plush. This is a transparent usable game asset sheet, not a mockup or a shelf.
```

### gadget

```text
Use case: stylized-concept. Asset type: production transparent sprite atlas of 10 complete toy gadget collectibles for a polished arcade claw machine. ONE image, exactly 5 columns by 2 rows, landscape 5:2 ratio, actual transparent RGBA background. No checkerboard, no backdrop, no grid, no labels, no readable letters, no logos, no floor shadows. Every standalone object centered in its equal cell, entire silhouette visible, at least 12% padding all around, nothing crosses into another cell. Warm refined toy product render, softly bevelled chunky material, clean almost-front subtle three-quarter view, soft top-left illumination. Coherent set with pleasing small tactile plastic and metal details, no glows outside objects.
Exact order left to right:
TOP ROW: 1 dusty periwinkle-blue retro audio CASSETTE tape with pale pink blank label and two black reels; 2 pale silver POTATO CAM, a cute small round webcam on short integral stand, central black lens; 3 mint green MYSTERY CHIP, complete square circuit board with dark center chip and small golden pins; 4 powder blue BOOTLEG GAMEPAD with dark d-pad and pink buttons, complete game controller shape; 5 slate gray CAM PRO X, complete small compact photo camera with a substantial round lens and small top shutter button.
BOTTOM ROW: 6 translucent pale mint CLEAR CASSETTE, see-through cassette housing, two reels; 7 saturated cyan ELITE GAMEPAD, streamlined ergonomic full controller, dark joysticks and buttons; 8 emerald green OVERCLOCK CHIP, square circuit board with raised silver center heat-sink and gold pins; 9 lilac translucent GHOST CAM, complete compact camera with dark violet lens and pale lavender plastic shell; 10 GOLDEN GAMEPAD, luxurious gold metallic full ergonomic controller with dark inset buttons, elegant small highlights.
No rectangular backing cards. No crop. Objects about 75% cell width or height, all similar perceived scale. For the chip board silhouettes retain visible projecting pins so it is clearly a tangible gadget, not an icon. Usable game assets only.
```

### vault

```text
Use case: stylized-concept. Asset type: production transparent game sprite atlas, 10 tangible premium collectible prizes for an arcade claw machine. ONE image, exactly 5 equally sized columns by 2 rows, landscape aspect ratio 5:2, genuinely transparent RGBA background. NO checkerboard, no backdrop, no grid or labels, no letters or numbers, no floor shadows, no halo. All objects fully visible centered inside their individual cells with at least 12% clear padding, never overlap cells. Beautiful refined miniature toy-product 3D render with soft top-left studio lighting, almost-front subtle three-quarter view, clear simple silhouettes, polished gold and silver and richly colored faceted crystal, no exaggerated starburst sparkles.
Exact order left to right:
TOP ROW: 1 GOLD CHIP STACK, short stack of five gold casino chips with dark engraved rims, no symbols; 2 COIN SACK, warm honey-gold drawstring cloth pouch bulging with a few gold coins showing at its neck; 3 GEM SHARD, tall pale icy blue irregular faceted crystal shard standing as a complete object; 4 CUT RUBY, deep rose-red faceted round-cut jewel viewed three-quarter; 5 CUT EMERALD, rich green emerald-cut rectangular crystal gemstone viewed three-quarter.
BOTTOM ROW: 6 SILVER TROPHY, complete small silver cup trophy with two graceful handles stem and solid dark base; 7 TIN CROWN, complete polished pale gold crown with five clear points and small pink jewel center, softly rounded toy edges; 8 GOLD TROPHY, complete gleaming gold cup trophy with two handles stem dark burgundy base; 9 STAR SAPPHIRE, deep saturated royal blue diamond-shaped faceted jewel, sharp defined facets and broad clear silhouette; 10 THE HOPE ROCK, exceptionally beautiful large pale cyan diamond jewel, brilliant-cut crown and pointed lower pavilion both visible in a three-quarter front view.
All ten objects similar perceived scale, occupy approximately 75% of each cell; clean usable game assets, not a shelf, no surrounding scene.
```
