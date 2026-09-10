/**
 * Tiny hand-drawn vector glyphs for each prize shape. Chunky outlines, flat
 * fills, arcade palette — deliberately NOT photoreal so it reads as a made
 * thing, not "AI slop". Used on the canvas pile, the claw, and the shelf.
 */

import type { Prize } from "./prizes.ts";

type C = CanvasRenderingContext2D;

function base(ctx: C, x: number, y: number, s: number, color: string, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100); // author every glyph in a 100×100 box centred on 0,0
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(15,18,28,0.85)";
  ctx.fillStyle = color;
  draw();
  // A single small specular highlight, clipped to the glyph's own silhouette
  // (source-atop) so every prize reads as moulded plastic without per-shape work.
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.ellipse(-22, -26, 18, 11, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

function blob(ctx: C, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function circle(ctx: C, x: number, y: number, r: number, fill = true): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) ctx.fill();
  ctx.stroke();
}

function star(ctx: C, x: number, y: number, r: number, spikes = 5): void {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (i * Math.PI) / spikes - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

const DRAW: Record<Prize["shape"], (ctx: C, color: string) => void> = {
  bear(ctx, color) {
    // arms
    circle(ctx, -36, 20, 13);
    circle(ctx, 36, 20, 13);
    // ears
    circle(ctx, -26, -30, 15);
    circle(ctx, 26, -30, 15);
    // head
    circle(ctx, 0, 4, 40);
    // snout
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    circle(ctx, 0, 16, 16);
    ctx.fillStyle = color;
    // inner ears
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    circle(ctx, -26, -30, 6, true);
    circle(ctx, 26, -30, 6, true);
    // face
    ctx.fillStyle = "rgba(15,18,28,0.85)";
    circle(ctx, -14, -2, 4.5);
    circle(ctx, 14, -2, 4.5);
    circle(ctx, 0, 12, 5);
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(0, 22);
    ctx.stroke();
  },
  star(ctx) {
    star(ctx, 0, 0, 46);
  },
  ghost(ctx) {
    ctx.beginPath();
    ctx.arc(0, -6, 38, Math.PI, 0);
    ctx.lineTo(38, 40);
    for (let i = 0; i < 4; i++) ctx.lineTo(38 - (i + 0.5) * 19, i % 2 ? 26 : 44);
    ctx.lineTo(-38, 40);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // rosy cheeks
    ctx.fillStyle = "rgba(255,120,150,0.5)";
    circle(ctx, -22, 4, 6, true);
    circle(ctx, 22, 4, 6, true);
    ctx.fillStyle = "rgba(15,18,28,0.85)";
    circle(ctx, -12, -8, 5);
    circle(ctx, 14, -8, 5);
  },
  heart(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, 38);
    ctx.bezierCurveTo(-52, 2, -30, -40, 0, -14);
    ctx.bezierCurveTo(30, -40, 52, 2, 0, 38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  },
  duck(ctx, color) {
    ctx.save();
    circle(ctx, -6, 8, 34); // body
    circle(ctx, 22, -20, 18); // head
    // wing
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(-12, 12, 20, 14, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f7b733";
    blob(ctx, [
      [34, -22],
      [58, -16],
      [34, -10],
    ]);
    ctx.fillStyle = "rgba(15,18,28,0.85)";
    circle(ctx, 25, -24, 4);
    ctx.restore();
    void color;
  },
  robot(ctx) {
    ctx.beginPath();
    ctx.rect(-34, -34, 68, 62);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(0, -50);
    ctx.stroke();
    circle(ctx, 0, -54, 6);
    ctx.fillStyle = "rgba(15,18,28,0.85)";
    circle(ctx, -13, -8, 6);
    circle(ctx, 13, -8, 6);
    ctx.beginPath();
    ctx.rect(-16, 10, 32, 8);
    ctx.fill();
  },
  cassette(ctx) {
    ctx.beginPath();
    ctx.rect(-42, -28, 84, 56);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(15,18,28,0.8)";
    circle(ctx, -16, 0, 10);
    circle(ctx, 16, 0, 10);
    ctx.beginPath();
    ctx.rect(-26, 16, 52, 8);
    ctx.fill();
  },
  cam(ctx) {
    ctx.beginPath();
    ctx.rect(-38, -24, 76, 48);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0f121c";
    circle(ctx, 0, 0, 15);
    ctx.fillStyle = "#7fd4ff";
    circle(ctx, 0, 0, 7);
    ctx.fillStyle = "rgba(15,18,28,0.85)";
    circle(ctx, 26, -14, 4);
  },
  controller(ctx) {
    ctx.beginPath();
    ctx.moveTo(-46, -6);
    ctx.quadraticCurveTo(-52, 30, -20, 26);
    ctx.lineTo(20, 26);
    ctx.quadraticCurveTo(52, 30, 46, -6);
    ctx.quadraticCurveTo(38, -28, 0, -22);
    ctx.quadraticCurveTo(-38, -28, -46, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(15,18,28,0.85)";
    ctx.beginPath();
    ctx.rect(-30, -2, 18, 6);
    ctx.rect(-24, -8, 6, 18);
    ctx.fill();
    circle(ctx, 20, -2, 5);
    circle(ctx, 32, 6, 5);
  },
  chip(ctx) {
    ctx.beginPath();
    ctx.rect(-30, -30, 60, 60);
    ctx.fill();
    ctx.stroke();
    for (let i = -18; i <= 18; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, -30);
      ctx.lineTo(i, -42);
      ctx.moveTo(i, 30);
      ctx.lineTo(i, 42);
      ctx.moveTo(-30, i);
      ctx.lineTo(-42, i);
      ctx.moveTo(30, i);
      ctx.lineTo(42, i);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(15,18,28,0.7)";
    ctx.beginPath();
    ctx.rect(-12, -12, 24, 24);
    ctx.fill();
  },
  gem(ctx) {
    blob(ctx, [
      [0, -44],
      [40, -14],
      [22, 44],
      [-22, 44],
      [-40, -14],
    ]);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.moveTo(-40, -14);
    ctx.lineTo(40, -14);
    ctx.moveTo(0, -44);
    ctx.lineTo(0, 44);
    ctx.stroke();
  },
  crown(ctx) {
    blob(ctx, [
      [-44, 28],
      [-44, -18],
      [-22, 4],
      [0, -30],
      [22, 4],
      [44, -18],
      [44, 28],
    ]);
    ctx.fillStyle = "#ff5470";
    circle(ctx, 0, 12, 6);
  },
  trophy(ctx) {
    ctx.beginPath();
    ctx.moveTo(-26, -34);
    ctx.lineTo(26, -34);
    ctx.lineTo(22, -6);
    ctx.quadraticCurveTo(0, 14, -22, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-26, -24, 12, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(26, -24, 12, Math.PI * 1.5, Math.PI * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, 26);
    ctx.moveTo(-18, 30);
    ctx.lineTo(18, 30);
    ctx.lineWidth = 10;
    ctx.stroke();
  },
  coinbag(ctx) {
    ctx.beginPath();
    ctx.moveTo(-10, -30);
    ctx.lineTo(10, -30);
    ctx.quadraticCurveTo(44, 8, 30, 34);
    ctx.lineTo(-30, 34);
    ctx.quadraticCurveTo(-44, 8, -10, -30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(15,18,28,0.8)";
    ctx.font = "bold 34px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", 0, 8);
  },
  diamond(ctx) {
    blob(ctx, [
      [0, -42],
      [44, 0],
      [0, 46],
      [-44, 0],
    ]);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.moveTo(-44, 0);
    ctx.lineTo(44, 0);
    ctx.moveTo(-22, -21);
    ctx.lineTo(-14, 0);
    ctx.lineTo(-22, 23);
    ctx.moveTo(22, -21);
    ctx.lineTo(14, 0);
    ctx.lineTo(22, 23);
    ctx.stroke();
  },
};

export function drawPrize(ctx: C, prize: Prize, x: number, y: number, size: number): void {
  base(ctx, x, y, size, prize.color, () => DRAW[prize.shape](ctx, prize.color));
}

export function drawShape(ctx: C, shape: Prize["shape"], color: string, x: number, y: number, size: number): void {
  base(ctx, x, y, size, color, () => DRAW[shape](ctx, color));
}
