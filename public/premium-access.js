/* Gifted Brainz premium-access notice for locked CBT tests and study materials. */
window.GBPremium = (() => {
  const WHATSAPP_NUMBER = "2348156767275"; // 0815 67 67 275 (Nigeria)
  let overlay;
  let returnFocus;
  const close = () => {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("gb-premium-open");
    returnFocus?.focus?.();
  };
  const show = (kind = "resource", title = "") => {
    returnFocus = document.activeElement;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "gb-premium-backdrop";
      overlay.hidden = true;
      overlay.innerHTML = `<div class="gb-premium-dialog" role="dialog" aria-modal="true" aria-labelledby="gbPremiumTitle" aria-describedby="gbPremiumDescription">
        <button class="gb-premium-close" type="button" aria-label="Close" data-premium-close>×</button>
        <div class="gb-premium-lock" aria-hidden="true">🔒</div>
        <span class="gb-premium-eyebrow">PREMIUM RESOURCE</span>
        <h2 id="gbPremiumTitle">Available to Activated students</h2>
        <p id="gbPremiumDescription">This resource is reserved for premium students. Contact the administrator for details about activating your account.</p>
        <div class="gb-premium-resource" id="gbPremiumResource"></div>
        <a class="gb-premium-whatsapp" id="gbPremiumWhatsApp" href="https://wa.me/2348156767275" target="_blank" rel="noopener noreferrer" aria-label="Contact administrator via WhatsApp">
          <svg viewBox="0 0 32 32" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M16.03 2.66A13.23 13.23 0 0 0 4.57 22.48L2.66 29.3l7-1.84A13.3 13.3 0 1 0 16.03 2.66Zm0 24.16a10.87 10.87 0 0 1-5.55-1.52l-.4-.23-4.13 1.08 1.11-4.02-.26-.41a10.89 10.89 0 1 1 9.23 5.1Zm5.96-8.13c-.33-.17-1.93-.96-2.23-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.3-.2.22-.38.25-.71.08-.32-.17-1.37-.51-2.6-1.62-.96-.85-1.61-1.9-1.8-2.22-.2-.33-.02-.5.15-.66.14-.15.33-.39.49-.58.17-.2.22-.33.33-.55.11-.22.05-.42-.03-.58-.08-.17-.74-1.8-1.01-2.46-.27-.64-.54-.56-.74-.57h-.63c-.22 0-.58.09-.88.42-.3.32-1.15 1.12-1.15 2.72s1.18 3.14 1.34 3.35c.16.22 2.32 3.56 5.64 5 0 0 .78.34 1.64.5.69.13 1.31.11 1.8.07.55-.08 1.93-.79 2.2-1.55.27-.77.27-1.43.19-1.56-.08-.14-.3-.22-.63-.39Z"/></svg>
          <span>Contact Administrator</span>
          <span aria-hidden="true">↗</span>
        </a>
        <p class="gb-premium-phone">WhatsApp: <strong>0815 67 67 275</strong></p>
        <button class="gb-premium-later" type="button" data-premium-close>Maybe later</button>
      </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", e => { if (e.target === overlay || e.target.closest("[data-premium-close]")) close(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && overlay && !overlay.hidden) close(); });
    }
    const cleanTitle = String(title || "").trim().slice(0, 200);
    const cleanKind = String(kind || "resource").trim().slice(0, 60);
    overlay.querySelector("#gbPremiumResource").textContent = cleanTitle ? `${cleanKind}: ${cleanTitle}` : cleanKind;
    const message = `Hello Gifted Brainz Administrator, I would like to activate my account to access the premium ${cleanKind}${cleanTitle ? `: ${cleanTitle}` : ""}. Please share the details.`;
    overlay.querySelector("#gbPremiumWhatsApp").href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    overlay.hidden = false;
    document.body.classList.add("gb-premium-open");
    overlay.querySelector("[data-premium-close]")?.focus();
  };
  return { show, close };
})();
