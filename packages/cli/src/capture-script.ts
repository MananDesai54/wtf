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
    if (raw.closest('#__wtf_panel')) return; // control panel is not part of the page
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

  const mountPanel = () => {
    if (document.getElementById('__wtf_panel') || !document.body) return;
    const panel = document.createElement('div');
    panel.id = '__wtf_panel';
    panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;' +
      'display:flex;gap:8px;align-items:center;background:#111;color:#fff;' +
      'padding:8px 10px;border-radius:8px;font:12px/1 sans-serif;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.4)';
    const btnCss = 'border:0;border-radius:6px;padding:6px 12px;font:600 12px/1 sans-serif;cursor:pointer';

    const badge = document.createElement('span');
    badge.id = '__wtf_count';
    badge.textContent = '0 captured';

    const cap = document.createElement('button');
    cap.id = '__wtf_capture_btn';
    cap.textContent = 'Capture';
    cap.style.cssText = btnCss + ';background:#2f7cf6;color:#fff';
    cap.addEventListener('click', () => send({ type: 'capture', timestamp: Date.now() }));

    const done = document.createElement('button');
    done.id = '__wtf_done_btn';
    done.textContent = 'Done';
    done.style.cssText = btnCss + ';background:#333;color:#fff';
    done.addEventListener('click', () => send({ type: 'done', timestamp: Date.now() }));

    window.__wtfPanelState = (count) => { badge.textContent = count + ' captured'; };
    panel.append(badge, cap, done);
    document.body.appendChild(panel);
    send({ type: 'panel-ready', timestamp: Date.now() });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPanel);
  } else {
    mountPanel();
  }
})();`;
