'use strict';
(function () {
  const C = globalThis.OutfitCore;
  const PREFS_KEY = 'outfitai_prefs';
  const POOL_KEY = 'outfitai_pool_v2'; // v2: descarta productos guardados con nombres/categorías erróneos de v0.1.0
  const OLD_POOL_KEY = 'outfitai_pool';
  const MAX_SECTIONS = 6;
  const SESSION_KEY = 'outfitai_session';
  const SESSION_TTL = 24 * 3600 * 1000;
  const POOL_MAX = 400;
  const POOL_TTL = 7 * 24 * 3600 * 1000;
  const DEFAULTS = { style: 'casual', height: '', weight: '', shoeSize: '', budget: '100', clothingSize: '', colors: '', wanted: ['camiseta', 'pantalon', 'zapatillas'], autoCollect: true };

  const $ = (id) => document.getElementById(id);
  const state = { prefs: null, result: null, shown: new Set(), last: null };

  /* ------------------------------ DOM helpers ------------------------------ */
  // Siempre textContent / nodos de texto: el contenido de las tiendas no es de fiar.
  function el(tag, props, children) {
    const n = document.createElement(tag);
    for (const k of Object.keys(props || {})) {
      if (k === 'text') n.textContent = props[k];
      else if (k === 'class') n.className = props[k];
      else n.setAttribute(k, props[k]);
    }
    for (const c of children || []) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  const clear = (n) => {
    while (n.firstChild) n.removeChild(n.firstChild);
  };
  const safeHttp = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });

  function setStatus(kind, lines) {
    const box = $('status');
    clear(box);
    box.className = 'msg' + (kind ? ' ' + kind : '');
    const list = Array.isArray(lines) ? lines : [lines];
    list.forEach((l, i) => {
      if (Array.isArray(l)) {
        box.appendChild(el('ul', {}, l.map((x) => el('li', { text: x }))));
      } else {
        box.appendChild(el('div', { text: l }));
      }
    });
    box.hidden = false;
  }

  /* ------------------------------ Preferencias ------------------------------ */
  function readForm() {
    return {
      style: $('style').value,
      height: $('height').value,
      weight: $('weight').value,
      shoeSize: $('shoeSize').value,
      budget: $('budget').value,
      clothingSize: $('clothingSize').value,
      colors: $('colors').value,
      wanted: Array.from(document.querySelectorAll('input[name=wanted]:checked')).map((i) => i.value),
      autoCollect: $('autoCollect').checked
    };
  }
  function fillForm(p) {
    $('style').value = C.STYLES[p.style] ? p.style : DEFAULTS.style;
    $('height').value = p.height ?? '';
    $('weight').value = p.weight ?? '';
    $('shoeSize').value = p.shoeSize ?? '';
    $('budget').value = p.budget ?? '';
    $('clothingSize').value = p.clothingSize || '';
    $('colors').value = p.colors || '';
    $('autoCollect').checked = p.autoCollect !== false;
    const w = Array.isArray(p.wanted) ? p.wanted : [];
    document.querySelectorAll('input[name=wanted]').forEach((i) => {
      i.checked = w.includes(i.value);
    });
  }
  function showErrors(errors) {
    const box = $('errors');
    const msgs = Object.values(errors);
    clear(box);
    if (!msgs.length) {
      box.hidden = true;
      return;
    }
    msgs.forEach((m) => box.appendChild(el('div', { text: m })));
    box.hidden = false;
  }
  let saveTimer = null;
  function onFormChange() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const raw = readForm();
      const v = C.validatePrefs(raw);
      showErrors(v.errors);
      if (Object.keys(v.errors).length) return;
      await chrome.storage.local.set({ [PREFS_KEY]: raw });
      $('saved').hidden = false;
      setTimeout(() => ($('saved').hidden = true), 1500);
    }, 400);
  }

  /* ------------------- Sesión: el outfit sobrevive a cerrar el panel ------------------- */
  const session = { lastKey: null, shown: [], view: 'list', cart: null };
  let sessionTimer = null;
  function saveSession() {
    session.lastKey = state.last ? state.last.key : null;
    session.shown = Array.from(state.shown);
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
      chrome.storage.local.set({ [SESSION_KEY]: Object.assign({ savedAt: Date.now() }, session) }).catch(() => {});
    }, 50);
  }
  async function restoreSession() {
    try {
      const data = await chrome.storage.local.get(SESSION_KEY);
      const s = data[SESSION_KEY];
      if (!s || !s.lastKey || Date.now() - (s.savedAt || 0) > SESSION_TTL) return;
      const v = C.validatePrefs(readForm());
      if (Object.keys(v.errors).length) return;
      const pool = await loadPool();
      if (!Object.keys(pool).length) return;
      state.prefs = v.clean;
      state.pool = pool;
      state.result = C.generate(Object.values(pool), state.prefs);
      const o = state.result.outfits.find((x) => x.key === s.lastKey);
      if (!o) return; // los productos o las preferencias cambiaron: no se muestra un outfit distinto del guardado
      state.shown = new Set(s.shown || []);
      state.shown.add(o.key);
      state.last = o;
      renderOutfit(o, state.result);
      setView(s.view === 'preview' ? 'preview' : 'list');
      if (s.cart && s.cart.header) showCart(s.cart.kind, s.cart.header, s.cart.rows || []);
      setStatus('', 'Outfit restaurado: tu panel se había cerrado.');
    } catch (e) {
      /* sin sesión válida: se parte de cero */
    }
  }

  /* ----------------------------- Pool de productos ----------------------------- */
  async function loadPool() {
    try {
      await chrome.storage.local.remove(OLD_POOL_KEY);
    } catch (e) {
      /* sin datos antiguos */
    }
    const data = await chrome.storage.local.get(POOL_KEY);
    const now = Date.now();
    const pool = data[POOL_KEY] || {};
    for (const k of Object.keys(pool)) if (!pool[k] || now - (pool[k].seenAt || 0) > POOL_TTL) delete pool[k];
    return pool;
  }
  async function savePool(pool) {
    const entries = Object.entries(pool).sort((a, b) => (b[1].seenAt || 0) - (a[1].seenAt || 0)).slice(0, POOL_MAX);
    const trimmed = Object.fromEntries(entries);
    await chrome.storage.local.set({ [POOL_KEY]: trimmed });
    return trimmed;
  }

  /* --------------------------------- Escaneo --------------------------------- */
  async function injectAndExtract(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['outfit-core.js', 'content.js'] });
    const res = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__outfitaiExtract() });
    const data = res && res[0] && res[0].result;
    if (!data) return { ok: false, code: 'empty' };
    return data.ok ? { ok: true, data } : { ok: false, code: data.code || 'exception', message: data.message };
  }

  async function scanTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || tab.id == null) return { ok: false, code: 'no_tab' };
    // Sin permiso sobre la pestaña, Chrome oculta su dirección (tab.url indefinida): NO es lo mismo que «no es una web».
    if (!tab.url) return { ok: false, code: 'no_url' };
    if (!/^https?:\/\//i.test(tab.url)) return { ok: false, code: 'not_web' };
    try {
      const r = await injectAndExtract(tab.id);
      r.tabId = tab.id;
      r.url = tab.url;
      return r;
    } catch (e) {
      return { ok: false, code: 'no_access', message: String(e && e.message ? e.message : e) };
    }
  }

  /* ------------------- Recogida automática de otras secciones ------------------- */
  // Permiso de host OPCIONAL, solo para el origen de la tienda y pedido al pulsar el botón.
  async function ensureOriginPermission(url) {
    try {
      if (!chrome.permissions) return false;
      const pattern = new URL(url).origin + '/*';
      if (await chrome.permissions.contains({ origins: [pattern] })) return true;
      return !!(await chrome.permissions.request({ origins: [pattern] }));
    } catch (e) {
      return false;
    }
  }

  function waitTabComplete(tabId, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          chrome.tabs.onUpdated.removeListener(listener);
        } catch (e) {
          /* ya retirado */
        }
        resolve();
      };
      const listener = (id, info) => {
        if (id === tabId && info && info.status === 'complete') finish();
      };
      const timer = setTimeout(finish, timeoutMs);
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId).then((t) => {
        if (t && t.status === 'complete') finish();
      }, finish);
    });
  }

  // Abre la sección en una pestaña en segundo plano, la lee y SIEMPRE la cierra.
  async function readSection(url) {
    let tabId = null;
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;
      await waitTabComplete(tabId, 25000);
      await chrome.scripting.executeScript({ target: { tabId }, files: ['outfit-core.js', 'content.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__outfitaiScroll(6, 700) });
      return await injectAndExtract(tabId);
    } catch (e) {
      return { ok: false, code: 'no_access', message: String(e && e.message ? e.message : e) };
    } finally {
      if (tabId != null) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (e) {
          /* la pestaña ya no existe */
        }
      }
    }
  }

  function addToPool(pool, d, hint) {
    const now = Date.now();
    let n = 0;
    for (const p of d.products) {
      const e = C.enrichProduct(p, d.pageCategoryText, hint);
      e.store = d.store.name;
      e.seenAt = now;
      pool[e.id] = e;
      n++;
    }
    return n;
  }

  async function collectSections(scan, pool, baseLines, kind) {
    const missing = C.missingCategories(Object.values(pool), state.prefs);
    if (!missing.length) return { pool, lines: [] };
    const res = await chrome.scripting.executeScript({
      target: { tabId: scan.tabId },
      func: (cats, ex) => globalThis.__outfitaiSections(cats, ex),
      args: [missing, Object.keys(pool)]
    });
    const found = res && res[0] && res[0].result;
    const secs = found && found.ok ? found.sections.slice(0, MAX_SECTIONS) : [];
    const lines = [];
    const noLink = missing.filter((c) => !secs.some((s) => s.category === c));
    if (!secs.length) {
      lines.push('No he encontrado en la página enlaces claros a las secciones que faltan (' + missing.map((c) => C.CATEGORY_LABELS[c]).join(', ') + '). Abre tú esas secciones una vez y se guardarán.');
      return { pool, lines };
    }
    const got = [];
    for (let i = 0; i < secs.length; i++) {
      const s = secs[i];
      setStatus(kind, baseLines.concat([`Recogiendo secciones (${i + 1}/${secs.length}): ${s.label || C.CATEGORY_LABELS[s.category]}…`]));
      const r = await readSection(s.url);
      if (r.ok) {
        const n = addToPool(pool, r.data, s.category);
        got.push(`${C.CATEGORY_LABELS[s.category]} (${n})`);
      } else {
        got.push(`${C.CATEGORY_LABELS[s.category]} (no se pudo leer)`);
      }
    }
    pool = await savePool(pool);
    lines.push('Secciones recogidas automáticamente: ' + got.join(', ') + '.');
    if (noLink.length) lines.push('Sin enlace claro para: ' + noLink.map((c) => C.CATEGORY_LABELS[c]).join(', ') + '.');
    return { pool, lines };
  }

  // Cuando Chrome no deja ver la pestaña, no se puede saber su origen: se ofrece pedir permiso por tienda conocida
  // (permiso opcional, solo para ese dominio, y solo al pulsar el botón).
  function addAccessButtons() {
    const box = $('status');
    const wrap = el('div', { class: 'access' }, []);
    for (const st of C.STORES) {
      const b = el('button', { type: 'button', text: st.name });
      b.addEventListener('click', async () => {
        let ok = false;
        try {
          ok = !!(await chrome.permissions.request({ origins: [`https://*.${st.domain}/*`] }));
        } catch (e) {
          ok = false;
        }
        if (ok) run();
        else setStatus('warn', 'Sin permiso no puedo leer la tienda. Puedes volver a intentarlo o pulsar el icono de OutfitAI en la pestaña de la tienda.');
      });
      wrap.appendChild(b);
    }
    box.appendChild(wrap);
  }

  const SCAN_ERRORS = {
    no_tab: 'No se ha podido identificar la pestaña activa.',
    not_web: 'Abre una página de una tienda online (http/https) y vuelve a pulsar el botón.',
    no_url: 'No tengo acceso a esta pestaña: Chrome me oculta su dirección hasta que lo permitas (el panel lateral se queda abierto al cambiar de pestaña y el permiso del icono es solo para la pestaña donde lo pulsaste). Pulsa el icono de OutfitAI de la barra de Chrome estando en la pestaña de la tienda, o concede acceso a la tienda con uno de estos botones:',
    no_access: 'Chrome no deja leer esta página (puede ser una página protegida o la Chrome Web Store). Prueba en la página de la tienda.',
    empty: 'La página no devolvió datos. Recárgala e inténtalo de nuevo.',
    exception: 'Se produjo un error al leer la página.',
    no_core: 'No se pudo cargar el extractor.'
  };

  /* ------------------------------ Flujo principal ------------------------------ */
  async function run() {
    const raw = readForm();
    const v = C.validatePrefs(raw);
    showErrors(v.errors);
    if (Object.keys(v.errors).length) return;
    state.prefs = v.clean;
    await chrome.storage.local.set({ [PREFS_KEY]: raw });

    $('create').disabled = true;
    $('refresh').disabled = true;
    setStatus('', 'Analizando la página…');
    try {
      // El permiso se pide lo primero para que cuente como gesto del usuario (clic en el botón).
      let canCollect = false;
      if (raw.autoCollect) {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0] && /^https?:\/\//i.test(tabs[0].url || '')) canCollect = await ensureOriginPermission(tabs[0].url);
          // (con tab.url oculta no se pide nada aquí: se explica y se ofrecen los botones de tienda más abajo)
        } catch (e) {
          canCollect = false;
        }
      }
      let pool = await loadPool();
      let scan = await scanTab();
      if (!scan.ok && scan.code === 'no_access') {
        // Con el panel lateral, activeTab puede no cubrir la pestaña: se pide el permiso de esa tienda y se reintenta.
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && (await ensureOriginPermission(tabs[0].url))) {
          canCollect = true;
          scan = await scanTab();
        }
      }
      const lines = [];
      let kind = '';
      if (scan.ok) {
        const d = scan.data;
        addToPool(pool, d);
        pool = await savePool(pool);
        $('storeBadge').textContent = d.store.name;
        $('storeBadge').hidden = false;
        lines.push(`${d.store.name}${d.store.known ? '' : ' (tienda no preparada: modo genérico)'} · ${d.products.length} producto(s) con precio en EUR detectado(s) en esta página.`);
        const s = d.stats;
        const dropped = [];
        if (s.nonEur) dropped.push(`${s.nonEur} con moneda distinta de EUR`);
        if (s.unknownCurrency) dropped.push(`${s.unknownCurrency} con moneda sin confirmar`);
        if (s.ambiguous) dropped.push(`${s.ambiguous} con precio ambiguo`);
        if (s.noPrice) dropped.push(`${s.noPrice} sin precio legible`);
        if (s.outOfStock) dropped.push(`${s.outOfStock} agotado(s) según la página (no se usarán)`);
        if (dropped.length) lines.push('Descartados por fiabilidad: ' + dropped.join(', ') + '.');
        if (!d.products.length) {
          kind = 'warn';
          lines.push('No se han detectado productos con precio fiable. Qué puedes hacer:');
          lines.push([
            'Abre un listado de productos (camisetas, pantalones…) o la ficha de un producto.',
            'Desplázate hasta el final para que la tienda cargue los productos y pulsa «Actualizar productos».',
            'Si la tienda carga los precios con scripts o los oculta, no se podrán leer: prueba en otra sección o tienda.'
          ]);
        }
      } else {
        kind = 'warn';
        lines.push(SCAN_ERRORS[scan.code] || SCAN_ERRORS.exception);
        if (Object.keys(pool).length) lines.push('Se usarán los productos guardados de visitas anteriores.');
      }
      if (scan.ok && raw.autoCollect) {
        if (!canCollect) {
          lines.push('No has dado permiso para leer otras secciones de esta tienda, así que solo uso lo que ya tengo. Puedes volver a pulsar el botón y aceptarlo.');
        } else if (scan.data.products.length || Object.keys(pool).length) {
          setStatus(kind, lines);
          const r = await collectSections(scan, pool, lines.slice(), kind);
          pool = r.pool;
          for (const l of r.lines) lines.push(l);
        }
      }
      setStatus(kind, lines);
      if (!scan.ok && scan.code === 'no_url') addAccessButtons();
      state.pool = pool;
      renderDetected(pool);
      generateAndShow(pool);
    } catch (e) {
      setStatus('error', 'Error inesperado: ' + (e && e.message ? e.message : e));
    } finally {
      $('create').disabled = false;
      $('refresh').disabled = false;
    }
  }

  function generateAndShow(pool) {
    session.cart = null;
    const products = Object.values(pool);
    state.result = C.generate(products, state.prefs);
    state.shown = new Set();
    state.last = null;
    showNext();
  }

  function showNext() {
    const r = state.result;
    if (!r) return;
    const o = C.pickNext(r, state.shown, state.last);
    if (!o) {
      if (state.last) {
        renderNotes(r, 'No hay más combinaciones distintas con los productos detectados. Visita otras secciones de la tienda para reunir más productos.');
        return;
      }
      renderNone(r);
      return;
    }
    state.shown.add(o.key);
    state.last = o;
    renderOutfit(o, r);
    saveSession();
  }

  /* ------------------------------- Renderizado ------------------------------- */
  function renderOutfit(o, r) {
    $('result').hidden = false;
    $('addCart').hidden = false;
    $('viewTabs').hidden = false;
    $('cartStatus').hidden = true;
    $('cartDiag').hidden = true;
    session.cart = null;
    renderPreview(o);
    $('resultTitle').textContent = `Tu outfit (${o.items.length} prenda${o.items.length === 1 ? '' : 's'})`;
    const ul = $('items');
    clear(ul);
    for (const { product: p, size } of o.items) {
      const thumbSrc = safeHttp(p.image);
      const thumb = thumbSrc
        ? el('img', { class: 'thumb', src: thumbSrc, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
        : el('div', { class: 'thumb empty', text: 'sin imagen' });
      if (thumbSrc) thumb.addEventListener('error', () => thumb.replaceWith(el('div', { class: 'thumb empty', text: 'sin imagen' })));
      const url = safeHttp(p.url);
      const title = url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: p.name }) : el('span', { text: p.name });
      const metaBits = [C.CATEGORY_LABELS[p.category] || p.category, p.store || '', p.categorySource === 'pagina' ? 'categoría deducida de la página' : '', p.seenAt ? 'precio visto el ' + fmtDate(p.seenAt) : ''].filter(Boolean);
      ul.appendChild(
        el('li', {}, [
          thumb,
          el('div', {}, [el('div', { class: 'name' }, [title]), el('div', { class: 'meta', text: metaBits.join(' · ') }), el('div', { class: 'size ' + size.state, text: size.text })]),
          el('div', { class: 'price', text: C.formatEuro(p.priceCents) })
        ])
      );
    }
    const t = $('totals');
    clear(t);
    t.appendChild(el('div', {}, [el('span', { text: 'Precio total' }), el('strong', { text: C.formatEuro(o.totalCents) })]));
    t.appendChild(el('div', {}, [el('span', { text: 'Presupuesto inicial' }), el('span', { text: C.formatEuro(o.budgetCents) })]));
    t.appendChild(el('div', {}, [el('span', { text: 'Dinero restante' }), el('span', { text: C.formatEuro(o.remainingCents) })]));
    t.appendChild(el('span', { class: 'ok', text: '✓ El outfit cumple el presupuesto' }));
    renderNotes(r);
  }

  function renderNotes(r, extra) {
    const box = $('notes');
    clear(box);
    const msgs = [];
    if (extra) msgs.push(extra);
    if (r.omitted.length) msgs.push('No cabían en el presupuesto y se han omitido: ' + r.omitted.map((c) => C.CATEGORY_LABELS[c]).join(', ') + '.');
    if (r.missing.length) msgs.push('Faltan prendas: ' + r.missing.map((c) => `${C.CATEGORY_LABELS[c]} (${r.missingDetail[c]})`).join('; ') + '.');
    if (state.prefs && state.prefs.unknownColors.length) msgs.push('Colores no reconocidos (ignorados): ' + state.prefs.unknownColors.join(', ') + '.');
    msgs.push('Las tallas y los precios son los que mostraba la página en el momento de leerla: confírmalos en la tienda.');
    box.appendChild(el('div', { class: 'msg warn' }, msgs.map((m) => el('div', { text: m }))));
  }

  function renderNone(r) {
    $('result').hidden = false;
    $('resultTitle').textContent = 'No se ha podido crear un outfit';
    $('addCart').hidden = true;
    $('viewTabs').hidden = true;
    setView('list');
    $('cartStatus').hidden = true;
    $('cartDiag').hidden = true;
    clear($('items'));
    clear($('totals'));
    const lines = [];
    if (r.stats.received === 0) lines.push('No hay productos detectados todavía. Abre un listado o una ficha de producto y pulsa «Actualizar productos».');
    if (r.missing.length) lines.push('Faltan: ' + r.missing.map((c) => `${C.CATEGORY_LABELS[c]} (${r.missingDetail[c]})`).join('; ') + '.');
    if (r.stats.noCategory) lines.push(`${r.stats.noCategory} producto(s) no se han podido clasificar en ninguna categoría y no se usan.`);
    lines.push('Puedes visitar otras secciones de la tienda (se guardan en este navegador durante 7 días) o subir el presupuesto.');
    const box = $('notes');
    clear(box);
    box.appendChild(el('div', { class: 'msg warn' }, lines.map((m) => el('div', { text: m }))));
  }

  function renderDetected(pool) {
    const list = Object.values(pool).sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0));
    $('detected').hidden = !list.length;
    $('detectedSummary').textContent = `Productos disponibles (${list.length})`;
    const ul = $('detectedList');
    clear(ul);
    for (const p of list.slice(0, 80)) {
      ul.appendChild(el('li', {}, [el('span', { text: `${p.name} · ${C.CATEGORY_LABELS[p.category] || 'sin categoría'}` }), el('span', { text: C.formatEuro(p.priceCents) })]));
    }
  }

  /* ----------------------------- Vista previa ----------------------------- */
  function setView(view) {
    session.view = view === 'preview' ? 'preview' : 'list';
    saveSession();
    const preview = view === 'preview';
    $('items').hidden = preview;
    $('preview').hidden = !preview;
    $('tabList').classList.toggle('active', !preview);
    $('tabPreview').classList.toggle('active', preview);
    $('tabList').setAttribute('aria-selected', String(!preview));
    $('tabPreview').setAttribute('aria-selected', String(preview));
  }

  // Composición plana («flat lay») con las fotos de la tienda, ordenada como se lleva puesto.
  function renderPreview(o) {
    const box = $('preview');
    clear(box);
    const by = {};
    for (const it of o.items) by[it.product.category] = it.product;
    const fig = (p) => {
      const src = safeHttp(p.image);
      const img = src
        ? el('img', { src, alt: p.name, loading: 'lazy', referrerpolicy: 'no-referrer' })
        : el('div', { class: 'pv-empty', text: 'sin imagen' });
      if (src) img.addEventListener('error', () => img.replaceWith(el('div', { class: 'pv-empty', text: 'sin imagen' })));
      return el('figure', { class: 'pv-fig' }, [img, el('figcaption', { class: 'pv-cap' }, [el('strong', { text: C.formatEuro(p.priceCents) }), document.createTextNode(C.CATEGORY_LABELS[p.category] || p.category)])]);
    };
    const row = (cls, cats) => {
      const list = cats.map((c) => by[c]).filter(Boolean);
      return list.length ? el('div', { class: 'pv-row ' + cls }, list.map(fig)) : null;
    };
    const stage = el('div', { class: 'pv-stage' }, [row('pv-top', ['chaqueta', 'sudadera', 'camiseta']), row('pv-legs', ['pantalon']), row('pv-feet', ['zapatillas']), row('pv-acc', ['accesorio'])].filter(Boolean));
    box.appendChild(stage);
    box.appendChild(el('div', { class: 'pv-note', text: `Total ${C.formatEuro(o.totalCents)} · composición con las fotos de la tienda; no es una prueba virtual sobre tu cuerpo.` }));
  }

  /* ---------------------------- Añadir a la cesta ---------------------------- */
  // Flujo (v0.5.0): por cada prenda se abre su ficha, se elige TU talla y se pulsa «Añadir». Después se ESPERA a lo que
  // hace la tienda (peticiones de cesta observadas) hasta que se calme o se agote el tiempo máximo. NINGUNA pestaña de
  // producto se cierra por su cuenta: al final se abre la cesta real, se comparan sus productos con los del outfit y solo se
  // cierran las fichas de las prendas que aparecen en ella. Todo lo demás queda abierto y se explica en el panel.
  const CART_ERRORS = {
    needs_size: 'falta tu talla en las preferencias (ropa o zapatillas)',
    size_missing: 'tu talla no aparece en la ficha',
    size_unavailable: 'tu talla figura agotada',
    no_button: 'no encuentro el botón «Añadir a la cesta» en la ficha',
    button_disabled: 'el botón de añadir está desactivado',
    no_access: 'Chrome no ha dejado leer la ficha',
    exception: 'error al leer la ficha'
  };
  const ADD_MIN_WAIT_MS = 3000; // espera mínima tras pulsar, aunque no se vea nada
  const ADD_QUIET_MS = 1500; // sin novedades de cesta durante este tiempo = la tienda terminó
  const ADD_MAX_WAIT_MS = 15000; // tope por prenda
  const POLL_MS = 500;
  const CART_CHECK_MAX_MS = 12000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cartRun = { stop: false };

  // Estas dos funciones se ejecutan DENTRO de la página (world MAIN) y no pueden usar nada del panel.
  // Solo observan: anotan método, ruta (sin parámetros) y estado de cada fetch/XHR. No leen cuerpos, cabeceras ni cookies.
  function installNetProbe() {
    if (window.__outfitaiNetProbe) {
      window.__outfitaiNetProbe.log.length = 0;
      document.documentElement.setAttribute('data-outfitai-req', '0');
      return true;
    }
    const probe = { log: [], pending: 0 };
    // Marca en el DOM (compartido con el script de contenido) para que éste sepa si ya salió una petición de cesta
    // y NO pulse «Añadir» por segunda vez (evita duplicados).
    const root = document.documentElement;
    const CART = /(?:cart|carrito|cesta|basket|bolsa|\bbag\b|checkout|\border)/i;
    let cartReqs = 0;
    root.setAttribute('data-outfitai-probe', '1');
    root.setAttribute('data-outfitai-req', '0');
    const bump = (method, url) => {
      if (method !== 'GET' && method !== 'HEAD' && CART.test(url)) root.setAttribute('data-outfitai-req', String(++cartReqs));
    };
    const clip = (u) => {
      try {
        const x = new URL(u, location.href);
        return x.origin + x.pathname;
      } catch (e) {
        return '';
      }
    };
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        const entry = { kind: 'fetch', method: 'GET', url: '', status: null, done: false };
        try {
          entry.url = clip(typeof input === 'string' ? input : input && input.url ? input.url : String(input));
          entry.method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        } catch (e) {
          /* se anota lo que haya */
        }
        probe.log.push(entry);
        probe.pending++;
        bump(entry.method, entry.url);
        let p;
        try {
          p = origFetch.apply(this, arguments);
        } catch (e) {
          entry.error = true;
          entry.done = true;
          probe.pending--;
          throw e;
        }
        return p.then(
          (r) => {
            entry.status = r.status;
            entry.done = true;
            probe.pending--;
            return r;
          },
          (err) => {
            entry.error = true;
            entry.done = true;
            probe.pending--;
            throw err;
          }
        );
      };
    }
    const X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (X) {
      const op = X.open;
      const sd = X.send;
      X.open = function (m, u) {
        try {
          this.__oaProbe = { kind: 'xhr', method: String(m).toUpperCase(), url: clip(u), status: null, done: false };
        } catch (e) {
          /* sin anotar */
        }
        return op.apply(this, arguments);
      };
      X.send = function () {
        const e = this.__oaProbe;
        if (e) {
          probe.log.push(e);
          probe.pending++;
          bump(e.method, e.url);
          this.addEventListener('loadend', () => {
            e.status = this.status;
            e.error = this.status === 0;
            e.done = true;
            probe.pending--;
          });
        }
        return sd.apply(this, arguments);
      };
    }
    window.__outfitaiNetProbe = probe;
    return true;
  }
  function readNetProbe() {
    const p = window.__outfitaiNetProbe;
    if (!p) return null;
    return { pending: p.pending, log: p.log.slice(-60).map((e) => ({ kind: e.kind, method: e.method, url: String(e.url).slice(0, 160), status: e.status, done: e.done, error: !!e.error })) };
  }

  const pathOf = (u) => {
    try {
      return new URL(u).pathname;
    } catch (e) {
      return String(u || '');
    }
  };

  async function readNet(tabId) {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readNetProbe });
      return (r && r[0] && r[0].result) || { pending: 0, log: [], missing: true };
    } catch (e) {
      return { pending: 0, log: [], missing: true };
    }
  }
  async function readSignals(tabId) {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__outfitaiAddSignals() });
      return (r && r[0] && r[0].result) || { domChanged: false, perf: [] };
    } catch (e) {
      return { domChanged: false, perf: [] };
    }
  }

  function showCart(kind, header, rows) {
    session.cart = { kind, header, rows: (rows || []).map((r) => ({ text: r.text, cls: r.cls || '' })) };
    saveSession();
    const box = $('cartStatus');
    clear(box);
    box.className = 'msg' + (kind ? ' ' + kind : '');
    box.appendChild(el('div', { text: header }));
    if (rows && rows.length) box.appendChild(el('ul', {}, rows.map((r) => el('li', { class: r.cls || '', text: r.text }))));
    box.hidden = false;
  }

  function showDiag(lines) {
    $('cartDiagText').textContent = lines.join('\n');
    $('cartDiag').hidden = !lines.length;
  }

  const OUTCOME_TEXT = {
    confirmed: (d) => ({ text: `la tienda aceptó la petición (${d}). Falta comprobarlo en la cesta`, cls: '' }),
    rejected: (d) => ({ text: `✗ la tienda RECHAZÓ la petición (${d}). Ficha abierta para que la termines tú`, cls: 'bad' }),
    probable: (d) => ({ text: `? hay indicios (${d}) pero no confirmación. Ficha abierta; se comprobará en la cesta`, cls: '' }),
    unconfirmed: () => ({ text: '? no se vio ninguna respuesta de la tienda. Ficha abierta; se comprobará en la cesta', cls: '' }),
    pending: () => ({ text: `? la petición de cesta no terminó en ${ADD_MAX_WAIT_MS / 1000} s. Ficha abierta; se comprobará en la cesta`, cls: '' })
  };

  // Abre la cesta real y comprueba qué prendas del outfit aparecen. Devuelve {cartTabId, results:[{id,state}], links, error}.
  async function checkCart(cartUrl, products, D, isStopped) {
    let cartTabId = null;
    try {
      const tab = await chrome.tabs.create({ url: cartUrl, active: true });
      cartTabId = tab.id;
      await waitTabComplete(cartTabId, 25000);
      await chrome.scripting.executeScript({ target: { tabId: cartTabId }, files: ['outfit-core.js', 'content.js'] });
      await chrome.scripting.executeScript({ target: { tabId: cartTabId }, func: () => globalThis.__outfitaiScroll(3, 500) });
      const end = Date.now() + CART_CHECK_MAX_MS;
      let results = [];
      let cart = { links: [], text: '' };
      for (;;) {
        const r = await chrome.scripting.executeScript({ target: { tabId: cartTabId }, func: () => globalThis.__outfitaiReadCart() });
        cart = (r && r[0] && r[0].result) || cart;
        results = C.matchCartItems(products, cart);
        if (results.every((x) => x.state === 'found_link') || Date.now() >= end || isStopped()) break;
        await sleep(1000); // la cesta de una SPA se pinta con retraso: se vuelve a leer
      }
      D(`cesta: ${pathOf(cartUrl)} · ${cart.links.length} enlace(s) leído(s) · identificadores de producto vistos: ${cart.links.map(C.productKey).filter(Boolean).slice(0, 20).join(', ') || 'ninguno'}`);
      return { cartTabId, results, links: cart.links.length };
    } catch (e) {
      D('cesta: no se pudo leer (' + (e && e.message ? e.message : e) + ')');
      return { cartTabId, results: null, links: 0, error: true };
    }
  }

  async function addToCart() {
    const o = state.last;
    if (!o || !state.prefs) return;
    $('addCart').disabled = true;
    $('cartStop').hidden = false;
    cartRun.stop = false;
    const diag = [];
    const D = (t) => diag.push(t);
    const n = o.items.length;
    try {
      // 1) Permisos por tienda, lo primero (gesto del usuario).
      const granted = {};
      for (const it of o.items) {
        const origin = new URL(it.product.url).origin;
        if (!(origin in granted)) granted[origin] = await ensureOriginPermission(it.product.url);
      }
      const rows = o.items.map((it) => ({ text: `${it.product.name} · en espera`, cls: '' }));
      const attempted = o.items.map(() => false);
      const tabs = o.items.map(() => null);
      const reqNote = o.items.map(() => ''); // qué respondió la tienda a la petición (se conserva tras comprobar la cesta)
      let cartUrl = null;
      const refresh = (header) => {
        showCart('', header, rows);
        showDiag(diag);
      };
      refresh('Añadiendo prendas a la cesta… (no se cierra ninguna ficha hasta comprobar la cesta)');

      for (let i = 0; i < n; i++) {
        const p = o.items[i].product;
        const label = p.name;
        const origin = new URL(p.url).origin;
        const step = (t, cls) => {
          rows[i] = { text: `${label} · ${t}`, cls: cls || '' };
          refresh(`Prenda ${i + 1} de ${n}: ${label}`);
        };
        D(`#${i + 1} ${label} · ${C.CATEGORY_LABELS[p.category] || p.category} · ${pathOf(p.url)}`);
        if (cartRun.stop) {
          rows[i] = { text: `${label} · no procesada (detenido por ti)`, cls: '' };
          continue;
        }
        if (!granted[origin]) {
          rows[i] = { text: `${label}: sin permiso para leer la tienda`, cls: 'bad' };
          D('  sin permiso de la tienda');
          continue;
        }
        const target = p.category === 'zapatillas' ? state.prefs.shoeSize : state.prefs.clothingSize;
        try {
          step('abriendo la ficha…');
          const tab = await chrome.tabs.create({ url: p.url, active: true });
          tabs[i] = tab.id;
          await waitTabComplete(tab.id, 25000);
          step('preparando la ficha…');
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['outfit-core.js', 'content.js'] });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: installNetProbe });
          step(`eligiendo tu talla (${target === null || target === undefined || target === '' ? 'sin talla definida' : target}) y pulsando «Añadir»…`);
          const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (t) => globalThis.__outfitaiAddStart(t), args: [target === undefined ? null : target] });
          const r = res && res[0] && res[0].result;
          for (const st of (r && r.steps) || []) D('  · ' + st);
          if (!r || !r.ok) {
            const why = CART_ERRORS[(r && r.code) || 'exception'] || 'error desconocido';
            rows[i] = { text: `${label}: no añadida, ${why}. He dejado la ficha abierta para que la termines tú.`, cls: 'bad' };
            D('  resultado: no se pudo pulsar (' + ((r && r.code) || 'exception') + ')');
            continue;
          }
          attempted[i] = true;
          if (r.cartUrl && !cartUrl) cartUrl = r.cartUrl;

          // 2) Esperar a la tienda: nada se cierra mientras haya una petición de cesta en curso.
          const t0 = Date.now();
          let lastActivity = t0;
          let seen = -1;
          let out = { state: 'unconfirmed', detail: '' };
          let net = { pending: 0, log: [] };
          let sig = { domChanged: false, perf: [] };
          for (;;) {
            await sleep(POLL_MS);
            net = await readNet(tab.id);
            sig = await readSignals(tab.id);
            out = C.classifyAddOutcome({ net: net.log, perf: sig.perf, domChanged: sig.domChanged });
            const cartCount = net.log.filter(C.isCartRequest).length + (sig.perf || []).filter(C.isCartRequest).length;
            if (cartCount !== seen || out.state === 'pending') {
              seen = cartCount;
              lastActivity = Date.now();
            }
            const elapsed = Date.now() - t0;
            step(`esperando a la tienda (${Math.round(elapsed / 1000)} s)…${out.state === 'pending' ? ' petición de cesta en curso' : ''}`);
            if (cartRun.stop) break;
            if (elapsed >= ADD_MIN_WAIT_MS && Date.now() - lastActivity >= ADD_QUIET_MS && out.state !== 'pending') break;
            if (elapsed >= ADD_MAX_WAIT_MS) break;
          }
          D(`  peticiones fetch/XHR observadas: ${net.log.length}${net.missing ? ' (no se pudo instalar el observador)' : ''}`);
          for (const e of net.log.slice(-10)) D(`    ${e.method} ${pathOf(e.url)} → ${e.error ? 'error' : e.done ? e.status : 'sin respuesta'}`);
          D(`  indicio en la página (texto de la cesta cambió): ${sig.domChanged ? 'sí' : 'no'}`);
          D(`  resultado de la petición: ${out.state}${out.detail ? ' · ' + out.detail : ''}`);
          const view = OUTCOME_TEXT[out.state] || OUTCOME_TEXT.unconfirmed;
          const t = view(out.detail);
          rows[i] = { text: `${label}: ${t.text}`, cls: t.cls };
          reqNote[i] = t.text.replace(/\. (?:Ficha abierta|Falta comprobarlo|se comprobará).*$/, '');
          refresh(`Prenda ${i + 1} de ${n} terminada`);
        } catch (e) {
          rows[i] = { text: `${label}: no añadida, ${CART_ERRORS.no_access}. Ficha abierta para que la termines tú.`, cls: 'bad' };
          D('  error: ' + (e && e.message ? e.message : e));
        }
      }

      // 3) Comprobar la cesta real.
      const idx = attempted.map((a, k) => (a ? k : -1)).filter((k) => k >= 0);
      if (!idx.length) {
        showCart('warn', 'Ninguna prenda llegó a pulsarse. He dejado abiertas las fichas que se abrieron.', rows);
        showDiag(diag);
        return;
      }
      if (!cartUrl) {
        for (const k of idx) rows[k] = { text: rows[k].text + ' · no he podido comprobar la cesta', cls: rows[k].cls };
        D('cesta: no he encontrado su dirección en las fichas');
        showCart('warn', `No he encontrado la dirección de la cesta, así que NO puedo comprobar que estén las ${idx.length} prenda(s). He dejado las fichas abiertas: abre la cesta de la tienda y revísala.`, rows);
        showDiag(diag);
        return;
      }
      refresh('Abriendo la cesta de la tienda para comprobar que están todas…');
      const chk = await checkCart(cartUrl, idx.map((k) => o.items[k].product), D, () => cartRun.stop);
      let inCart = 0;
      if (chk.results) {
        for (let m = 0; m < idx.length; m++) {
          const k = idx[m];
          const st = chk.results[m].state;
          const label = o.items[k].product.name;
          if (st === 'found_link') {
            inCart++;
            rows[k] = { text: `${label}: ✓ aparece en la cesta de la tienda`, cls: 'good' };
            try {
              await chrome.tabs.remove(tabs[k]); // única situación en la que se cierra una ficha
            } catch (e) {
              /* ya cerrada */
            }
          } else if (st === 'found_name') {
            rows[k] = { text: `${label}: ? su nombre aparece en la cesta, pero no he podido reconocer el producto por su enlace (${reqNote[k]}). Ficha abierta`, cls: '' };
          } else if (st === 'not_found') {
            rows[k] = { text: `${label}: ✗ NO aparece en la cesta (${reqNote[k]}). Ficha abierta para que la termines tú`, cls: 'bad' };
          } else {
            rows[k] = { text: `${label}: ? la cesta no mostró productos legibles, no puedo comprobarla (${reqNote[k]}). Ficha abierta`, cls: '' };
          }
          D(`  comprobación en la cesta #${k + 1}: ${st}`);
        }
      } else {
        for (const k of idx) rows[k] = { text: rows[k].text + ' · no he podido leer la cesta', cls: rows[k].cls };
      }
      const all = inCart === n;
      const header = chk.results
        ? `${inCart} de ${n} prenda(s) comprobadas en la cesta de la tienda.${all ? '' : ' Las fichas de las demás siguen abiertas.'} La talla no se verifica en la cesta: míralo tú.`
        : 'No he podido leer la cesta; he dejado abiertas las fichas. Abre la cesta de la tienda y revísala.';
      showCart(all ? 'ok' : 'warn', header, rows);
      showDiag(diag);
    } catch (e) {
      showCart('error', 'Error inesperado al añadir a la cesta: ' + (e && e.message ? e.message : e), []);
      showDiag(diag);
    } finally {
      $('addCart').disabled = false;
      $('cartStop').hidden = true;
    }
  }

  /* ---------------------------------- Inicio ---------------------------------- */
  async function init() {
    for (const [k, def] of Object.entries(C.STYLES)) $('style').appendChild(el('option', { value: k, text: def.label }));
    const data = await chrome.storage.local.get(PREFS_KEY);
    fillForm(Object.assign({}, DEFAULTS, data[PREFS_KEY] || {}));

    $('prefs').addEventListener('submit', (e) => {
      e.preventDefault();
      run();
    });
    $('prefs').addEventListener('input', onFormChange);
    $('prefs').addEventListener('change', onFormChange);
    $('refresh').addEventListener('click', run);
    $('next').addEventListener('click', () => (state.result ? showNext() : run()));
    $('tabList').addEventListener('click', () => setView('list'));
    $('tabPreview').addEventListener('click', () => setView('preview'));
    $('addCart').addEventListener('click', addToCart);
    $('cartStop').addEventListener('click', () => {
      cartRun.stop = true;
    });
    $('cartDiagCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('cartDiagText').textContent);
        $('cartDiagCopy').textContent = 'Copiado';
      } catch (e) {
        $('cartDiagCopy').textContent = 'No se pudo copiar: selecciona el texto';
      }
    });
    $('clearPool').addEventListener('click', async () => {
      await chrome.storage.local.remove(POOL_KEY);
      state.result = null;
      $('result').hidden = true;
      renderDetected({});
      setStatus('', 'Productos guardados eliminados.');
    });

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && /^https?:\/\//i.test(tabs[0].url || '')) {
        const s = C.detectStore(new URL(tabs[0].url).hostname);
        $('storeBadge').textContent = s.name;
        $('storeBadge').hidden = false;
      }
    } catch (e) {
      /* sin pestaña legible: no pasa nada */
    }
    renderDetected(await loadPool());
    await restoreSession();

    // En el panel lateral la pestaña activa cambia sin cerrar nada: se actualiza la etiqueta de tienda.
    const refreshBadge = async () => {
      try {
        const t = await chrome.tabs.query({ active: true, currentWindow: true });
        if (t[0] && /^https?:\/\//i.test(t[0].url || '')) {
          $('storeBadge').textContent = C.detectStore(new URL(t[0].url).hostname).name;
          $('storeBadge').hidden = false;
        } else {
          $('storeBadge').hidden = true;
        }
      } catch (e) {
        /* sin pestaña legible */
      }
    };
    if (chrome.tabs.onActivated) chrome.tabs.onActivated.addListener(refreshBadge);
  }

  init();
})();
