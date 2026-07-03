// Runs inside the recorded page. Kept as a plain string so Playwright
// injects it verbatim on every navigation.
export const CAPTURE_SCRIPT = `(() => {
  if (window.__wtfInstalled) return;
  window.__wtfInstalled = true;

  const send = (payload) => {
    try { window.__wtf(JSON.stringify(payload)); } catch (e) {}
  };

  const cssPath = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };

  document.addEventListener('click', (ev) => {
    const raw = ev.target instanceof Element ? ev.target : null;
    if (!raw) return;
    const target = raw.closest('a, button, [role="button"], input, select, [onclick]') || raw;
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const label = (target.innerText || target.value || target.getAttribute('aria-label') || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 60);
    send({
      type: 'click',
      selector: cssPath(target),
      label: label,
      bbox: { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height },
      pageUrl: location.href,
      timestamp: Date.now(),
    });
  }, true);

  const notifyNav = () => send({ type: 'spa-nav', url: location.href, timestamp: Date.now() });
  for (const name of ['pushState', 'replaceState']) {
    const orig = history[name].bind(history);
    history[name] = (...args) => { const result = orig(...args); notifyNav(); return result; };
  }
  window.addEventListener('popstate', notifyNav);
  window.addEventListener('hashchange', notifyNav);
})();`;
