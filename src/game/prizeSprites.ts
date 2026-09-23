/// <reference types="vite/client" />

/**
 * Full-body collector art shared by the cabinet, held prizes, and prize shelf.
 * Each transparent atlas contains five columns and two rows in catalogue order.
 * The alpha bounds remove uneven sheet padding without stretching the artwork.
 */

import type { ModeId } from "./config.ts";
import { drawPrize } from "./prizeArt.ts";
import { PRIZES_BY_MODE, type Prize } from "./prizes.ts";

type Sprite = { image: HTMLCanvasElement; silhouette: HTMLCanvasElement };
const sprites = new Map<string, Sprite>();
const fallbacks = new Map<string, Sprite>();
let loading: Promise<void> | undefined;

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  return result;
}

function sprite(image: HTMLCanvasElement): Sprite {
  const silhouette = canvas(image.width, image.height);
  const ctx = silhouette.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#77708a";
  ctx.fillRect(0, 0, silhouette.width, silhouette.height);
  return { image, silhouette };
}

function prepareAtlas(mode: ModeId, atlas: HTMLImageElement): void {
  const sheet = canvas(atlas.naturalWidth, atlas.naturalHeight);
  const ctx = sheet.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(atlas, 0, 0);
  const { width, height } = sheet;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const alpha = (x: number, y: number) => pixels[(y * width + x) * 4 + 3] ?? 0;

  // Keep a crown or a tuft of fur crossing the nominal row boundary intact.
  // The sheet has two separate objects per column with a transparent gap.
  for (let column = 0; column < 5; column++) {
    const left = Math.round((column * width) / 5);
    const right = Math.round(((column + 1) * width) / 5);
    const middle = Math.round(height / 2);
    let split = middle;
    let lowestCoverage = Infinity;
    const searchRadius = Math.floor(height * 0.04);
    for (let y = middle - searchRadius; y <= middle + searchRadius; y++) {
      let coverage = 0;
      for (let x = left; x < right; x++) if (alpha(x, y) > 32) coverage++;
      const score = coverage + Math.abs(y - middle) / height;
      if (score < lowestCoverage) {
        lowestCoverage = score;
        split = y;
      }
    }

    for (let row = 0; row < 2; row++) {
      const prize = PRIZES_BY_MODE[mode][row * 5 + column];
      if (!prize) continue;
      const top = row === 0 ? 0 : split;
      const bottom = row === 0 ? split : height;
      let minX = right;
      let minY = bottom;
      let maxX = left - 1;
      let maxY = top - 1;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          if (alpha(x, y) <= 32) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (maxX < minX || maxY < minY) continue;
      minX = Math.max(left, minX - 3);
      minY = Math.max(top, minY - 3);
      maxX = Math.min(right - 1, maxX + 3);
      maxY = Math.min(bottom - 1, maxY + 3);
      const cropped = canvas(maxX - minX + 1, maxY - minY + 1);
      cropped.getContext("2d")!.drawImage(
        atlas, minX, minY, cropped.width, cropped.height,
        0, 0, cropped.width, cropped.height,
      );
      sprites.set(prize.key, sprite(cropped));
    }
  }
}

/** Resolves after all three sheets have loaded; an unavailable sheet uses vectors. */
export function preloadPrizeSprites(): Promise<void> {
  if (loading) return loading;
  loading = Promise.all((Object.keys(PRIZES_BY_MODE) as ModeId[]).map((mode) =>
    new Promise<void>((resolve) => {
      const atlas = new Image();
      atlas.onload = () => {
        try {
          prepareAtlas(mode, atlas);
        } catch {
          // Keep the existing vector fallback if the image cannot be sampled.
        }
        resolve();
      };
      atlas.onerror = () => resolve();
      atlas.src = `${import.meta.env.BASE_URL}images/collector/${mode}-atlas.png`;
    }),
  )).then(() => undefined);
  return loading;
}

/** Draw a centred prize, with its longest dimension equal to size. */
export function drawPrizeSprite(
  ctx: CanvasRenderingContext2D,
  prize: Prize,
  x: number,
  y: number,
  size: number,
  options: { silhouette?: boolean } = {},
): void {
  if (size <= 0) return;
  if (!loading) void preloadPrizeSprites();
  let selected = sprites.get(prize.key);
  if (!selected) {
    selected = fallbacks.get(prize.key);
    if (!selected) {
      const fallback = canvas(256, 256);
      drawPrize(fallback.getContext("2d")!, prize, 128, 128, 220);
      selected = sprite(fallback);
      fallbacks.set(prize.key, selected);
    }
  }
  const source = options.silhouette ? selected.silhouette : selected.image;
  const scale = size / Math.max(source.width, source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x - width / 2, y - height / 2, width, height);
  ctx.restore();
}
