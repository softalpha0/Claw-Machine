/**
 * The claw machine itself: canvas rendering + the reveal animation.
 *
 * Always running a rAF loop for the idle bob + particles. `play(outcome)` builds
 * a Timeline of phases for that specific result and resolves when the payout has
 * been shown on screen. Beat callbacks drive SFX + HUD text from main.ts.
 */

import { MODES, type ModeId } from "./config.ts";
import { PRIZES_BY_MODE, PRIZE_BY_KEY, RARITY_COLOR, type Prize } from "./prizes.ts";
import { drawPrize } from "./prizeArt.ts";
import type { Outcome } from "./outcome.ts";
import { Timeline, lerp, easeInOut, easeOut, easeIn, bounceOut, clamp01 } from "./anim.ts";

export type Beat =
  | "aim" | "descend" | "grab" | "lift" | "carry"
  | "whiff" | "slip" | "drop" | "win" | "bonus" | "settle";

interface PileItem {
  prize: Prize;
  x: number; y: number; rot: number; scale: number;
  vx: number; vy: number; vr: number;
  grabbed: boolean;
  squashT: number;  // 0..1, decays after a landing impact -> a brief squish
  wigPhase: number; // per-item phase offset for the idle micro-wiggle
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  kind: "coin" | "confetti" | "spark" | "sweat";
  color: string; rot: number; vr: number; size: number;
}

// virtual design space; everything scales to fit the canvas
const W = 720;
const H = 432;
const RAIL_Y = 92;
const PARK_X = 178;
const CHUTE_X = 610;
const PILE_Y = 322;

export class ClawMachine {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private raf = 0;
  private last = 0;

  private mode: ModeId = "plush";
  private pile: PileItem[] = [];
  private particles: Particle[] = [];

  // animated state
  private carriageX = PARK_X;
  private clawY = RAIL_Y;
  private sway = 0;           // idle pendulum angle (rad)
  private prong = 0;          // 0 open .. 1 closed
  private clawSquash = 0;     // 0..1, decays after the grab impact -> a brief squish
  private zoom = 1;
  private shake = 0;
  private held: PileItem[] = [];
  private targetIdx = 0;
  private aimGlow = 0;
  private flash = 0;
  private banner: { text: string; color: string; life: number } | null = null;
  private idleT = 0;
  private busy = false;

  onBeat: (b: Beat, o: Outcome) => void = () => {};

  // photographed/AI-generated backdrop behind the pile; falls back to the flat
  // gradient below until it loads (or forever, if it fails to)
  private backdrop = new Image();
  private backdropReady = false;

  constructor(private canvas: HTMLCanvasElement) {
    const c = canvas.getContext("2d");
    if (!c) throw new Error("no 2d context");
    this.ctx = c;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.setMode("plush");
    this.backdrop.onload = () => (this.backdropReady = true);
    this.backdrop.src = new URL("images/cabinet-backdrop.jpg", document.baseURI).href;
    this.loop(performance.now());
  }

  setMode(mode: ModeId): void {
    if (this.busy) return;
    this.mode = mode;
    this.rebuildPile();
  }

  get isBusy(): boolean {
    return this.busy;
  }

  private rebuildPile(): void {
    const pool = PRIZES_BY_MODE[this.mode];
    // Fixed, hand-placed layout so the pile reads as a stable pile, not noise.
    // Kept clear of the prize chute on the right (x < ~540) and the frame edges.
    const P = PILE_Y;
    const slots: [number, number][] = [
      // front row
      [150, P + 8], [226, P + 14], [302, P + 6], [378, P + 16], [452, P + 4], [520, P + 12],
      // mid row
      [188, P - 26], [270, P - 20], [352, P - 28], [434, P - 18], [512, P - 24],
      // back row
      [246, P - 58], [332, P - 64], [416, P - 56],
    ];
    this.pile = slots.map(([x, y], i) => {
      const prize = pool[i % pool.length]!;
      return {
        prize, x, y,
        rot: (i * 37) % 40 / 100 - 0.2,
        scale: 1,
        vx: 0, vy: 0, vr: 0,
        grabbed: false,
        squashT: 0,
        wigPhase: (i * 2.31) % (Math.PI * 2),
      };
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  // ---- main loop -----------------------------------------------------------
  private tl: Timeline | null = null;

  private loop = (now: number) => {
    // Use near-raw wall-clock dt so the reveal keeps real-time pacing even at a
    // low frame rate (choppy, not slow-motion). The 0.5s cap only guards against
    // a pathological gap; genuine multi-second stalls are handled by the
    // watchdog + visibilitychange forceFinish.
    const dt = Math.min(0.5, (now - this.last) / 1000 || 0);
    this.last = now;
    this.idleT += dt;

    // Attract mode: when nothing is running, the claw lazily trawls the rail
    // with a lagging pendulum sway and a slow prong "breath".
    if (!this.busy) {
      const amp = (W / 2 - PARK_X) * 0.92;
      const targetX = W / 2 + Math.sin(this.idleT * 0.42) * amp;
      this.carriageX += (targetX - this.carriageX) * Math.min(1, dt * 2.4);
      const vel = Math.cos(this.idleT * 0.42) * amp * 0.42;
      this.sway += (-vel * 0.0011 - this.sway) * Math.min(1, dt * 2.6);
      this.clawY = RAIL_Y + Math.sin(this.idleT * 1.1) * 1.5;
      this.prong = 0.1 + Math.sin(this.idleT * 0.8) * 0.03;
    } else {
      this.sway += (0 - this.sway) * Math.min(1, dt * 6);
    }

    this.tl?.tick(dt);
    this.updateParticles(dt);
    this.updatePilePhysics(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    if (this.clawSquash > 0) this.clawSquash = Math.max(0, this.clawSquash - dt * 6);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.aimGlow > 0 && (!this.tl || !this.tl.running)) this.aimGlow = Math.max(0, this.aimGlow - dt * 2);
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  // ---- the reveal --------------------------------------------------------
  play(o: Outcome): Promise<void> {
    this.busy = true;
    this.held = [];
    this.prong = 0;
    this.zoom = 1;
    this.banner = null;

    // choose a target in the pile: matching the won prize if any, else a middle one
    const wantKey = o.prizeKey;
    let ti = this.pile.findIndex((p) => p.prize.key === wantKey);
    if (ti < 0) ti = 3 + (Math.floor(this.idleT * 7) % 6);
    this.targetIdx = ti;
    const target = this.pile[ti]!;
    const targetX = clamp01((target.x - 60) / (W - 120)) * (W - 120) + 60;
    const startX = this.carriageX;

    const tl = new Timeline();

    tl.add({
      name: "aim", dur: 0.75,
      onEnter: () => { this.onBeat("aim", o); this.aimGlow = 1; },
      update: (t) => { this.carriageX = lerp(startX, targetX, easeInOut(t)); },
    });
    tl.add({
      name: "descend", dur: 0.62,
      onEnter: () => this.onBeat("descend", o),
      update: (t) => {
        this.clawY = lerp(RAIL_Y, PILE_Y - 34, easeInOut(t));
        this.zoom = lerp(1, 1.045, easeOut(t));
        this.prong = 0.15 * t;
      },
    });
    tl.add({
      name: "grab", dur: 0.34,
      onEnter: () => { this.onBeat("grab", o); },
      update: (t) => {
        this.prong = lerp(0.15, 1, easeOut(t));
        if (t > 0.6 && this.shake < 3) { this.shake = 4; this.clawSquash = 1; }
      },
      onExit: () => {
        if (o.kind !== "whiff") {
          target.grabbed = true;
          this.held = [target];
          if (o.kind === "bonus") {
            // a second prize stuck to the first
            const extra = this.pile[(this.targetIdx + 1) % this.pile.length]!;
            extra.grabbed = true;
            this.held.push(extra);
          }
        }
      },
    });

    if (o.kind === "whiff") {
      tl.add({
        name: "whiff", dur: 0.66,
        onEnter: () => this.onBeat("whiff", o),
        update: (t) => {
          this.clawY = lerp(PILE_Y - 34, RAIL_Y, easeInOut(t));
          this.zoom = lerp(1.045, 1, t);
        },
      });
      tl.add(this.parkPhase(o));
    } else if (o.kind === "slip") {
      tl.add({
        name: "lift", dur: 0.5,
        onEnter: () => this.onBeat("lift", o),
        update: (t) => {
          this.clawY = lerp(PILE_Y - 34, lerp(PILE_Y - 34, RAIL_Y, 0.45), easeOut(t));
          this.zoom = lerp(1.045, 1.03, t);
        },
      });
      tl.add({
        name: "slip", dur: 0.6,
        onEnter: () => { this.onBeat("slip", o); this.spawnSweat(); },
        update: (t) => {
          this.prong = lerp(1, 0.4, easeOut(clamp01(t * 2)));
          if (t > 0.12 && this.held.length) {
            // let go: prizes fall back into the pile with a bounce
            for (const h of this.held) {
              h.grabbed = false;
              if (h.vy === 0) h.vy = 40;
            }
            this.held = [];
          }
        },
      });
      tl.add({
        name: "up", dur: 0.4,
        update: (t) => { this.clawY = lerp(this.clawY, RAIL_Y, easeInOut(t)); this.zoom = lerp(this.zoom, 1, t); },
      });
      tl.add(this.parkPhase(o));
    } else {
      // grab or bonus
      tl.add({
        name: "lift", dur: 0.6,
        onEnter: () => this.onBeat("lift", o),
        update: (t) => {
          this.clawY = lerp(PILE_Y - 34, RAIL_Y, easeInOut(t));
          this.zoom = lerp(1.045, 1, t);
        },
      });
      tl.add({
        name: "carry", dur: 0.85,
        onEnter: () => this.onBeat("carry", o),
        update: (t) => { this.carriageX = lerp(targetX, CHUTE_X, easeInOut(t)); },
      });
      tl.add({
        name: "drop", dur: 0.42,
        onEnter: () => { this.onBeat("drop", o); this.shake = 3; },
        update: (t) => {
          this.prong = lerp(1, 0, easeOut(t));
          for (const h of this.held) {
            h.x = CHUTE_X;
            h.y = lerp(this.clawY + 46, PILE_Y + 40, easeIn(t));
            h.scale = lerp(1, 0.2, t);
          }
        },
        onExit: () => { for (const h of this.held) h.scale = 0; },
      });
      tl.add({
        name: o.kind === "bonus" ? "bonus" : "win",
        dur: o.kind === "bonus" ? 1.7 : 1.15,
        onEnter: () => {
          this.onBeat(o.kind === "bonus" ? "bonus" : "win", o);
          this.flash = o.kind === "bonus" ? 1 : 0.6;
          this.shake = o.kind === "bonus" ? 7 : 3;
          this.zoom = 1.06;
          this.spawnWin(o);
          const won = o.prizeKey ? PRIZE_BY_KEY[o.prizeKey] : undefined;
          this.banner = o.kind === "bonus"
            ? { text: "DOUBLE GRAB!", color: "#fbbf24", life: 1.7 }
            : { text: won ? `GOT: ${won.name.toUpperCase()}` : "PRIZE SECURED", color: "#4ade80", life: 1.15 };
        },
        update: (t) => { this.zoom = lerp(1.06, 1, easeOut(t)); },
      });
      tl.add(this.parkPhase(o));
    }

    this.tl = tl;

    // Watchdog: if the rAF clock stalls (tab hidden) the timeline would never
    // advance and the game would soft-lock. Force it to completion instead.
    const budgetMs = 8000;
    const watchdog = window.setTimeout(() => {
      if (tl.running) tl.forceFinish();
    }, budgetMs);
    const onHide = () => {
      if (document.hidden && tl.running) tl.forceFinish();
    };
    document.addEventListener("visibilitychange", onHide);

    return tl.start().then(() => {
      window.clearTimeout(watchdog);
      document.removeEventListener("visibilitychange", onHide);
      this.busy = false;
      this.tl = null;
      this.onBeat("settle", o);
      this.rebuildPile();
    });
  }

  private parkPhase(o: Outcome): import("./anim.ts").Phase {
    const fromX = () => this.carriageX;
    let sx = 0;
    return {
      name: "park", dur: 0.6,
      onEnter: () => { sx = fromX(); },
      update: (t) => {
        this.carriageX = lerp(sx, PARK_X, easeInOut(t));
        this.clawY = lerp(this.clawY, RAIL_Y, easeInOut(t));
        this.prong = lerp(this.prong, 0, t);
      },
      onExit: () => void o,
    };
  }

  // ---- particles -------------------------------------------------------
  private spawnWin(o: Outcome): void {
    const n = Math.min(60, 12 + Math.round(o.payoutX * 5));
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: CHUTE_X + (Math.random() - 0.5) * 40,
        y: PILE_Y + 20,
        vx: (Math.random() - 0.5) * 320,
        vy: -260 - Math.random() * 320,
        life: 0, maxLife: 1 + Math.random() * 0.8,
        kind: "coin", color: "#ffd24a",
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, size: 9 + Math.random() * 5,
      });
    }
    if (o.kind === "bonus") {
      for (let i = 0; i < 80; i++) {
        this.particles.push({
          x: Math.random() * W, y: -20,
          vx: (Math.random() - 0.5) * 120, vy: 120 + Math.random() * 200,
          life: 0, maxLife: 2.2,
          kind: "confetti",
          color: ["#ff5a8a", "#22d3ee", "#fbbf24", "#4ade80", "#a78bfa"][i % 5]!,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16, size: 7 + Math.random() * 6,
        });
      }
    }
    const won = o.prizeKey ? PRIZE_BY_KEY[o.prizeKey] : undefined;
    if (won && (won.rarity === "rare" || won.rarity === "chase")) {
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        this.particles.push({
          x: CHUTE_X, y: PILE_Y - 10,
          vx: Math.cos(a) * 180, vy: Math.sin(a) * 180 - 40,
          life: 0, maxLife: 0.9,
          kind: "spark", color: RARITY_COLOR[won.rarity],
          rot: 0, vr: 0, size: 4 + Math.random() * 3,
        });
      }
    }
  }

  private spawnSweat(): void {
    for (let i = 0; i < 4; i++) {
      this.particles.push({
        x: this.carriageX + (Math.random() - 0.5) * 30,
        y: this.clawY + 30,
        vx: (Math.random() - 0.5) * 40, vy: -120 - Math.random() * 60,
        life: 0, maxLife: 0.7, kind: "sweat", color: "#7fd4ff",
        rot: 0, vr: 0, size: 5,
      });
    }
  }

  private updateParticles(dt: number): void {
    const g = 900;
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      p.vy += g * dt * (p.kind === "confetti" ? 0.25 : p.kind === "sweat" ? 0.5 : 1);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === "coin" && p.y > PILE_Y + 30 && p.vy > 0) {
        p.vy *= -0.35;
        p.vx *= 0.6;
      }
      return p.life < p.maxLife;
    });
  }

  private updatePilePhysics(dt: number): void {
    for (const it of this.pile) {
      if (it.grabbed || it.scale === 0) continue;
      if (it.squashT > 0) it.squashT = Math.max(0, it.squashT - dt * 4.5);
      if (it.vy !== 0 || it.vx !== 0 || it.vr !== 0) {
        it.vy += 1400 * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.rot += it.vr * dt;
        const rest = PILE_Y + 8;
        if (it.y >= rest) {
          const impact = Math.abs(it.vy);
          it.y = rest;
          it.vy *= -0.28;
          it.vx *= 0.5;
          it.vr *= 0.5;
          if (impact > 50) it.squashT = Math.min(1, impact / 260);
          if (Math.abs(it.vy) < 12) { it.vy = 0; it.vx = 0; it.vr = 0; }
        }
      }
    }
  }

  // ---- rendering ------------------------------------------------------
  private render(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, cw, ch);

    // fit virtual WxH into canvas, letterboxed
    const scale = Math.min(cw / W, ch / H);
    const ox = (cw - W * scale) / 2;
    const oy = (ch - H * scale) / 2;
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // camera zoom about the claw + shake
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-W / 2, -H / 2);

    const accent = MODES[this.mode].accent;

    this.drawCabinetBack(ctx, accent);
    this.drawPile(ctx);
    this.drawChute(ctx);
    this.drawRig(ctx, accent);
    this.drawParticles(ctx);
    this.drawGlass(ctx);
    this.drawCabinetFront(ctx, accent);
    this.drawBanner(ctx);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  private drawCabinetBack(ctx: CanvasRenderingContext2D, accent: string): void {
    const boxX = 28, boxY = 60, boxW = W - 56, boxH = H - 96;

    if (this.backdropReady) {
      // cover-fit the backdrop photo into the interior, clipped to it
      ctx.save();
      ctx.beginPath();
      ctx.rect(boxX, boxY, boxW, boxH);
      ctx.clip();
      const iw = this.backdrop.naturalWidth, ih = this.backdrop.naturalHeight;
      const scale = Math.max(boxW / iw, boxH / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(this.backdrop, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      const grd = ctx.createLinearGradient(0, 60, 0, H);
      grd.addColorStop(0, "#141a2b");
      grd.addColorStop(1, "#0c1020");
      ctx.fillStyle = grd;
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }

    // a consistent dark wash over the photo (or the fallback gradient) so the
    // pile/claw/HUD keep their contrast no matter what the backdrop looks like
    const wash = ctx.createLinearGradient(0, boxY, 0, H);
    wash.addColorStop(0, "rgba(10,13,24,0.55)");
    wash.addColorStop(1, "rgba(8,10,18,0.82)");
    ctx.fillStyle = wash;
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // back-wall glow
    const g2 = ctx.createRadialGradient(W / 2, 170, 20, W / 2, 185, 260);
    g2.addColorStop(0, this.hexA(accent, 0.22));
    g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(28, 60, W - 56, H - 96);

    // drifting bokeh — distant arcade lights, so the empty air over the pile
    // never reads as flat/dead. Clipped to the interior so it never bleeds
    // past the frame.
    ctx.save();
    ctx.beginPath();
    ctx.rect(28, 60, W - 56, H - 96);
    ctx.clip();
    const bokehColors = [accent, "#ff8fb3", "#7fe3d0", "#ffd24a"];
    for (let i = 0; i < 7; i++) {
      const speed = 0.06 + (i % 3) * 0.03;
      const phase = i * 1.7;
      const bx = W / 2 + Math.sin(this.idleT * speed + phase) * (200 + i * 12);
      const by = 130 + Math.cos(this.idleT * speed * 0.8 + phase) * 55 + (i % 2) * 40;
      const r = 26 + (i % 3) * 10;
      const pulse = 0.5 + 0.5 * Math.sin(this.idleT * 0.3 + phase);
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      bg.addColorStop(0, this.hexA(bokehColors[i % bokehColors.length]!, 0.1 + pulse * 0.06));
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // rail + end posts
    ctx.strokeStyle = "#3c476b";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(58, RAIL_Y);
    ctx.lineTo(W - 58, RAIL_Y);
    ctx.stroke();
    ctx.fillStyle = "#2b3350";
    ctx.fillRect(50, RAIL_Y - 12, 12, 24);
    ctx.fillRect(W - 62, RAIL_Y - 12, 12, 24);

    // aim spotlight
    if (this.aimGlow > 0) {
      ctx.save();
      ctx.globalAlpha = this.aimGlow * 0.5;
      const gg = ctx.createLinearGradient(0, RAIL_Y, 0, PILE_Y);
      gg.addColorStop(0, this.hexA(accent, 0.5));
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(this.carriageX - 10, RAIL_Y);
      ctx.lineTo(this.carriageX + 10, RAIL_Y);
      ctx.lineTo(this.carriageX + 70, PILE_Y);
      ctx.lineTo(this.carriageX - 70, PILE_Y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPile(ctx: CanvasRenderingContext2D): void {
    // shadow strip
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(W / 2, PILE_Y + 40, W / 2 - 70, 34, 0, 0, Math.PI * 2);
    ctx.fill();

    const ordered = [...this.pile].sort((a, b) => a.y - b.y);
    for (const it of ordered) {
      if (it.grabbed || it.scale === 0) continue;
      const bob = Math.sin(this.idleT * 2 + it.x * 0.05) * 1.6;
      // a tiny idle wiggle so the pile never looks perfectly frozen
      const wiggle = Math.sin(this.idleT * 0.5 + it.wigPhase) * 0.03;
      ctx.save();
      ctx.translate(it.x, it.y + bob);
      ctx.rotate(it.rot + wiggle);
      // squash & stretch from a fresh landing, settling back to normal
      const sq = easeOut(it.squashT);
      ctx.scale(it.scale * (1 + sq * 0.22), it.scale * (1 - sq * 0.28));
      // contact shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, 30, 26, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      drawPrize(ctx, it.prize, 0, 0, 62);
      ctx.restore();
    }
  }

  private drawChute(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#0a0d18";
    ctx.strokeStyle = "#2b3350";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(CHUTE_X - 50, PILE_Y - 10, 100, 62, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(CHUTE_X - 44, PILE_Y - 4, 88, 9);
    ctx.fillStyle = "#8b93b5";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PRIZE", CHUTE_X, PILE_Y + 32);
  }

  private drawRig(ctx: CanvasRenderingContext2D, accent: string): void {
    const carX = this.carriageX;
    // the claw hangs from the carriage and lags it while trawling (idle sway)
    const x = carX + Math.sin(this.sway) * 74;
    const clawTilt = this.sway * 0.8;
    // carriage — rides the rail straight, at the carriage x
    ctx.fillStyle = "#3a4467";
    ctx.strokeStyle = "#1c2238";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(carX - 34, RAIL_Y - 16, 68, 26, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillRect(carX - 26, RAIL_Y - 11, 52, 5);

    // cable — from the carriage down to the (possibly swayed) claw
    ctx.strokeStyle = "#6b7599";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(carX, RAIL_Y + 8);
    ctx.lineTo(x, this.clawY - 14);
    ctx.stroke();

    // held prizes riding under the claw
    for (let i = 0; i < this.held.length; i++) {
      const h = this.held[i]!;
      h.x = x + (i === 1 ? 18 : 0);
      h.y = this.clawY + 40 + (i === 1 ? 20 : 0);
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(Math.sin(this.idleT * 8) * 0.06 + h.rot);
      drawPrize(ctx, h.prize, 0, 0, 60);
      ctx.restore();
    }

    // claw
    ctx.save();
    ctx.translate(x, this.clawY);
    ctx.rotate(clawTilt);
    // squash & stretch on the grab impact — wide and short for an instant, then settles
    const sq = easeOut(this.clawSquash);
    ctx.scale(1 + sq * 0.18, 1 - sq * 0.22);
    // hub
    ctx.fillStyle = "#c9d2f0";
    ctx.strokeStyle = "#1c2238";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-16, -16, 32, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 2, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#e6ebff";
    ctx.fill();
    ctx.stroke();
    // three prongs
    const spread = lerp(26, 6, this.prong);
    const tuck = lerp(0, 10, this.prong);
    for (const dir of [-1, 0, 1]) {
      ctx.save();
      ctx.translate(dir * 2, 4);
      ctx.rotate(dir * lerp(0.5, 0.12, this.prong));
      ctx.strokeStyle = "#c9d2f0";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(dir * spread, 20 - tuck, dir * (spread * 0.6), 38 - tuck);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const a = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === "coin") {
        ctx.fillStyle = p.color;
        ctx.strokeStyle = "#b8860b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * Math.abs(Math.cos(p.life * 12)) + 2, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === "confetti") {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else if (p.kind === "spark") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawGlass(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(60, 64);
    ctx.lineTo(220, 64);
    ctx.lineTo(120, H - 40);
    ctx.lineTo(40, H - 40);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawCabinetFront(ctx: CanvasRenderingContext2D, accent: string): void {
    // frame
    ctx.lineWidth = 22;
    ctx.strokeStyle = "#e9ecff";
    ctx.strokeRect(28 + 11, 60 + 11, W - 56 - 22, H - 96 - 22);
    ctx.lineWidth = 6;
    ctx.strokeStyle = this.hexA(accent, 0.9);
    ctx.strokeRect(28 + 2, 60 + 2, W - 56 - 4, H - 96 - 4);

    // marquee
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(W / 2 - 150, 12, 300, 46, 12);
    ctx.fill();
    ctx.fillStyle = "#0c1020";
    ctx.font = "800 26px 'Orbitron', 'Arial Black', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("C L A W", W / 2, 36);
    // bulbs — a chasing block of light runs the marquee, like a real cabinet
    const N = 14;
    const chase = (this.idleT * 5.5) % N;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const dist = Math.min((i - chase + N) % N, (chase - i + N) % N);
      const glow = Math.max(0, 1 - dist / 3.2);
      ctx.save();
      const cx = W / 2 - 150 + t * 300;
      if (glow > 0.05) {
        ctx.shadowColor = "#ffd24a";
        ctx.shadowBlur = 8 * glow;
      }
      ctx.fillStyle = glow > 0.05
        ? `rgba(255, ${Math.round(214 + glow * 30)}, ${Math.round(140 + glow * 110)}, 1)`
        : "rgba(255,246,207,0.3)";
      ctx.beginPath();
      ctx.arc(cx, 8, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawBanner(ctx: CanvasRenderingContext2D): void {
    if (!this.banner) return;
    const b = this.banner;
    const p = clamp01(1 - b.life / (b.text === "DOUBLE GRAB!" ? 1.7 : 1.15));
    const pop = p < 0.2 ? bounceOut(p / 0.2) : 1;
    ctx.save();
    ctx.translate(W / 2, 150);
    ctx.scale(pop, pop);
    ctx.globalAlpha = b.life < 0.3 ? b.life / 0.3 : 1;
    ctx.font = "900 40px 'Orbitron', 'Arial Black', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#0c1020";
    ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, 0, 0);
    ctx.restore();
  }

  private hexA(hex: string, a: number): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
}
