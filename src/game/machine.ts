/** The glass interior and cosmetic reveal. Outcome math lives in outcome.ts. */
import { MODES, type ModeId } from "./config.ts";
import { PRIZES_BY_MODE, type Prize } from "./prizes.ts";
import { drawPrizeSprite } from "./prizeSprites.ts";
import { getWonPrizes, type Outcome } from "./outcome.ts";
import { Timeline, lerp, easeInOut, easeOut, easeIn, clamp01, type Phase } from "./anim.ts";

export type Beat =
  | "aim" | "descend" | "grab" | "lift" | "carry" | "park"
  | "whiff" | "slip" | "drop" | "win" | "bonus" | "settle";

type C = CanvasRenderingContext2D;
interface PileItem {
  prize: Prize;
  x: number; y: number; homeY: number; rot: number; size: number; scale: number;
  vy: number; grabbed: boolean; squash: number;
}
interface Particle {
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; color: string; rotation: number; spin: number; size: number;
}
interface ResultBanner { title: string; detail: string; amount: string; age: number; duration: number; bonus: boolean }

// HTML owns the cabinet, mode tabs and controls; the canvas is only its glass.
const W = 800, H = 500;
const RAIL_Y = 22, REST_Y = 102, PARK_X = 385, CHUTE_X = 716;
const PRONG_LENGTH = 69;

export class ClawMachine {
  private readonly ctx: C;
  private readonly resizeObserver: ResizeObserver;
  private readonly backdrop = new Image();
  private backdropReady = false;
  private raf = 0;
  private last = 0;
  private idleT = 0;
  private destroyed = false;
  private mode: ModeId = "plush";
  private pile: PileItem[] = [];
  private held: PileItem[] = [];
  private falling: PileItem[] = [];
  private particles: Particle[] = [];
  private carriageX = PARK_X;
  private clawY = REST_Y;
  private sway = 0;
  private prong = 0;
  private busy = false;
  private currentPhase = "idle";
  private banner: ResultBanner | null = null;
  private chuteGlow = 0;
  private tl: Timeline | null = null;
  private activePlay: Promise<void> | null = null;
  private suppressBeats = false;
  private watchdog = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  onBeat: (beat: Beat, outcome: Outcome) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.ctx = context;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.setMode("plush");
    this.backdrop.onload = () => { this.backdropReady = true; };
    this.backdrop.src = new URL("images/cabinet-backdrop.jpg", document.baseURI).href;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.loop);
  }

  get isBusy(): boolean { return this.busy; }
  /** Read-only presentation state, useful for accessibility and regression checks. */
  get phase(): string { return this.currentPhase; }
  get heldCount(): number { return this.held.length; }

  setMode(mode: ModeId): void {
    if (this.busy) return;
    this.mode = mode;
    this.resetRig();
    this.banner = null;
    this.particles = [];
    this.chuteGlow = 0;
    this.rebuildPile();
  }

  private resetRig(): void {
    this.held = [];
    this.falling = [];
    this.carriageX = PARK_X;
    this.clawY = REST_Y;
    this.prong = 0;
    this.sway = 0;
    this.currentPhase = "idle";
  }

  private rebuildPile(): void {
    const pool = PRIZES_BY_MODE[this.mode];
    // Actual full-body sprites, loosely nested in three rows. The front row
    // overlaps the back row so these feel like objects inside a cabinet.
    const slots: [number, number, number, number][] = [
      [79, 350, 129, -0.16], [190, 328, 137, 0.14], [300, 346, 145, -0.12],
      [417, 325, 133, 0.15], [526, 347, 139, -0.13], [632, 336, 129, 0.16], [742, 352, 125, -0.13],
      [23, 405, 141, -0.2], [131, 405, 154, 0.12], [248, 404, 152, -0.13],
      [373, 390, 157, 0.08], [493, 410, 144, -0.17], [597, 409, 144, 0.16], [746, 409, 137, -0.15],
      [38, 440, 155, 0.13], [163, 434, 166, -0.15], [285, 442, 156, 0.05],
      [409, 441, 156, -0.08], [532, 443, 159, 0.14], [626, 448, 146, -0.18],
    ];
    // The identity order is intentional: every collectible has a visible body.
    const order = [4, 5, 8, 1, 6, 9, 3, 6, 1, 0, 2, 5, 4, 7, 8, 0, 3, 2, 1, 5];
    this.pile = slots.map(([x, y, size, rot], i) => ({
      prize: pool[order[i]! % pool.length]!, x, y, homeY: y, size, rot,
      scale: 1, vy: 0, grabbed: false, squash: 0,
    }));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private onVisibility = (): void => {
    if (document.hidden) this.finishReveal();
    this.last = performance.now();
  };

  private finishReveal(): void {
    if (!this.tl?.running) return;
    // Finishing a hidden/stalled animation must not fire a burst of queued SFX.
    this.suppressBeats = true;
    this.tl.forceFinish();
    this.suppressBeats = false;
  }

  private emit(beat: Beat, outcome: Outcome): void {
    this.currentPhase = beat;
    if (!this.suppressBeats && !this.destroyed) this.onBeat(beat, outcome);
  }

  private loop = (now: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    this.idleT += dt;
    this.tl?.tick(dt);
    if (!this.busy) {
      // Real cabinets rest in place. Only the suspended cable gently settles.
      this.sway = this.reducedMotion ? 0 : Math.sin(this.idleT * 1.1) * 0.014;
    } else {
      this.sway *= Math.exp(-dt * 3.5);
    }
    this.positionHeld();
    this.updatePhysics(dt);
    this.chuteGlow = Math.max(0, this.chuteGlow - dt * 0.5);
    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.duration) this.banner = null;
    }
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    this.destroyed = true;
    this.finishReveal();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.watchdog);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.backdrop.onload = null;
  }

  play(outcome: Outcome): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.activePlay) return this.activePlay;
    if (this.mode !== outcome.mode) this.setMode(outcome.mode);
    this.busy = true;
    this.held = [];
    this.falling = [];
    this.banner = null;
    this.particles = [];
    this.prong = 0;

    const wonPrizes = getWonPrizes(outcome);
    const firstKey = wonPrizes[0]?.key;
    // Presentation only: no random calls or changes to payout calculations.
    const seedIndex = parseInt(outcome.seedHex.slice(-4), 16) || 0;
    let target = firstKey
      ? this.pile.find(item => item.prize.key === firstKey && item.x > 90 && item.x < 650)
      : undefined;
    target ??= this.pile[8 + seedIndex % 5]!;
    // Ensure rare prizes initially placed near the edge can still be retrieved.
    if (wonPrizes[0] && target.prize.key !== firstKey) target.prize = wonPrizes[0];
    const targetX = target.x;
    const grabY = Math.max(245, target.y - 65);
    const startX = this.carriageX;
    const startY = this.clawY;
    const tl = new Timeline();

    tl.add({ name: "aim", dur: 0.72,
      onEnter: () => this.emit("aim", outcome),
      update: t => {
        this.carriageX = lerp(startX, targetX, easeInOut(t));
        this.sway = Math.sin(t * Math.PI * 2) * 0.028;
      },
    });
    tl.add({ name: "descend", dur: 0.76,
      onEnter: () => this.emit("descend", outcome),
      update: t => { this.clawY = lerp(startY, grabY, easeInOut(t)); },
    });
    tl.add({ name: "grab", dur: 0.42,
      onEnter: () => this.emit("grab", outcome),
      update: t => { this.prong = easeInOut(t); },
      onExit: () => {
        if (outcome.kind === "whiff") return;
        target.grabbed = true;
        this.held = [target];
        if (outcome.kind === "bonus" && wonPrizes[1]) {
          const extra = this.pile.find(item => item !== target && item.prize.key === wonPrizes[1]!.key)
            ?? this.pile.find(item => item !== target && !item.grabbed)!;
          extra.prize = wonPrizes[1];
          extra.grabbed = true;
          this.held.push(extra);
        }
        this.positionHeld();
      },
    });

    if (outcome.kind === "whiff") {
      tl.add({ name: "whiff", dur: 0.68,
        onEnter: () => this.emit("whiff", outcome),
        update: t => {
          this.clawY = lerp(grabY, REST_Y, easeInOut(t));
          this.prong = lerp(1, 0.15, easeOut(t));
        },
      });
    } else if (outcome.kind === "slip") {
      const slipY = lerp(grabY, REST_Y, 0.52);
      tl.add({ name: "lift", dur: 0.5,
        onEnter: () => this.emit("lift", outcome),
        update: t => { this.clawY = lerp(grabY, slipY, easeInOut(t)); },
      });
      let released = false;
      tl.add({ name: "slip", dur: 0.48,
        onEnter: () => this.emit("slip", outcome),
        update: t => {
          this.prong = lerp(1, 0, easeOut(t));
          if (t >= 0.18 && !released) {
            released = true;
            this.positionHeld();
            for (const item of this.held) { item.grabbed = false; item.vy = 25; }
            this.held = [];
          }
        },
      });
      tl.add({ name: "lift", dur: 0.44,
        onEnter: () => this.emit("lift", outcome),
        update: t => { this.clawY = lerp(slipY, REST_Y, easeInOut(t)); },
      });
    } else {
      tl.add({ name: "lift", dur: 0.76,
        onEnter: () => this.emit("lift", outcome),
        update: t => { this.clawY = lerp(grabY, REST_Y, easeInOut(t)); },
      });
      tl.add({ name: "carry", dur: 0.9,
        onEnter: () => this.emit("carry", outcome),
        update: t => {
          this.carriageX = lerp(targetX, CHUTE_X, easeInOut(t));
          this.sway = -Math.sin(t * Math.PI * 2) * 0.045;
        },
      });
      let dropStarts: { x: number; y: number; scale: number; rot: number }[] = [];
      tl.add({ name: "drop", dur: 0.6,
        onEnter: () => {
          this.emit("drop", outcome);
          this.positionHeld();
          this.falling = [...this.held];
          this.held = [];
          dropStarts = this.falling.map(item => ({ x: item.x, y: item.y, scale: item.scale, rot: item.rot }));
        },
        update: t => {
          this.prong = lerp(1, 0, easeOut(Math.min(1, t * 2)));
          this.falling.forEach((item, i) => {
            const start = dropStarts[i]!;
            const progress = clamp01((t - i * 0.05) / (1 - i * 0.05));
            item.x = lerp(start.x, CHUTE_X, progress);
            item.y = lerp(start.y, 471, easeIn(progress));
            item.scale = lerp(start.scale, 0.24, easeIn(progress));
            item.rot = lerp(start.rot, start.rot + (i === 0 ? 0.15 : -0.2), progress);
          });
        },
        onExit: () => {
          for (const item of this.falling) item.scale = 0;
          this.falling = [];
          this.held = [];
          this.chuteGlow = 1;
        },
      });
      const bonus = outcome.kind === "bonus";
      tl.add({ name: bonus ? "bonus" : "win", dur: bonus ? 1.55 : 1.18,
        onEnter: () => {
          this.emit(bonus ? "bonus" : "win", outcome);
          this.banner = {
            title: bonus ? "DOUBLE GRAB" : "PRIZE SECURED",
            detail: wonPrizes.map(prize => prize.name).join(" + "),
            amount: `+${outcome.payout.toFixed(2)} chUSD`,
            age: 0, duration: bonus ? 1.9 : 1.55, bonus,
          };
          this.spawnCelebration(bonus);
        },
        update: () => {},
      });
    }
    tl.add(this.parkPhase(outcome));
    this.tl = tl;
    this.watchdog = window.setTimeout(() => this.finishReveal(), 10_000);
    this.activePlay = tl.start().then(() => {
      clearTimeout(this.watchdog);
      this.held = [];
      this.falling = [];
      this.busy = false;
      this.tl = null;
      this.activePlay = null;
      this.resetRig();
      this.rebuildPile();
      this.emit("settle", outcome);
      this.currentPhase = "idle";
    });
    return this.activePlay;
  }

  private parkPhase(outcome: Outcome): Phase {
    let fromX = 0, fromY = 0, fromProng = 0;
    return {
      name: "park", dur: 0.56,
      onEnter: () => {
        fromX = this.carriageX; fromY = this.clawY; fromProng = this.prong;
        this.emit("park", outcome);
      },
      update: t => {
        this.carriageX = lerp(fromX, PARK_X, easeInOut(t));
        this.clawY = lerp(fromY, REST_Y, easeInOut(t));
        this.prong = lerp(fromProng, 0, easeOut(t));
      },
    };
  }

  private positionHeld(): void {
    const x = this.carriageX + Math.sin(this.sway) * 48;
    this.held.forEach((item, i) => {
      const double = this.held.length > 1;
      item.x = x + (double ? (i === 0 ? -17 : 25) : 0);
      item.y = this.clawY + 57 + (i === 1 ? 29 : 0);
      item.scale = Math.min(1, (double ? 89 : 104) / item.size);
    });
  }

  private updatePhysics(dt: number): void {
    for (const item of this.pile) {
      item.squash = Math.max(0, item.squash - dt * 4);
      if (item.grabbed || item.vy === 0) continue;
      item.vy += 1500 * dt;
      item.y += item.vy * dt;
      item.scale = Math.min(1, item.scale + dt * 0.8);
      if (item.y >= item.homeY) {
        item.y = item.homeY;
        const impact = item.vy;
        item.vy *= -0.23;
        item.squash = Math.min(0.14, impact / 5000);
        if (Math.abs(item.vy) < 16) { item.vy = 0; item.scale = 1; }
      }
    }
    this.particles = this.particles.filter(p => {
      p.age += dt; p.vy += dt * 190;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rotation += p.spin * dt;
      return p.age < p.life;
    });
  }

  private spawnCelebration(bonus: boolean): void {
    if (this.reducedMotion) return;
    const count = bonus ? 45 : 23;
    for (let i = 0; i < count; i++) {
      const angle = (i * 2.39996) - Math.PI;
      const speed = 55 + i % 7 * 19;
      this.particles.push({
        x: W / 2, y: 190, vx: Math.cos(angle) * speed, vy: -70 + Math.sin(angle) * speed,
        age: 0, life: 0.8 + i % 5 * 0.16, color: ["#ffe4a1", "#ff7eb0", "#d8ceff"][i % 3]!,
        rotation: angle, spin: i % 2 ? 2.7 : -2.7, size: 2 + i % 4,
      });
    }
  }

  private render(): void {
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    // Cover the glass at all responsive ratios, retaining object proportions.
    const scale = Math.max(cw / W, ch / H);
    ctx.translate((cw - W * scale) / 2, (ch - H * scale) / 2);
    ctx.scale(scale, scale);
    this.drawInterior(ctx);
    this.drawPile(ctx);
    this.drawRig(ctx);
    for (const item of this.falling) this.drawItem(ctx, item);
    this.drawChute(ctx);
    this.drawGlass(ctx);
    this.drawParticles(ctx);
    this.drawBanner(ctx);
    ctx.restore();
  }

  private drawInterior(ctx: C): void {
    const accent = MODES[this.mode].accent;
    ctx.fillStyle = "#1c1728";
    ctx.fillRect(0, 0, W, H);
    if (this.backdropReady) {
      const scale = Math.max(W / this.backdrop.naturalWidth, H / this.backdrop.naturalHeight);
      const width = this.backdrop.naturalWidth * scale, height = this.backdrop.naturalHeight * scale;
      ctx.drawImage(this.backdrop, (W - width) / 2, (H - height) / 2, width, height);
    }
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, "rgba(19,14,31,.8)");
    shade.addColorStop(0.6, "rgba(28,20,39,.52)");
    shade.addColorStop(1, "rgba(10,9,18,.82)");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
    // Cabinet depth: roof and sidewalls lead to the rear glass, with reflected LEDs.
    ctx.fillStyle = "rgba(10,9,18,.48)";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W - 70, 67); ctx.lineTo(70, 67); ctx.closePath(); ctx.fill();
    for (const side of [-1, 1]) {
      ctx.save();
      if (side === 1) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      const wall = ctx.createLinearGradient(0, 0, 82, 0);
      wall.addColorStop(0, "rgba(11,10,23,.92)"); wall.addColorStop(1, "rgba(54,39,69,.35)");
      ctx.fillStyle = wall;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(73, 64); ctx.lineTo(73, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(197,170,215,.12)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(73, 65); ctx.lineTo(73, H); ctx.stroke();
      ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 22;
      ctx.strokeStyle = accent; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(8, 75); ctx.lineTo(64, 97); ctx.stroke();
      ctx.shadowBlur = 0; ctx.lineWidth = 1.5; ctx.strokeStyle = "#ffe9f6"; ctx.stroke(); ctx.restore();
      ctx.restore();
    }
    const floor = ctx.createLinearGradient(0, 365, 0, H);
    floor.addColorStop(0, "rgba(24,18,37,0)"); floor.addColorStop(1, "#171020");
    ctx.fillStyle = floor; ctx.fillRect(0, 340, W, 160);

    // A continuous milled rail with a subtle darker underside.
    const rail = ctx.createLinearGradient(0, 11, 0, 36);
    rail.addColorStop(0, "#c8c8db"); rail.addColorStop(0.16, "#565570");
    rail.addColorStop(0.34, "#c7c8d8"); rail.addColorStop(0.5, "#a3a4b9");
    rail.addColorStop(0.62, "#4a465e"); rail.addColorStop(1, "#292339");
    ctx.fillStyle = rail; ctx.fillRect(15, 11, W - 30, 24);
    ctx.fillStyle = "rgba(249,244,255,.5)"; ctx.fillRect(16, 12, W - 32, 1);
    ctx.fillStyle = "#0b0a12"; ctx.fillRect(16, 35, W - 32, 6);
    for (const x of [17, W - 32]) {
      const bracket = ctx.createLinearGradient(x, 0, x + 15, 0);
      bracket.addColorStop(0, "#6f6c82"); bracket.addColorStop(0.4, "#d1cfdf"); bracket.addColorStop(1, "#363047");
      ctx.fillStyle = bracket; ctx.fillRect(x, 4, 15, 44);
      this.screw(ctx, x + 7, 10, 3); this.screw(ctx, x + 7, 39, 3);
    }
  }

  private drawPile(ctx: C): void {
    for (const item of [...this.pile].sort((a, b) => a.y - b.y)) {
      if (!item.grabbed && item.scale > 0) this.drawItem(ctx, item);
    }
  }

  private drawItem(ctx: C, item: PileItem): void {
    if (item.scale <= 0) return;
    ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(item.rot);
    ctx.scale(item.scale * (1 + item.squash), item.scale * (1 - item.squash));
    ctx.shadowColor = "rgba(4,2,12,.35)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
    drawPrizeSprite(ctx, item.prize, 0, 0, item.size);
    ctx.restore();
  }

  private chrome(ctx: C, left: number, right: number): CanvasGradient {
    const g = ctx.createLinearGradient(left, 0, right, 0);
    g.addColorStop(0, "#39384d"); g.addColorStop(0.12, "#85879e");
    g.addColorStop(0.24, "#faf8ff"); g.addColorStop(0.36, "#aaaaba");
    g.addColorStop(0.51, "#66677c"); g.addColorStop(0.62, "#e9e8f2");
    g.addColorStop(0.78, "#fefaff"); g.addColorStop(0.87, "#868699"); g.addColorStop(1, "#343447");
    return g;
  }

  private drawRig(ctx: C): void {
    const x = this.carriageX + Math.sin(this.sway) * 48;
    // Coiled power lead lives beside the taut load-bearing cable.
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#070810"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(this.carriageX + 22, 42);
    ctx.bezierCurveTo(this.carriageX + 43, 49, x + 39, this.clawY - 21, x + 13, this.clawY - 27); ctx.stroke();
    ctx.strokeStyle = "#777489"; ctx.lineWidth = 1.2;
    const cableHeight = Math.max(15, this.clawY - 68);
    for (let i = 0; i < 16; i++) {
      const t = i / 15, cy = 43 + t * cableHeight;
      const cx = lerp(this.carriageX + 25, x + 19, t) + Math.sin(t * Math.PI) * 14;
      ctx.beginPath(); ctx.ellipse(cx, cy, 4.3, 1.9, 0.15, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = "#454253"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(this.carriageX, 42); ctx.lineTo(x, this.clawY - 29); ctx.stroke();
    ctx.strokeStyle = "#e2dce9"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(this.carriageX - 0.8, 42); ctx.lineTo(x - 0.8, this.clawY - 29); ctx.stroke();

    // Carriage: silver face, black rollers, recessed fastener.
    ctx.save(); ctx.translate(this.carriageX, RAIL_Y);
    ctx.fillStyle = "#161421"; ctx.fillRect(-30, -22, 60, 41);
    ctx.fillStyle = this.chrome(ctx, -28, 28); ctx.fillRect(-28, -21, 56, 38);
    ctx.fillStyle = "#373343"; ctx.fillRect(-17, -15, 34, 28);
    ctx.strokeStyle = "#9a96ab"; ctx.lineWidth = 1; ctx.strokeRect(-16.5, -14.5, 33, 27);
    this.screw(ctx, 0, -1, 6);
    ctx.fillStyle = "#1c182b"; ctx.fillRect(-29, 16, 58, 8);
    ctx.restore();

    ctx.save(); ctx.translate(x, this.clawY); ctx.rotate(this.sway * 0.7);
    // Rear tine passes behind the prize; all curved arms have a polished edge.
    this.drawProng(ctx, 0, true);
    ctx.restore();
    for (const item of this.held) this.drawItem(ctx, item);
    ctx.save(); ctx.translate(x, this.clawY); ctx.rotate(this.sway * 0.7);
    this.drawProng(ctx, -1, false); this.drawProng(ctx, 1, false);
    // Cylindrical hub and stacked rings.
    ctx.fillStyle = this.chrome(ctx, -18, 18);
    ctx.beginPath(); ctx.roundRect(-14, -33, 28, 29, 3); ctx.fill();
    ctx.fillStyle = this.chrome(ctx, -24, 24);
    ctx.beginPath(); ctx.roundRect(-22, -11, 44, 25, 5); ctx.fill();
    ctx.strokeStyle = "#242136"; ctx.lineWidth = 1.4; ctx.stroke();
    for (const y of [-28, -18, -5, 8]) {
      ctx.fillStyle = "rgba(255,249,255,.7)"; ctx.fillRect(y < -10 ? -14 : -21, y, y < -10 ? 28 : 42, 1.3);
      ctx.fillStyle = "rgba(14,13,27,.65)"; ctx.fillRect(y < -10 ? -14 : -21, y + 2, y < -10 ? 28 : 42, 2);
    }
    this.screw(ctx, -12, 1, 2); this.screw(ctx, 12, 1, 2);
    ctx.restore();
  }

  private drawProng(ctx: C, direction: number, back: boolean): void {
    const closed = this.prong;
    const startX = direction * 15;
    const spread = lerp(52, 33, closed);
    const tipX = direction * lerp(42, 12, closed);
    const path = new Path2D();
    path.moveTo(startX, 8);
    if (back) {
      path.bezierCurveTo(-4, 28, -3, 51, 0, lerp(64, 61, closed));
    } else {
      path.bezierCurveTo(direction * spread, 27, direction * (spread + 2), 46, tipX, PRONG_LENGTH);
    }
    ctx.strokeStyle = "#282434"; ctx.lineWidth = back ? 7 : 9; ctx.stroke(path);
    ctx.strokeStyle = this.chrome(ctx, -53, 53); ctx.lineWidth = back ? 4 : 6; ctx.stroke(path);
    ctx.save(); ctx.translate(-1, 0); ctx.strokeStyle = back ? "#b3adbf" : "#faf3ff"; ctx.lineWidth = 1.4; ctx.stroke(path); ctx.restore();
    if (!back) this.screw(ctx, startX, 10, 3.7);
  }

  private drawChute(ctx: C): void {
    const x = 646, y = 390, width = 150, height = 114;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 10; ctx.shadowOffsetX = -5;
    const rim = ctx.createLinearGradient(x, y, x + width, y + height);
    rim.addColorStop(0, "#d0cde5"); rim.addColorStop(0.13, "#9490ad");
    rim.addColorStop(0.4, "#393247"); rim.addColorStop(0.85, "#74718d"); rim.addColorStop(1, "#b0aac6");
    ctx.fillStyle = rim; ctx.beginPath(); ctx.roundRect(x, y, width, height, [17, 0, 0, 0]); ctx.fill(); ctx.restore();
    ctx.strokeStyle = "#c2badb"; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.fillStyle = "#181526"; ctx.beginPath(); ctx.roundRect(x + 10, y + 11, width - 20, height - 9, [9, 9, 0, 0]); ctx.fill();
    const slot = ctx.createLinearGradient(0, y + 18, 0, y + height);
    slot.addColorStop(0, "#08070f"); slot.addColorStop(0.5, "#12101d"); slot.addColorStop(1, "#252135");
    ctx.fillStyle = slot; ctx.fillRect(x + 17, y + 24, width - 34, height - 23);
    ctx.fillStyle = "#06070c"; ctx.fillRect(x + 17, y + 24, width - 34, 13);
    ctx.strokeStyle = "#39314c"; ctx.lineWidth = 1; ctx.strokeRect(x + 16, y + 23, width - 32, height - 22);
    if (this.chuteGlow > 0) {
      ctx.save(); ctx.globalAlpha = this.chuteGlow * 0.55;
      const glow = ctx.createRadialGradient(CHUTE_X, H, 0, CHUTE_X, H, 74);
      glow.addColorStop(0, MODES[this.mode].accent); glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow; ctx.fillRect(x + 17, y + 36, width - 34, height - 30); ctx.restore();
    }
    ctx.fillStyle = this.chuteGlow > 0.1 ? "#fbe2f0" : "#b2a9d2";
    ctx.font = "600 16px 'Space Grotesk', system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(this.chuteGlow > 0.1 ? "COLLECTED" : "PRIZE", CHUTE_X + 5, y + 75);
  }

  private screw(ctx: C, x: number, y: number, radius: number): void {
    ctx.fillStyle = "#383444"; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#bbb5ce"; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.strokeStyle = "#11101c"; ctx.lineWidth = Math.max(1, radius * 0.23);
    ctx.beginPath(); ctx.moveTo(x - radius * 0.45, y + radius * 0.35); ctx.lineTo(x + radius * 0.45, y - radius * 0.35); ctx.stroke();
  }

  private drawGlass(ctx: C): void {
    const sheen = ctx.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0, "rgba(219,196,255,.075)"); sheen.addColorStop(0.4, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(153,161,221,.03)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(243,231,255,.025)";
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(160, 0); ctx.lineTo(87, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(246,228,255,.13)"; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  private drawParticles(ctx: C): void {
    for (const p of this.particles) {
      ctx.save(); ctx.globalAlpha = Math.min(1, (p.life - p.age) * 2.5);
      ctx.translate(p.x, p.y); ctx.rotate(p.rotation); ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.65); ctx.restore();
    }
  }

  private drawBanner(ctx: C): void {
    if (!this.banner) return;
    const b = this.banner;
    const fade = Math.min(1, b.age / 0.12, (b.duration - b.age) / 0.25);
    ctx.save(); ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(W / 2, 190 + (this.reducedMotion ? 0 : (1 - easeOut(clamp01(b.age / 0.25))) * 12));
    const width = 376, height = 127;
    const fill = ctx.createLinearGradient(0, -height / 2, 0, height / 2);
    fill.addColorStop(0, "rgba(39,29,54,.97)"); fill.addColorStop(1, "rgba(17,13,31,.97)");
    ctx.fillStyle = fill; ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, 17); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = b.bonus ? "#e6bf71" : "#db82b1"; ctx.lineWidth = 1.7; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = b.bonus ? "#ffdf91" : "#ffb7d7";
    ctx.font = "700 20px 'Space Grotesk', system-ui, sans-serif"; ctx.fillText(b.title, 0, -35);
    ctx.fillStyle = "#fff6fc"; ctx.font = "700 30px 'Space Grotesk', system-ui, sans-serif"; ctx.fillText(b.amount, 0, 0);
    ctx.fillStyle = "#c7bdd6"; ctx.font = "500 15px 'Space Grotesk', system-ui, sans-serif";
    ctx.fillText(b.detail, 0, 35, width - 35);
    ctx.restore();
  }
}
