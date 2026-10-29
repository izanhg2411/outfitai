'use strict';
/*
 * Extractor de productos. Se inyecta bajo demanda (chrome.scripting) justo después de outfit-core.js
 * y solo en la pestaña activa cuando el usuario abre la extensión (permiso activeTab).
 * Todo lo que lee de la página es contenido NO confiable: solo se usan textContent, JSON.parse y
 * URLs validadas (http/https). Nunca se ejecuta ni se inserta como HTML.
 *
 * Punto de extensión: ADAPTERS[idTienda].extract(document) puede devolver productos extra
 * (mismo formato que los genéricos) para tiendas cuya estructura se conozca y se haya verificado.
 */
(function () {
  const Core = globalThis.OutfitCore;
  if (!Core) {
    globalThis.__outfitaiExtract = () => ({ ok: false, code: 'no_core' });
    return;
  }

  const ADAPTERS = {
    // Vacío a propósito: ninguna tienda tiene adaptador propio verificado todavía.
  };

  const MAX_CARDS = 150;
  const BAD_HREF = /^(?:#|javascript:|mailto:|tel:)/i;
  const NON_PRODUCT_PATH = /(cart|carrito|cesta|wishlist|favorit|login|account|cuenta|checkout|basket)/i;
  const OLD_CLASS = /(?:^|[^a-z])(?:old|was|before|original|strike|strikethrough|striked|cross|crossed|crossout|line-through|linethrough|tachad[oa]|anterior|previo)(?:$|[^a-z])/i;
  const NEW_CLASS = /(?:^|[^a-z])(?:new|current|sale|final|now|actual|oferta)(?:$|[^a-z])/i;

  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 140);

  function safeUrl(raw) {
    try {
      if (!raw || BAD_HREF.test(String(raw).trim())) return null;
      const u = new URL(String(raw), location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      u.hash = '';
      return u.href;
    } catch (e) {
      return null;
    }
  }

  /* ----------------------------- JSON-LD ----------------------------- */
  function collect(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((n) => collect(n, out, depth + 1));
      return;
    }
    const t = node['@type'];
    const types = Array.isArray(t) ? t : [t];
    if (types.includes('Product') || types.includes('ProductGroup')) {
      out.push(node);
      if (node.hasVariant) collect(node.hasVariant, out, depth + 1);
      return;
    }
    for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity']) collect(node[k], out, depth + 1);
  }

  function readJsonLd() {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        collect(JSON.parse(s.textContent), out, 0);
      } catch (e) {
        /* JSON no válido: se ignora */
      }
    });
    return out;
  }

  const asList = (v) => (!v ? [] : (Array.isArray(v) ? v : [v]).filter((o) => o && typeof o === 'object'));
  const firstImage = (v) => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return firstImage(v[0]);
    return v.url || v.contentUrl || null;
  };

  function readOffers(offers) {
    const found = [];
    let other = false;
    let noCur = false;
    let url = null;
    for (const o of asList(offers)) {
      for (const x of [o].concat(asList(o.offers))) {
        let price = x.price != null ? x.price : x.lowPrice != null ? x.lowPrice : null;
        let cur = x.priceCurrency;
        if (price == null && x.priceSpecification) {
          const ps = asList(x.priceSpecification)[0];
          if (ps) {
            price = ps.price;
            cur = cur || ps.priceCurrency;
          }
        }
        if (price == null) continue;
        const amount = typeof price === 'number' ? price : Core.parseAmount(String(price));
        if (amount == null || !(amount > 0)) continue;
        if (!cur) {
          noCur = true;
          continue;
        }
        if (String(cur).toUpperCase() !== 'EUR') {
          other = true;
          continue;
        }
        url = url || x.url || o.url || null;
        found.push({ cents: Math.round(amount * 100), out: /OutOfStock|SoldOut|Discontinued/i.test(String(x.availability || '')) });
      }
    }
    if (!found.length) return { skip: other ? 'nonEur' : noCur ? 'unknownCurrency' : 'noPrice' };
    const inStock = found.filter((f) => !f.out);
    const use = inStock.length ? inStock : found;
    return { cents: Math.min(...use.map((f) => f.cents)), outOfStock: !inStock.length, url };
  }

  const SIZE_SEL = [
    '[class*="size" i] button', '[class*="size" i] li', '[class*="size" i] label',
    '[class*="talla" i] button', '[class*="talla" i] li', '[class*="talla" i] label',
    '[data-qa-anchor*="size" i]'
  ].join(',');
  const SIZE_RE = /^(?:eu\s*)?(xxs|xs|s|m|l|xl|xxl|xxxl|3xl|4xl|\d{2}(?:[.,]5)?)$/i;

  function sizesFromDom() {
    const sel = SIZE_SEL;
    const re = SIZE_RE;
    const map = new Map();
    document.querySelectorAll(sel).forEach((el) => {
      const label = clean(el.textContent, 12);
      if (!re.test(label)) return;
      const cls = (el.getAttribute('class') || '') + ' ' + (el.parentElement ? el.parentElement.getAttribute('class') || '' : '');
      const off = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || /disabled|unavailable|sold|agotad|out-of-stock|outofstock|no-stock/i.test(cls);
      const key = label.toUpperCase();
      map.set(key, { label, available: (map.has(key) ? map.get(key).available : true) && !off });
    });
    return map.size >= 2 ? Array.from(map.values()) : null;
  }

  function jsonldToProduct(node, isSingle) {
    const name = clean(node.name, 140);
    if (!name) return { skip: 'noName' };
    const off = readOffers(node.offers);
    if (off.skip) return { skip: off.skip };
    const url = safeUrl(node.url || off.url || (isSingle ? location.href : null));
    if (!url) return { skip: 'noUrl' };
    return {
      product: {
        id: url,
        name,
        priceCents: off.cents,
        currency: 'EUR',
        image: safeUrl(firstImage(node.image)),
        url,
        colorRaw: typeof node.color === 'string' ? clean(node.color, 40) : '',
        outOfStock: off.outOfStock,
        sizes: null,
        source: 'jsonld'
      }
    };
  }

  /* --------------------- Tarjetas visibles del catálogo --------------------- */
  function hrefOf(a) {
    const raw = a.getAttribute('href');
    if (!raw || BAD_HREF.test(raw.trim())) return null;
    const u = safeUrl(raw);
    if (!u) return null;
    const path = new URL(u).pathname;
    if (NON_PRODUCT_PATH.test(path)) return null;
    return u;
  }

  function distinctPaths(root) {
    const set = new Set();
    root.querySelectorAll('a[href]').forEach((a) => {
      const u = hrefOf(a);
      if (u) set.add(new URL(u).pathname);
    });
    return set;
  }

  function isOldPrice(el, card) {
    for (let n = el; n && n !== card.parentElement; n = n.parentElement) {
      if (/^(?:DEL|S|STRIKE)$/.test(n.tagName)) return true;
      const cls = (n.getAttribute('class') || '') + ' ' + (n.getAttribute('data-qa-anchor') || '');
      if (OLD_CLASS.test(cls) && !NEW_CLASS.test(cls)) return true;
      const st = (n.style && n.style.textDecoration) || n.getAttribute('style') || '';
      if (/line-through/i.test(st)) return true;
    }
    return false;
  }

  function findCard(el) {
    let best = null;
    let cur = el.parentElement;
    for (let level = 0; cur && cur !== document.body && level < 7; level++, cur = cur.parentElement) {
      const paths = distinctPaths(cur);
      if (paths.size > 1) break;
      if (paths.size === 1 && cur.querySelector('img')) best = cur;
    }
    return best;
  }

  const stripPrices = (t) => t.replace(/\d[\d.,\s]*\s?(?:€|eur\b)/gi, '').replace(/\s+/g, ' ').trim();

  function cardName(card, link) {
    // El alt de la imagen va el último: muchas tiendas (p. ej. Bershka) ponen en él la descripción
    // del look completo («Conjunto de camiseta negra, sudadera y chaqueta»), no el nombre del producto.
    const cands = [link.getAttribute('title'), link.getAttribute('aria-label')];
    const h = card.querySelector('h1,h2,h3,h4,h5');
    if (h) cands.push(h.textContent);
    const ne = card.querySelector('[class*="name" i],[class*="title" i],[data-qa-anchor*="name" i]');
    if (ne) cands.push(ne.textContent);
    cands.push(link.textContent);
    // Otros enlaces de la tarjeta al mismo producto (p. ej. el que rodea la imagen no tiene texto, el del título sí).
    const href = hrefOf(link);
    card.querySelectorAll('a[href]').forEach((a) => {
      if (a !== link && hrefOf(a) === href) cands.push(a.getAttribute('title'), a.getAttribute('aria-label'), a.textContent);
    });
    const img = card.querySelector('img');
    if (img) cands.push(img.getAttribute('alt'));
    for (const c of cands) {
      const t = stripPrices(clean(c, 200)).slice(0, 140);
      if (t.length >= 3 && !/^\d+$/.test(t) && !Core.parsePrice(t) && !Core.isLookDescription(t)) return t;
    }
    return Core.nameFromUrl(hrefOf(link));
  }

  function cardImage(card) {
    const img = card.querySelector('img');
    if (!img) return null;
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const cands = [img.getAttribute('src'), img.currentSrc, img.getAttribute('data-src'), img.getAttribute('data-original'), img.getAttribute('data-lazy-src'), srcset.split(',')[0].trim().split(' ')[0]];
    for (const c of cands) {
      if (c && !/^data:/i.test(c)) {
        const u = safeUrl(c);
        if (u) return u;
      }
    }
    return null;
  }

  function isPriceCandidate(el) {
    if (/^(?:SCRIPT|STYLE|NOSCRIPT|SVG|HEAD)$/i.test(el.tagName)) return false;
    for (const ch of el.children) if (ch.children.length) return false; // como mucho un nivel de spans
    const t = clean(el.textContent, 40);
    return t.length >= 2 && t.length <= 30;
  }

  function extractCards(skipUrl, stats) {
    const cards = new Map();
    document.body.querySelectorAll('*').forEach((el) => {
      if (!isPriceCandidate(el)) return;
      const pr = Core.parsePrice(clean(el.textContent, 40));
      if (!pr || el.closest('[hidden]')) return;
      const card = findCard(el);
      if (!card) return;
      if (!cards.has(card)) cards.set(card, []);
      cards.get(card).push({ pr, old: isOldPrice(el, card) });
    });

    const out = [];
    for (const [card, prices] of cards) {
      if (out.length >= MAX_CARDS) break;
      const current = prices.filter((x) => !x.old);
      const eur = new Set(current.filter((x) => x.pr.kind === 'eur').map((x) => x.pr.cents));
      const hasOther = current.some((x) => x.pr.kind === 'other');
      if (!current.length) {
        stats.noPrice++;
        continue;
      }
      if (hasOther && !eur.size) {
        stats.nonEur++;
        continue;
      }
      if (hasOther || eur.size !== 1) {
        stats.ambiguous++;
        continue;
      }
      let link = null;
      for (const a of card.querySelectorAll('a[href]')) {
        if (hrefOf(a)) {
          link = a;
          break;
        }
      }
      if (!link) continue;
      const url = hrefOf(link);
      if (!url || url === skipUrl) continue;
      const name = cardName(card, link);
      if (!name) {
        stats.noName++;
        continue;
      }
      out.push({
        id: url,
        name,
        priceCents: Array.from(eur)[0],
        currency: 'EUR',
        image: cardImage(card),
        url,
        colorRaw: '',
        outOfStock: false,
        sizes: null,
        source: 'card'
      });
    }
    return out;
  }

  /* ------------------------ Secciones y desplazamiento ------------------------ */
  // Enlaces candidatos a «sección» (menú, categorías). La decisión de cuáles sirven la toma Core.rankSectionLinks.
  function collectSectionLinks() {
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      if (out.length >= 600) return;
      const raw = a.getAttribute('href');
      if (!raw || BAD_HREF.test(raw.trim())) return;
      const href = safeUrl(raw);
      if (!href) return;
      out.push({ href, text: clean(a.textContent || a.getAttribute('aria-label') || '', 80), inNav: !!a.closest('nav,header,[role="navigation"],[class*="menu" i],[class*="nav" i]') });
    });
    return out;
  }

  function sections(categories, exclude) {
    try {
      return { ok: true, sections: Core.rankSectionLinks(collectSectionLinks(), { pageUrl: location.href, categories, exclude, perCategory: 1 }) };
    } catch (e) {
      return { ok: false, message: String(e && e.message ? e.message : e) };
    }
  }

  // Desplaza hasta el final varias veces para que la tienda cargue más productos (carga diferida).
  async function scrollAll(maxRounds, pauseMs) {
    const rounds = maxRounds || 6;
    const pause = pauseMs || 700;
    let lastH = -1;
    for (let i = 0; i < rounds; i++) {
      const h = document.documentElement.scrollHeight;
      window.scrollTo(0, h);
      await new Promise((r) => setTimeout(r, pause));
      if (h === lastH && i >= 2) break;
      lastH = h;
    }
    window.scrollTo(0, 0);
    return true;
  }

  /* ----------------------- Añadir a la cesta (ficha) ----------------------- */
  // Automatiza lo que haría una persona en la ficha: elegir su talla y pulsar «Añadir a la cesta».
  // Este script SOLO hace los clics y devuelve lo que hizo; NO decide si la tienda lo añadió ni cierra nada:
  // la confirmación la hace el panel con lo que observa después (peticiones, cesta real).
  // Nunca elige una talla por su cuenta: si falta la talla preferida o no está, devuelve un código y no pulsa nada.
  const ADD_TEXT = /^(?:anadir|agregar|add)\b.*(?:cesta|bolsa|carrito|bag|cart|basket)/;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CART_PATH = /(?:cart|carrito|cesta|basket|bolsa|\bbag\b|checkout|\border)/i;

  async function waitFor(fn, timeoutMs, stepMs) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      let v = null;
      try {
        v = fn();
      } catch (e) {
        v = null;
      }
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(stepMs || 150);
    }
  }

  // Clic lo más parecido al de una persona (puntero, ratón y clic), por si la tienda no escucha solo «click».
  function realClick(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (e) {
      /* sin scroll */
    }
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2), button: 0 };
    const fire = (Ctor, type, extra) => {
      try {
        el.dispatchEvent(new Ctor(type, Object.assign({}, base, extra || {})));
      } catch (e) {
        /* tipo de evento no disponible */
      }
    };
    if (typeof PointerEvent === 'function') fire(PointerEvent, 'pointerdown', { pointerType: 'mouse', isPrimary: true, buttons: 1 });
    fire(MouseEvent, 'mousedown', { buttons: 1 });
    if (typeof PointerEvent === 'function') fire(PointerEvent, 'pointerup', { pointerType: 'mouse', isPrimary: true });
    fire(MouseEvent, 'mouseup');
    fire(MouseEvent, 'click');
  }

  const describeEl = (e) => {
    if (!e) return '';
    return (e.tagName || '').toLowerCase() + (e.id ? '#' + clean(e.id, 30) : '') + ' «' + clean(e.textContent || e.value || e.getAttribute('aria-label') || '', 30) + '»';
  };

  function findAddButton() {
    const els = document.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]');
    for (const e of els) {
      const t = Core.normalize(clean(e.textContent || e.value || e.getAttribute('aria-label') || '', 60));
      if (ADD_TEXT.test(t)) return e;
    }
    return document.querySelector('[data-qa-anchor*="addtocart" i],[data-qa-anchor*="add-to-cart" i],[data-qa-anchor*="addtobag" i]');
  }

  const isDisabled = (e) => !!e && (e.disabled === true || e.getAttribute('aria-disabled') === 'true');

  function findSizeEls() {
    const list = [];
    document.querySelectorAll(SIZE_SEL).forEach((el) => {
      const label = clean(el.textContent, 12);
      if (!SIZE_RE.test(label)) return;
      const cls = (el.getAttribute('class') || '') + ' ' + (el.parentElement ? el.parentElement.getAttribute('class') || '' : '');
      const off = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || /disabled|unavailable|sold|agotad|out-of-stock|outofstock|no-stock/i.test(cls);
      list.push({ el, label, off });
    });
    return list;
  }

  // «Huella» de la cesta: texto de los elementos de cesta/bolsa y aviso de producto añadido.
  // Es un indicio débil (puede cambiar por cualquier motivo): solo cuenta como «probable», nunca como confirmación.
  function cartSignal() {
    const bits = [];
    document.querySelectorAll('[class*="cart" i],[class*="bag" i],[class*="basket" i],[class*="cesta" i],[data-qa-anchor*="cart" i],[data-qa-anchor*="bag" i]').forEach((e) => {
      if (bits.length < 30) bits.push(clean(e.textContent, 60));
    });
    const body = clean((document.body && document.body.textContent) || '', 200000);
    return bits.join('|') + '#' + (/(?:a[ñn]adid[oa]\s+a\s+(?:la\s+)?(?:cesta|bolsa|carrito)|added to (?:your )?(?:bag|cart|basket))/i.test(body) ? 'added' : '');
  }

  function findCartUrl() {
    let best = null;
    document.querySelectorAll('a[href]').forEach((a) => {
      const u = safeUrl(a.getAttribute('href'));
      if (!u) return;
      const x = new URL(u);
      if (x.origin !== location.origin || !/(carrito|cesta|\/cart|\/bag|basket|\/bolsa)/i.test(x.pathname)) return;
      if (!best || x.pathname.length < new URL(best).pathname.length) best = u;
    });
    return best;
  }

  function pickSize(target) {
    const sizes = findSizeEls();
    if (!sizes.length) return { state: 'none' };
    if (target === null || target === undefined || target === '') return { state: 'needs_size' };
    const hit = sizes.find((x) => Core.sameSize(x.label, target));
    if (!hit) return { state: 'size_missing' };
    if (hit.off) return { state: 'size_unavailable' };
    realClick(hit.el);
    return { state: 'picked', label: hit.label };
  }

  // Peticiones fetch/XHR de la página desde un instante (Resource Timing). No da el método, pero sí la ruta y,
  // en Chrome ≥ 109, el estado cuando el navegador lo expone.
  function perfEntries(sincePerf) {
    const out = [];
    try {
      for (const e of performance.getEntriesByType('resource')) {
        if (e.startTime < sincePerf || !/^(?:fetch|xmlhttprequest|beacon)$/.test(e.initiatorType)) continue;
        let url = '';
        try {
          const u = new URL(e.name);
          url = u.origin + u.pathname;
        } catch (err) {
          continue;
        }
        out.push({ url: url.slice(0, 160), kind: e.initiatorType, status: Number.isInteger(e.responseStatus) && e.responseStatus > 0 ? e.responseStatus : null, done: true });
      }
    } catch (e) {
      /* sin Resource Timing */
    }
    return out.slice(-40);
  }

  const addState = { before: null, perfT0: 0 };

  // Prepara y pulsa. Devuelve {ok:true, size, button, steps, cartUrl} o {ok:false, code, steps}.
  async function addStart(target, opts) {
    const o = opts || {};
    const pause = o.pauseMs == null ? 600 : o.pauseMs;
    const waitMs = o.waitMs == null ? 8000 : o.waitMs;
    const steps = [];
    try {
      addState.before = cartSignal();
      // 1) Esperar a que la ficha esté pintada (las tiendas SPA tardan): botón o tallas.
      const ready = await waitFor(() => findAddButton() || findSizeEls().length, waitMs);
      if (!ready) return { ok: false, code: 'no_button', steps: ['La ficha no mostró ni botón de añadir ni tallas en ' + waitMs / 1000 + ' s'] };
      const first = pickSize(target);
      if (['needs_size', 'size_missing', 'size_unavailable'].includes(first.state)) return { ok: false, code: first.state, steps };
      if (first.state === 'picked') {
        steps.push('Talla elegida: ' + first.label);
        await sleep(pause);
      } else {
        steps.push('La ficha no muestra tallas antes de pulsar «Añadir»');
      }
      // 2) Botón de añadir (puede activarse al elegir talla).
      let btn = await waitFor(() => {
        const b = findAddButton();
        return b && !isDisabled(b) ? b : null;
      }, 3000);
      if (!btn) {
        const any = findAddButton();
        return { ok: false, code: any ? 'button_disabled' : 'no_button', steps };
      }
      addState.perfT0 = performance.now();
      realClick(btn);
      steps.push('Pulsado ' + describeEl(btn));
      await sleep(pause);
      // 3) Si no había tallas, muchas tiendas las piden en un panel que aparece al pulsar «Añadir».
      if (first.state === 'none') {
        const late = await waitFor(() => findSizeEls().length, Math.min(waitMs, 5000));
        if (late) {
          const second = pickSize(target);
          if (['needs_size', 'size_missing', 'size_unavailable'].includes(second.state)) return { ok: false, code: second.state, steps, clicked: true };
          steps.push('Panel de tallas apareció; talla elegida: ' + second.label);
          await sleep(Math.max(pause, 1500));
          // Si elegir la talla ya añadió el producto (petición de cesta vista), NO se pulsa otra vez: evita duplicados.
          // Sin el observador de red no se puede descartar un duplicado, así que tampoco se pulsa.
          const root = document.documentElement;
          const probeOn = root.getAttribute('data-outfitai-probe') === '1';
          const already = Number(root.getAttribute('data-outfitai-req') || 0) > 0 || perfEntries(addState.perfT0 - 50).some((e) => CART_PATH.test(e.url));
          if (already) {
            steps.push('Elegir la talla ya lanzó una petición de cesta: no se pulsa «Añadir» otra vez');
          } else if (!probeOn) {
            steps.push('Sin observador de red no puedo descartar un duplicado: no pulso «Añadir» otra vez');
          } else {
            const again = findAddButton();
            if (again && !isDisabled(again)) {
              realClick(again);
              steps.push('Pulsado de nuevo ' + describeEl(again));
            }
          }
        } else {
          steps.push('No apareció ningún panel de tallas tras pulsar');
        }
      }
      return { ok: true, size: first.state === 'picked' ? first.label : null, button: describeEl(btn), steps, cartUrl: findCartUrl() };
    } catch (e) {
      return { ok: false, code: 'exception', message: String(e && e.message ? e.message : e), steps };
    }
  }

  // Indicios posteriores al clic, para que el panel decida (con Core.classifyAddOutcome).
  function addSignals() {
    return { domChanged: addState.before !== null && cartSignal() !== addState.before, perf: perfEntries(addState.perfT0 - 50) };
  }

  // Lectura de la cesta real: enlaces (para reconocer productos por su identificador) y texto. Datos no confiables:
  // solo se comparan, nunca se insertan como HTML.
  function readCart() {
    const links = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      if (links.length >= 400) return;
      const u = safeUrl(a.getAttribute('href'));
      if (u) links.push(u);
    });
    return { ok: true, url: location.href, links, text: clean((document.body && document.body.textContent) || '', 60000) };
  }

  /* ------------------------------ Principal ------------------------------ */
  function extract() {
    try {
      const store = Core.detectStore(location.hostname);
      const stats = { jsonld: 0, cards: 0, nonEur: 0, unknownCurrency: 0, ambiguous: 0, noPrice: 0, noName: 0, noUrl: 0, outOfStock: 0 };
      const found = new Map();
      const add = (p) => {
        if (p && !found.has(p.id)) found.set(p.id, p);
      };

      const ld = readJsonLd();
      stats.jsonld = ld.length;
      let ldValid = 0;
      for (const node of ld) {
        const r = jsonldToProduct(node, ld.length === 1);
        if (r.skip) {
          stats[r.skip]++;
          continue;
        }
        if (r.product.outOfStock) stats.outOfStock++;
        ldValid++;
        add(r.product);
      }

      const og = document.querySelector('meta[property="og:type"]');
      const ogProduct = !!(og && /product/i.test(og.getAttribute('content') || ''));
      let pageType = 'unknown';
      if (ldValid === 1 && (ogProduct || ld.length === 1)) {
        pageType = 'product';
        const only = Array.from(found.values())[0];
        only.sizes = sizesFromDom();
      }

      if (!(ldValid >= 2 || (ldValid === 1 && ogProduct))) {
        const skip = pageType === 'product' ? Array.from(found.values())[0].url : location.href;
        for (const p of extractCards(skip, stats)) add(p);
        stats.cards = Array.from(found.values()).filter((p) => p.source === 'card').length;
        if (stats.cards >= 2 && pageType === 'unknown') pageType = 'catalog';
      } else if (ldValid >= 2) {
        pageType = 'catalog';
      }

      const adapter = ADAPTERS[store.id];
      if (adapter && typeof adapter.extract === 'function') {
        try {
          for (const p of adapter.extract(document) || []) add(p);
        } catch (e) {
          /* un adaptador defectuoso no debe romper la extracción genérica */
        }
      }

      const h1 = document.querySelector('h1');
      return {
        ok: true,
        store,
        pageUrl: location.href,
        pageType,
        pageCategoryText: [h1 ? clean(h1.textContent, 120) : '', clean(document.title, 120), decodeURIComponentSafe(location.pathname)].join(' '),
        products: Array.from(found.values()),
        stats
      };
    } catch (e) {
      return { ok: false, code: 'exception', message: String(e && e.message ? e.message : e) };
    }
  }

  function decodeURIComponentSafe(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  globalThis.__outfitaiExtract = extract;
  globalThis.__outfitaiSections = sections;
  globalThis.__outfitaiScroll = scrollAll;
  globalThis.__outfitaiAddStart = addStart;
  globalThis.__outfitaiAddSignals = addSignals;
  globalThis.__outfitaiReadCart = readCart;
})();
