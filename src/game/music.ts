/**
 * Looping background music. A real recorded track (not synthesised) — the
 * one exception to "no audio files": a good loop just isn't something
 * WebAudio synthesis fakes well.
 *
 * `unlock()` is called from the same first-user-gesture hook as `sfx.unlock()`
 * (autoplay policies require it); it lazily creates the <audio> element,
 * starts it once, and fades it in so it doesn't slam in at full volume.
 */

// public/audio/arcade-loop.mp3 is served as-is at the site root; resolve it
// against the document's own URL (not import.meta.url) so it still finds the
// file however deep the page is hosted, matching the relative asset paths
// Vite emits for the JS/CSS bundle.
const TRACK_URL = new URL("audio/arcade-loop.mp3", document.baseURI).href;
const TARGET_VOLUME = 0.32;
const FADE_MS = 1400;

class Music {
  private el: HTMLAudioElement | null = null;
  private muted = false;
  private fadeTimer = 0;

  unlock(): void {
    if (!this.el) {
      const el = new Audio(TRACK_URL);
      el.loop = true;
      el.preload = "auto";
      el.volume = 0;
      this.el = el;
    }
    if (this.el.paused) {
      void this.el.play().catch(() => {
        /* autoplay blocked — will retry on the next gesture (next unlock() call) */
      });
    }
    this.fadeTo(this.muted ? 0 : TARGET_VOLUME);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.el) this.fadeTo(m ? 0 : TARGET_VOLUME);
  }

  private fadeTo(target: number): void {
    if (!this.el) return;
    window.clearInterval(this.fadeTimer);
    const el = this.el;
    const start = el.volume;
    const steps = 20;
    let i = 0;
    this.fadeTimer = window.setInterval(() => {
      i++;
      el.volume = start + (target - start) * (i / steps);
      if (i >= steps) window.clearInterval(this.fadeTimer);
    }, FADE_MS / steps);
  }
}

export const music = new Music();
