import { getWonPrizes, type Outcome } from "./outcome.ts";
import { drawPrizeSprite, preloadPrizeSprites } from "./prizeSprites.ts";
import "./rewardDisplay.css";

/** A persistent arcade payout plaque. The physical prize lands before this opens. */
export class RewardDisplay {
  private readonly panel = document.createElement("section");
  private readonly art: HTMLCanvasElement;
  private readonly title: HTMLElement;
  private readonly amount: HTMLElement;
  private readonly multiplier: HTMLElement;
  private readonly names: HTMLElement;
  private shownSeed: string | null = null;
  private dismissedSeed: string | null = null;

  constructor(host: HTMLElement) {
    this.panel.className = "reward-plaque";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Round payout");
    this.panel.innerHTML = `
      <div class="reward-rim">
        <div class="reward-topline"><span data-title>PRIZE SECURED</span><span class="reward-stars" aria-hidden="true">✦ ✦ ✦</span></div>
        <button class="reward-close" aria-label="Dismiss win display" type="button">×</button>
        <div class="reward-body">
          <div class="reward-showcase"><span class="reward-rays" aria-hidden="true"></span><canvas width="440" height="360" aria-hidden="true"></canvas></div>
          <div class="reward-value"><span class="reward-label">YOU WON</span><strong data-amount></strong><span class="reward-currency">chUSD</span><span class="reward-multiplier" data-multiplier></span></div>
        </div>
        <div class="reward-ticket"><span data-names></span><span class="reward-stamp" aria-hidden="true">CLAIMED <svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-9"/></svg></span></div>
      </div>`;
    this.art = this.panel.querySelector("canvas")!;
    this.title = this.panel.querySelector("[data-title]")!;
    this.amount = this.panel.querySelector("[data-amount]")!;
    this.multiplier = this.panel.querySelector("[data-multiplier]")!;
    this.names = this.panel.querySelector("[data-names]")!;
    this.panel.querySelector("button")!.addEventListener("click", () => {
      this.dismissedSeed = this.shownSeed;
      this.panel.hidden = true;
    });
    host.append(this.panel);
  }

  show(outcome: Outcome): void {
    if (
      (outcome.kind !== "grab" && outcome.kind !== "bonus") ||
      this.dismissedSeed === outcome.seedHex
    )
      return;
    if (this.shownSeed === outcome.seedHex) return;
    this.shownSeed = outcome.seedHex;
    const prizes = getWonPrizes(outcome),
      double = prizes.length === 2;
    this.panel.classList.toggle("reward-bonus", double);
    this.panel.classList.toggle("reward-large-amount", outcome.payout >= 1000);
    this.panel.dataset.mode = outcome.mode;
    this.title.textContent = double ? "DOUBLE GRAB!" : "PRIZE SECURED";
    this.amount.textContent = outcome.payout.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    this.multiplier.textContent = `${outcome.payoutX.toLocaleString("en-US", { maximumFractionDigits: 3 })}× PAYOUT`;
    this.names.textContent = prizes.map((prize) => prize.name).join(" + ");
    const paint = () => {
      if (this.shownSeed !== outcome.seedHex) return;
      const ctx = this.art.getContext("2d")!;
      ctx.clearRect(0, 0, this.art.width, this.art.height);
      prizes.forEach((prize, i) =>
        drawPrizeSprite(
          ctx,
          prize,
          double ? 137 + i * 165 : 220,
          double ? 177 + i * 22 : 185,
          double ? 235 : 295,
        ),
      );
    };
    paint();
    void preloadPrizeSprites().then(paint);
    this.panel.hidden = false;
  }

  clear(): void {
    this.shownSeed = null;
    this.dismissedSeed = null;
    this.panel.hidden = true;
  }
}
