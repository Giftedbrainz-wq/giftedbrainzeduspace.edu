/* Student account spaces are verified by the API, never decided by localStorage. */
window.GBLearningSpaces = (() => {
  const initial = new URLSearchParams(location.search).get("space") === "premium" ? "premium" : "public";
  let space = initial, tier = "free", started = false;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(host) {
    if(!host)return;
    const activated = tier === "activated";
    host.className = "gb-space-switch";
    host.setAttribute("aria-label", "Learning spaces");
    host.innerHTML = `<div class="gb-space-heading"><strong>${space === "premium" ? "Premium Learning Space" : "Public Learning Space"}</strong><small>${space === "premium" ? "Your activated learning materials and assessments." : "Your public learning resources and available assessments."}</small></div>
    <div class="gb-space-tabs"><button class="gb-space-tab" data-space="public" type="button" aria-current="${space === "public" ? "page" : "false"}">Public Space</button>${activated ? `<button class="gb-space-tab premium" data-space="premium" type="button" aria-current="${space === "premium" ? "page" : "false"}">✦ Premium Space</button>` : ""}</div>
    ${activated ? '<span class="gb-space-tag">✓ Activated account</span>' : ''}`;
  }
  async function init({element="spaceChooser",onChange=()=>{}}={}) {
    const host=document.getElementById(element);
    if(!host)return "public";
    try {
      const current=await GB.api("/api/learning-space");
      tier=current?.canOpenPremium ? "activated" : "free";
    } catch(err) {
      tier="free";
    }
    if(tier !== "activated" && space === "premium")space="public";
    const url = new URL(location.href);
    if(space === "premium")url.searchParams.set("space", "premium");
    else url.searchParams.delete("space");
    history.replaceState(null,"",url.pathname+url.search+url.hash);
    render(host);
    if(!started) {
      host.addEventListener("click",e=>{
        const button=e.target.closest("[data-space]");
        if(!button)return;
        const target=button.dataset.space;
        if(target === "premium" && tier !== "activated")return;
        if(target===space)return;
        space=target;
        const url=new URL(location.href);
        if(space === "premium")url.searchParams.set("space","premium");
        else url.searchParams.delete("space");
        history.replaceState(null,"",url.pathname+url.search+url.hash);
        render(host);
        onChange(space);
      });
      started=true;
    }
    return space;
  }
  return { init, get space(){return space;}, get isActivated(){return tier === "activated";} };
})();
