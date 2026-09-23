/**
 * Chain Jam widget.
 *
 * The required submission tag —
 *   <script async src="https://jam.chain.wtf/widget.js"></script>
 * — lives in index.html so the jam's URL check always sees it, even before
 * this bundle runs. Keep the widget in the footer so its floating badge
 * cannot cover game controls or prizes on a small screen.
 */

export function mountJamWidget(host: HTMLElement): void {
  host.innerHTML = `
    <div class="jam-widget-credit">
      <span class="jam-dot"></span>
      Built for <a href="https://jam.chain.wtf/" target="_blank" rel="noopener">Chain Jam Vol. 1</a>
    </div>
  `;
  const placeBadge = (): boolean => {
    const badge = document.getElementById("chain-jam-badge");
    if (!badge) return false;
    host.replaceChildren(badge);
    return true;
  };
  if (placeBadge()) return;
  const observer = new MutationObserver(() => {
    if (placeBadge()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true });
}
