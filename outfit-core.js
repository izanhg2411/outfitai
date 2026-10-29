'use strict';
/*
 * OutfitCore — lógica pura (sin DOM, sin red) compartida por el popup y el content script.
 * También se puede cargar en Node para las pruebas (module.exports).
 * Todos los importes se manejan en CÉNTIMOS ENTEROS para evitar errores de coma flotante.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OutfitCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CATEGORIES = ['camiseta', 'sudadera', 'pantalon', 'chaqueta', 'zapatillas', 'accesorio'];
  const CATEGORY_LABELS = {
    camiseta: 'Camiseta',
    sudadera: 'Sudadera / jersey',
    pantalon: 'Pantalón',
    chaqueta: 'Chaqueta',
    zapatillas: 'Zapatillas',
    accesorio: 'Accesorio'
  };
  // Si no cabe todo en el presupuesto, se descartan primero las prendas de la izquierda.
  const DROP_ORDER = ['accesorio', 'chaqueta', 'sudadera', 'zapatillas', 'pantalon', 'camiseta'];

  const re = (src) => new RegExp('(?:^|[^a-z0-9])(?:' + src + ')');

  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[-_/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------------------------- Categorías ---------------------------- */
  const CAT_RE = {
    camiseta: re('camiseta|camisa|polo\\b|polos\\b|t ?shirt|tee\\b|top\\b|tops\\b|body\\b|blusa|shirt\\b'),
    sudadera: re('sudadera|hoodie|sweatshirt|jersey|sueter|sweater|cardigan|punto\\b|forro polar|fleece'),
    pantalon: re('pantalon|vaquero\\b|vaqueros\\b|jeans\\b|jogger|bermuda|short\\b|shorts\\b|chino\\b|chinos\\b|trouser|pants\\b|legging'),
    chaqueta: re('chaqueta|cazadora|abrigo|parka|bomber|blazer|americana|anorak|plumifero|plumas|jacket|coat\\b|chaleco|gabardina|trench|windbreaker|cortavientos|sobrecamisa|overshirt'),
    zapatillas: re('zapatilla|sneaker|trainer|deportivas?\\b|bambas|tenis\\b'),
    accesorio: re('gorra|gorro|cap\\b|beanie|cinturon|bolso|mochila|rinonera|calcetin|bufanda|guantes|gafas|sunglasses|belt\\b|bag\\b|socks\\b|cartera|panuelo|sombrero|bucket|pulsera|reloj|llavero|tote')
  };

  function categoryMatches(text) {
    const t = normalize(text);
    const found = [];
    for (const c of CATEGORIES) {
      const m = CAT_RE[c].exec(t);
      if (m) found.push({ c, i: m.index });
    }
    return found;
  }
  function classifyCategory(text) {
    const found = categoryMatches(text);
    if (!found.length) return null;
    found.sort((a, b) => a.i - b.i);
    return found[0].c;
  }
  // Solo devuelve categoría si el texto menciona exactamente una (para títulos de página).
  function classifyUnique(text) {
    const found = categoryMatches(text);
    return found.length === 1 ? found[0].c : null;
  }

  /* ------------------------------ Colores ------------------------------ */
  const COLORS = {
    negro: 'negr[oa]s?\\b|black|noir',
    blanco: 'blanc[oa]s?\\b|white|crudo|ecru|off ?white|hueso',
    gris: 'gris|grey|gray|antracita|charcoal|plomo',
    beige: 'beige|arena|crema|camel|sand\\b|stone\\b|taupe|nude\\b|tostado|piedra',
    marino: '(?:azul )?marino|navy',
    azul: 'azul(?! marino)|blue\\b|celeste|turquesa|indigo',
    denim: 'denim|vaquer[oa]|lavado',
    marron: 'marron|brown|chocolate|cafe\\b|tabaco|cuero',
    verde: 'verde|green|khaki|caqui|oliva|olive|menta|botella',
    rojo: 'roj[oa]s?\\b|red\\b|burdeos|granate|vino\\b|bordeaux|maroon',
    amarillo: 'amarill[oa]s?\\b|yellow|mostaza|mustard|lima\\b',
    naranja: 'naranja|orange|coral|teja',
    rosa: 'rosa\\b|rosado|pink|fucsia|magenta',
    morado: 'morad[oa]s?\\b|purple|lila\\b|lavanda|violeta'
  };
  const COLOR_RE = {};
  for (const k of Object.keys(COLORS)) COLOR_RE[k] = re(COLORS[k]);
  const NEUTRALS = ['negro', 'blanco', 'gris', 'beige', 'marino', 'denim', 'marron'];

  function detectColor(text) {
    const t = normalize(text);
    if (!t) return null;
    let best = null;
    let bi = Infinity;
    for (const k of Object.keys(COLOR_RE)) {
      const m = COLOR_RE[k].exec(t);
      if (m && m.index < bi) {
        bi = m.index;
        best = k;
      }
    }
    return best;
  }

  /* ------------------------------ Estilos ------------------------------ */
  const STYLES = {
    streetwear: {
      label: 'Streetwear',
      kw: ['oversize', 'graphic', 'estampad', 'print', 'baggy', 'wide', 'ancho', 'jogger', 'skate', 'cargo', 'hoodie', 'sudadera', 'bomber', 'logo', 'washed', 'distressed', 'destroyed', 'boxy', 'varsity', 'patch'],
      colors: ['negro', 'gris', 'blanco', 'beige', 'verde']
    },
    casual: {
      label: 'Casual',
      kw: ['basic', 'basico', 'algodon', 'cotton', 'regular', 'slim', 'vaquer', 'jeans', 'chino', 'polo', 'liso', 'rayas', 'stripe', 'henley'],
      colors: ['negro', 'blanco', 'gris', 'marino', 'denim', 'beige']
    },
    minimalista: {
      label: 'Minimalista',
      kw: ['basic', 'basico', 'liso', 'plain', 'simple', 'recto', 'straight', 'essential', 'esencial', 'clean', 'rib', 'sin estampado'],
      colors: ['negro', 'blanco', 'gris', 'beige']
    },
    deportivo: {
      label: 'Deportivo',
      kw: ['sport', 'deportiv', 'running', 'training', 'entrenamiento', 'gym', 'jogger', 'chandal', 'track', 'dry', 'transpirable', 'mesh', 'nylon', 'sneaker', 'zapatilla', 'cortavientos', 'windbreaker'],
      colors: ['negro', 'gris', 'blanco', 'azul']
    },
    elegante: {
      label: 'Elegante',
      kw: ['elegant', 'vestir', 'sastre', 'blazer', 'americana', 'camisa', 'pinza', 'pleat', 'lana', 'wool', 'satin', 'seda', 'mocasin', 'formal', 'traje', 'plisad', 'oxford', 'popelin', 'poplin'],
      colors: ['negro', 'blanco', 'gris', 'marino', 'beige']
    },
    oldmoney: {
      label: 'Old money',
      kw: ['lino', 'linen', 'polo', 'punto', 'cardigan', 'cable', 'trenzad', 'rayas', 'stripe', 'nautic', 'chino', 'pinza', 'pleat', 'camisa', 'oxford', 'mocasin', 'lana', 'wool', 'tweed', 'cashmere', 'blazer', 'americana', 'rugby', 'loafer'],
      colors: ['marino', 'beige', 'blanco', 'verde', 'marron', 'gris']
    },
    oversize: {
      label: 'Oversize',
      kw: ['oversize', 'amplio', 'ancho', 'baggy', 'boxy', 'relaxed', 'loose', 'wide', 'holgad', 'extragrande'],
      colors: []
    },
    y2k: {
      label: 'Y2K',
      kw: ['y2k', 'baby', 'tie ?dye', 'rhinestone', 'strass', 'brillo', 'glitter', 'low ?rise', 'tiro bajo', 'flare', 'campana', 'metalizad', 'mariposa', 'butterfly', 'parachute', 'paraca', 'denim', 'mini', 'crop', 'velour', 'terciopelo', 'trucker'],
      colors: ['rosa', 'morado', 'azul', 'blanco', 'denim']
    },
    techwear: {
      label: 'Techwear',
      kw: ['tech', 'tecnic', 'nylon', 'nailon', 'utility', 'utilitari', 'bolsillo', 'pocket', 'impermeable', 'waterproof', 'parachute', 'paraca', 'shell', 'windbreaker', 'cortavientos', 'cargo', 'strap', 'correa', 'cremallera', 'ripstop', 'technical', 'softshell'],
      colors: ['negro', 'gris', 'verde']
    }
  };
  for (const k of Object.keys(STYLES)) STYLES[k].re = STYLES[k].kw.map(re);

  /* ------------------------- Precios (solo EUR) ------------------------- */
  // Convierte "1.299,00", "15,99", "15.99", "29" en número. Devuelve null si no es fiable.
  function parseAmount(raw) {
    const s = String(raw).replace(/\s/g, '').replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    let dec = null;
    if (lastDot > -1 && lastComma > -1) {
      dec = lastDot > lastComma ? '.' : ',';
    } else if (lastDot > -1 || lastComma > -1) {
      const sep = lastDot > -1 ? '.' : ',';
      const parts = s.split(sep);
      if (parts.length > 2) dec = null;
      else dec = parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3 ? null : sep;
    }
    let intPart;
    let frac = '';
    if (dec) {
      const i = s.lastIndexOf(dec);
      intPart = s.slice(0, i).replace(/[.,]/g, '');
      frac = s.slice(i + 1).replace(/[.,]/g, '');
    } else {
      intPart = s.replace(/[.,]/g, '');
    }
    if (frac.length > 2) return null;
    const v = parseFloat((intPart || '0') + (frac ? '.' + frac : ''));
    return Number.isFinite(v) ? v : null;
  }

  const OTHER_CUR = /[$£¥₽₺]|\b(?:usd|gbp|chf|pln|sek|nok|dkk|czk|huf|ron|bgn|try|mxn|cad|aud|jpy|cny|inr|brl)\b|\bkr\b|\bzl\b|\blei\b/i;

  // Texto que ES un precio (todo el texto). Devuelve {kind:'eur',cents} | {kind:'other'} | null.
  function parsePrice(text) {
    if (text == null) return null;
    const t = String(text).replace(/ /g, ' ').trim();
    if (!t || t.length > 30) return null;
    const hasEur = /€|\beur\b/i.test(t);
    const hasOther = OTHER_CUR.test(t);
    if (!hasEur && !hasOther) return null;
    const rest = t
      .replace(/€|\beur\b/gi, '')
      .replace(OTHER_CUR, '')
      .replace(/^(?:desde|from|a partir de)\s*/i, '')
      .trim();
    if (!/^\d[\d.,\s]*$/.test(rest)) return null;
    if (/\s/.test(rest) && !/^\d{1,3}(?:\s\d{3})+(?:[.,]\d{1,2})?$/.test(rest)) return null;
    if (hasOther) return { kind: 'other' };
    const v = parseAmount(rest);
    if (v == null || !(v > 0) || v >= 100000) return null;
    return { kind: 'eur', cents: Math.round(v * 100) };
  }

  function formatEuro(cents) {
    const neg = cents < 0;
    const abs = Math.abs(Math.round(cents));
    const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const dec = String(abs % 100).padStart(2, '0');
    return (neg ? '-' : '') + whole + ',' + dec + ' €';
  }

  /* ------------------------------ Tiendas ------------------------------ */
  const STORES = [
    { id: 'bershka', name: 'Bershka', host: /(^|\.)bershka\.com$/ },
    { id: 'zara', name: 'Zara', host: /(^|\.)zara\.com$/ },
    { id: 'pullandbear', name: 'Pull&Bear', host: /(^|\.)pullandbear\.com$/ },
    { id: 'stradivarius', name: 'Stradivarius', host: /(^|\.)stradivarius\.com$/ },
    { id: 'hm', name: 'H&M', host: /(^|\.)hm\.com$/ },
    { id: 'asos', name: 'ASOS', host: /(^|\.)asos\.com$/ },
    { id: 'massimodutti', name: 'Massimo Dutti', host: /(^|\.)massimodutti\.com$/ },
    { id: 'mango', name: 'Mango', host: /(^|\.)mango\.com$/ }
  ];
  const STORE_LIST = STORES.map((s) => ({ id: s.id, name: s.name, domain: s.host.source.replace(/^\(\^\|\\\.\)/, '').replace(/\$$/, '').replace(/\\\./g, '.') }));
  function detectStore(hostname) {
    const h = String(hostname || '').toLowerCase();
    for (const s of STORES) if (s.host.test(h)) return { id: s.id, name: s.name, known: true, host: h };
    return { id: 'generic', name: h || 'Tienda', known: false, host: h };
  }

  function urlText(url) {
    try {
      return decodeURIComponent(new URL(url).pathname);
    } catch (e) {
      return '';
    }
  }

  // Nombre legible a partir del slug de la URL (p. ej. /es/pantalon-cargo-negro-c0p123.html).
  function nameFromUrl(url) {
    try {
      const seg = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean).pop() || '';
      const t = seg
        .replace(/\.(?:html?|php|aspx?)$/i, '')
        .replace(/[-_]c\d+p\d+$/i, '')
        .replace(/[-_]p?\d{5,}$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return t.length >= 3 && /[a-z]/i.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : null;
    } catch (e) {
      return null;
    }
  }

  // Un texto que nombra varias categorías a la vez («Conjunto de camiseta, sudadera y chaqueta»)
  // describe un look completo, no un producto.
  const LOOK_RE = /(?:^|[^a-z0-9])(?:conjunto|look|outfit|set|pack|combinacion|total look)(?:$|[^a-z0-9])/;
  function isLookDescription(text) {
    const t = normalize(text);
    if (!t) return false;
    return categoryMatches(t).length >= 2 || (LOOK_RE.test(t) && categoryMatches(t).length >= 1);
  }

  // Añade categoría y color a un producto crudo extraído de la página.
  // hintCategory: categoría de la sección que se estaba leyendo (último recurso).
  function enrichProduct(raw, pageCategoryText, hintCategory) {
    const p = Object.assign({}, raw);
    const urlTxt = urlText(raw.url);
    let cat = classifyUnique(raw.name);
    let src = cat ? 'nombre' : null;
    if (!cat) {
      // Nombre ausente o ambiguo (varias categorías): la URL del producto es más fiable.
      cat = classifyUnique(urlTxt) || (isLookDescription(raw.name) ? null : classifyCategory(raw.name)) || classifyCategory(urlTxt);
      if (cat) src = 'nombre';
    }
    if (!cat && pageCategoryText) {
      cat = classifyUnique(pageCategoryText);
      if (cat) src = 'pagina';
    }
    if (!cat && hintCategory && CATEGORIES.includes(hintCategory)) {
      cat = hintCategory;
      src = 'pagina';
    }
    p.category = cat;
    p.categorySource = src;
    p.color = detectColor(raw.colorRaw || '') || detectColor(raw.name) || detectColor(urlTxt);
    return p;
  }

  /* ------------------- Recogida automática de secciones ------------------- */
  const MIN_PER_CATEGORY = 3;

  // Categorías deseadas de las que aún hay pocos productos válidos en el pool.
  function missingCategories(products, prefs, min) {
    const need = min || MIN_PER_CATEGORY;
    const count = {};
    for (const p of products || []) {
      if (isValidProduct(p) && p.category) count[p.category] = (count[p.category] || 0) + 1;
    }
    return (prefs.wanted || []).filter((c) => CATEGORIES.includes(c) && (count[c] || 0) < need);
  }

  // Elige, por categoría, los enlaces de sección más probables entre los enlaces de la página.
  // links: [{href, text, inNav}]. Devuelve [{category, url, label}] (como mucho `perCategory` por categoría).
  function rankSectionLinks(links, opts) {
    const o = opts || {};
    const cats = o.categories || [];
    let page;
    try {
      page = new URL(o.pageUrl);
    } catch (e) {
      return [];
    }
    const exclude = new Set(o.exclude || []);
    const pageSegs = page.pathname.split('/').filter(Boolean);
    const best = {};
    for (const l of links || []) {
      let u;
      try {
        u = new URL(l.href, page.href);
      } catch (e) {
        continue;
      }
      if (u.origin !== page.origin || (u.protocol !== 'https:' && u.protocol !== 'http:')) continue;
      u.hash = '';
      if (u.href === page.href || exclude.has(u.href)) continue;
      if (/(cart|carrito|cesta|wishlist|favorit|login|account|cuenta|checkout|basket|help|ayuda|stores?|tiendas?)/i.test(u.pathname)) continue;
      const label = String(l.text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (/\d\s?(?:€|eur)/i.test(label)) continue; // enlaces con precio = productos, no secciones
      const path = decodeURIComponent(u.pathname);
      // Una sección se reconoce por su texto visible (corto y de una sola categoría) o por el último tramo de la ruta.
      const byText = label && label.length <= 40 ? classifyUnique(label) : null;
      const segs = path.split('/').filter(Boolean);
      const last = segs[segs.length - 1] || '';
      const byPath = classifyUnique(last);
      const cat = byText || byPath;
      if (!cat || !cats.includes(cat)) continue;
      if (byText && byPath && byText !== byPath) continue;
      // Una ficha de producto suele acabar en un identificador largo: no es una sección.
      if (/(?:[-_]c?\d+p\d+|[-_]p?\d{6,})(?:\.html?)?$/i.test(last) || /\/p\/|\/producto|\/product/i.test(path)) continue;
      let score = 0;
      if (l.inNav) score += 3;
      if (byText && byPath) score += 2;
      let shared = 0;
      while (shared < segs.length && shared < pageSegs.length && segs[shared] === pageSegs[shared]) shared++;
      score += Math.min(shared, 2) * 2; // misma tienda/idioma/sección de género
      score -= Math.max(0, segs.length - 4) * 0.5;
      const key = cat;
      const list = (best[key] = best[key] || new Map());
      const prev = list.get(u.href);
      if (!prev || prev.score < score) list.set(u.href, { category: cat, url: u.href, label: label || last, score });
    }
    const per = o.perCategory || 1;
    const out = [];
    for (const c of cats) {
      if (!best[c]) continue;
      const arr = Array.from(best[c].values()).sort((a, b) => b.score - a.score || a.url.length - b.url.length);
      for (const x of arr.slice(0, per)) out.push({ category: x.category, url: x.url, label: x.label });
    }
    return out;
  }

  /* ----------------- Añadir a la cesta: confirmación y comprobación ----------------- */
  // Nada de esto conoce los endpoints de ninguna tienda: solo interpreta lo que la propia página hizo
  // (peticiones observadas tras el clic) y lo que la cesta real muestra al final.
  const CART_PATH_RE = /(?:cart|carrito|cesta|basket|bolsa|\bbag\b|checkout|\border)/i;
  const WRITE_METHODS = ['POST', 'PUT', 'PATCH'];

  function isCartRequest(entry) {
    if (!entry || typeof entry.url !== 'string') return false;
    let path = entry.url;
    try {
      path = new URL(entry.url).pathname;
    } catch (e) {
      /* ya es una ruta */
    }
    return CART_PATH_RE.test(path);
  }

  const okStatus = (s) => Number.isInteger(s) && s >= 200 && s < 300;

  // Resume qué se observó tras pulsar «Añadir» y decide el resultado SIN fiarse solo del texto de la página.
  //  confirmed   → una petición de escritura (POST/PUT/PATCH) a una ruta de cesta terminó con 2xx
  //  rejected    → esa petición terminó con error (4xx/5xx o fallo de red): la tienda NO lo añadió
  //  probable    → hay indicios (petición de cesta 2xx sin método conocido, o cambió el texto de la cesta), sin prueba
  //  unconfirmed → no se observó nada
  //  pending     → hay peticiones de cesta aún sin terminar
  function classifyAddOutcome(sig) {
    const s = sig || {};
    const net = Array.isArray(s.net) ? s.net : [];
    const perf = Array.isArray(s.perf) ? s.perf : [];
    const writes = net.filter((e) => WRITE_METHODS.includes(String(e.method || '').toUpperCase()) && isCartRequest(e));
    if (writes.some((e) => e.done && okStatus(e.status))) return { state: 'confirmed', via: 'red', detail: describeEntry(writes.find((e) => e.done && okStatus(e.status))) };
    if (writes.some((e) => !e.done)) return { state: 'pending', via: 'red', detail: describeEntry(writes.find((e) => !e.done)) };
    const bad = writes.find((e) => e.done && !okStatus(e.status));
    if (bad) return { state: 'rejected', via: 'red', detail: describeEntry(bad) };
    const perfOk = perf.find((e) => isCartRequest(e) && okStatus(e.status));
    if (perfOk) return { state: 'probable', via: 'rendimiento', detail: describeEntry(perfOk) };
    if (s.domChanged) return { state: 'probable', via: 'texto de la cesta', detail: 'cambió el texto de la cesta, pero no se vio ninguna petición de cesta' };
    return { state: 'unconfirmed', via: null, detail: 'no se observó ninguna petición de cesta ni cambio en la página' };
  }

  function describeEntry(e) {
    if (!e) return '';
    let path = String(e.url || '');
    try {
      path = new URL(path).pathname;
    } catch (err) {
      /* ya es una ruta */
    }
    return `${e.method || '?'} ${path.slice(0, 80)} → ${e.error ? 'error de red' : e.status == null ? 'sin respuesta' : e.status}`;
  }

  // Identificador de producto sacado de la URL (p. ej. «c0p123456» en Bershka/Inditex o un número largo);
  // si no hay, la ruta completa. Sirve para reconocer el mismo producto en la cesta.
  function productKey(url) {
    try {
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname).toLowerCase();
      const m = /c\d+p(\d+)/.exec(path) || /(?:^|[^\d])(\d{6,})(?:[^\d]|$)/.exec(path);
      return m ? m[1] : path.replace(/\/+$/, '');
    } catch (e) {
      return null;
    }
  }

  // Compara los productos del outfit con lo que muestra la cesta real.
  // cart = { links: [url…], text: '…' }. Resultado por producto:
  //   found_link  → hay un enlace en la cesta con el mismo identificador de producto (fiable)
  //   found_name  → solo aparece su nombre en el texto (más débil: puede ser un falso positivo)
  //   not_found   → no aparece
  //   unreadable  → la cesta no mostró ningún producto reconocible, así que no se puede comprobar nada
  function matchCartItems(products, cart) {
    const links = (cart && Array.isArray(cart.links) ? cart.links : []).map(productKey).filter(Boolean);
    const text = normalize(cart && cart.text ? cart.text : '');
    const readable = links.length > 0 || text.length > 40;
    return (products || []).map((p) => {
      if (!readable) return { id: p.id, state: 'unreadable' };
      const key = productKey(p.url);
      if (key && links.includes(key)) return { id: p.id, state: 'found_link' };
      const name = normalize(p.name || '');
      if (name.length >= 6 && text.includes(name)) return { id: p.id, state: 'found_name' };
      return { id: p.id, state: 'not_found' };
    });
  }

  /* --------------------------- Preferencias --------------------------- */
  const CLOTHING_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

  function toNum(v) {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.'));
    return n;
  }

  function validatePrefs(raw) {
    const errors = {};
    const clean = {};
    clean.style = STYLES[raw.style] ? raw.style : null;
    if (!clean.style) errors.style = 'Elige un estilo.';

    const ranges = [
      ['height', 'Altura', 120, 230, 'cm'],
      ['weight', 'Peso', 30, 250, 'kg'],
      ['shoeSize', 'Talla de zapatillas', 34, 50, 'EU']
    ];
    for (const [key, label, min, max, unit] of ranges) {
      const n = toNum(raw[key]);
      if (n === null) {
        clean[key] = null;
      } else if (!Number.isFinite(n) || n < min || n > max) {
        errors[key] = `${label}: valor entre ${min} y ${max} ${unit}.`;
      } else {
        clean[key] = n;
      }
    }
    const b = toNum(raw.budget);
    if (b === null || !Number.isFinite(b) || b < 10 || b > 5000) {
      errors.budget = 'Presupuesto: valor entre 10 y 5000 €.';
    } else {
      clean.budget = b;
      clean.budgetCents = Math.round(b * 100);
    }
    const wanted = Array.isArray(raw.wanted) ? raw.wanted.filter((c) => CATEGORIES.includes(c)) : [];
    if (!wanted.length) errors.wanted = 'Elige al menos un tipo de prenda.';
    clean.wanted = wanted;

    const cs = String(raw.clothingSize || '').toUpperCase();
    if (cs && !CLOTHING_SIZES.includes(cs)) errors.clothingSize = 'Talla de ropa no válida.';
    clean.clothingSize = CLOTHING_SIZES.includes(cs) ? cs : '';

    const tokens = String(raw.colors || '')
      .split(/[,;/]+|\s+y\s+|\s+and\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    clean.colorList = [];
    clean.unknownColors = [];
    for (const tk of tokens) {
      const c = detectColor(tk);
      if (c) {
        if (!clean.colorList.includes(c)) clean.colorList.push(c);
      } else {
        clean.unknownColors.push(tk);
      }
    }
    clean.colors = String(raw.colors || '');
    return { errors, clean };
  }

  /* ------------------------------- Tallas ------------------------------- */
  function normSize(s) {
    return String(s).toUpperCase().replace(/^EU\s*/, '').replace(/\s+/g, '').replace(',', '.');
  }
  function sameSize(a, b) {
    const x = normSize(a);
    const y = normSize(b);
    if (x === y) return true;
    if (/^\d/.test(x) && /^\d/.test(y)) return parseFloat(x) === parseFloat(y);
    const alias = { XXL: '2XL', XXXL: '3XL' };
    return (alias[x] || x) === (alias[y] || y);
  }

  // Solo afirma algo si la página mostró una lista de tallas (ficha de producto).
  function sizeStatus(p, prefs) {
    const target = p.category === 'zapatillas' ? prefs.shoeSize : prefs.clothingSize;
    const unknown = { state: 'unknown', text: 'Talla por comprobar' };
    if (!Array.isArray(p.sizes) || p.sizes.length < 2) return unknown;
    if (target === null || target === undefined || target === '') return unknown;
    const label = p.category === 'zapatillas' ? 'EU ' + target : String(target);
    const hit = p.sizes.find((s) => sameSize(s.label, target));
    if (!hit) return { state: 'no', text: `Talla ${label} no aparece en la ficha` };
    if (hit.available === false) return { state: 'no', text: `Talla ${label} agotada según la ficha` };
    return { state: 'ok', text: `Talla ${label}: aparece disponible en la ficha (confírmalo en la tienda)` };
  }

  /* ---------------------------- Puntuaciones ---------------------------- */
  function itemScore(p, prefs) {
    const def = STYLES[prefs.style];
    const text = normalize(p.name + ' ' + urlText(p.url));
    let s = 0;
    if (def) {
      for (const r of def.re) if (r.test(text)) s += 3;
      if (p.color && def.colors.includes(p.color)) s += 2;
    }
    if (prefs.colorList && prefs.colorList.length && p.color) {
      if (prefs.colorList.includes(p.color)) s += 4;
      else if (!NEUTRALS.includes(p.color)) s -= 1;
    }
    return s;
  }

  function scoreOutfit(cands, total, budget) {
    let s = 0;
    const loud = new Set();
    let okSizes = 0;
    for (const c of cands) {
      s += c.score;
      if (c.p.color && !NEUTRALS.includes(c.p.color)) loud.add(c.p.color);
      if (c.size.state === 'ok') okSizes++;
    }
    const coherence = loud.size <= 1 ? 0 : loud.size === 2 ? -4 : -10;
    return s + coherence + (total / budget) * 8 + okSizes * 2;
  }

  function isValidProduct(p) {
    return !!(
      p &&
      typeof p.name === 'string' &&
      p.name &&
      Number.isInteger(p.priceCents) &&
      p.priceCents > 0 &&
      p.currency === 'EUR' &&
      /^https?:\/\//i.test(p.url || '') &&
      !p.outOfStock
    );
  }

  function isWithinBudget(o) {
    const sum = o.items.reduce((acc, i) => acc + i.product.priceCents, 0);
    return sum === o.totalCents && sum <= o.budgetCents && o.remainingCents === o.budgetCents - sum;
  }

  /* ------------------------------ Generador ------------------------------ */
  const PER_CATEGORY = 8;
  const TOP_BY_SCORE = 6;
  const MAX_KEEP = 300;

  function search(slots, cands, budget) {
    const minRest = new Array(slots.length + 1).fill(0);
    for (let i = slots.length - 1; i >= 0; i--) {
      minRest[i] = minRest[i + 1] + Math.min(...cands[slots[i]].map((c) => c.p.priceCents));
    }
    let results = [];
    const chosen = [];
    const byScore = (a, b) => b.score - a.score || b.totalCents - a.totalCents;
    const trim = () => {
      results.sort(byScore);
      results = results.slice(0, MAX_KEEP);
    };
    (function dfs(i, total) {
      if (i === slots.length) {
        const items = chosen.slice().sort((a, b) => CATEGORIES.indexOf(a.p.category) - CATEGORIES.indexOf(b.p.category));
        results.push({
          items: items.map((c) => ({ product: c.p, size: c.size })),
          totalCents: total,
          budgetCents: budget,
          remainingCents: budget - total,
          score: scoreOutfit(items, total, budget),
          key: items.map((c) => c.p.id).sort().join('|')
        });
        if (results.length >= 4000) trim();
        return;
      }
      for (const c of cands[slots[i]]) {
        const t = total + c.p.priceCents;
        if (t + minRest[i + 1] > budget) continue; // nunca superar el presupuesto
        chosen.push(c);
        dfs(i + 1, t);
        chosen.pop();
      }
    })(0, 0);
    trim();
    return results;
  }

  function generate(products, prefs) {
    const budget = prefs.budgetCents;
    const stats = { received: 0, invalid: 0, noCategory: 0, notWanted: 0, tooExpensive: 0, wrongSize: 0 };
    const missingDetail = {};
    const seen = new Set();
    const buckets = {};
    for (const c of CATEGORIES) buckets[c] = { total: 0, tooExpensive: 0, wrongSize: 0, list: [] };

    for (const p of products || []) {
      stats.received++;
      if (!isValidProduct(p)) {
        stats.invalid++;
        continue;
      }
      if (!p.category) {
        stats.noCategory++;
        continue;
      }
      if (!prefs.wanted.includes(p.category)) {
        stats.notWanted++;
        continue;
      }
      const id = p.id || p.url;
      if (seen.has(id)) continue;
      seen.add(id);
      const b = buckets[p.category];
      b.total++;
      if (p.priceCents > budget) {
        b.tooExpensive++;
        stats.tooExpensive++;
        continue;
      }
      const size = sizeStatus(p, prefs);
      if (size.state === 'no') {
        b.wrongSize++;
        stats.wrongSize++;
        continue;
      }
      const prod = Object.assign({}, p, { id });
      b.list.push({ p: prod, size, score: itemScore(prod, prefs) });
    }

    const cands = {};
    const available = [];
    const missing = [];
    for (const c of CATEGORIES) {
      if (!prefs.wanted.includes(c)) continue;
      const b = buckets[c];
      if (!b.list.length) {
        missing.push(c);
        missingDetail[c] = b.total === 0 ? 'no se han detectado productos de este tipo' : b.wrongSize && !b.tooExpensive ? 'ninguno tiene tu talla disponible' : 'ninguno cabe en el presupuesto o en tu talla';
        continue;
      }
      const sorted = b.list.slice().sort((a, z) => z.score - a.score || a.p.priceCents - z.p.priceCents);
      const pick = sorted.slice(0, TOP_BY_SCORE);
      const cheapest = b.list.slice().sort((a, z) => a.p.priceCents - z.p.priceCents);
      for (const x of cheapest) {
        if (pick.length >= PER_CATEGORY) break;
        if (!pick.includes(x)) pick.push(x);
      }
      cands[c] = pick;
      available.push(c);
    }

    let slots = available.slice();
    const omitted = [];
    let results = [];
    while (slots.length) {
      results = search(slots, cands, budget);
      if (results.length) break;
      const drop = DROP_ORDER.find((c) => slots.includes(c));
      omitted.push(drop);
      slots = slots.filter((c) => c !== drop);
    }
    const outfits = results.filter(isWithinBudget);
    return { outfits, missing, missingDetail, omitted, budgetCents: budget, stats };
  }

  // Elige otro outfit distinto a los ya mostrados, procurando variar respecto al último.
  function pickNext(result, shownKeys, last) {
    let best = null;
    let bv = -Infinity;
    for (const o of result.outfits) {
      if (shownKeys.has(o.key)) continue;
      const overlap = last ? o.items.filter((i) => last.items.some((j) => j.product.id === i.product.id)).length : 0;
      const v = o.score - overlap * 6;
      if (v > bv) {
        bv = v;
        best = o;
      }
    }
    return best;
  }

  return {
    CATEGORIES,
    CATEGORY_LABELS,
    DROP_ORDER,
    STYLES,
    NEUTRALS,
    CLOTHING_SIZES,
    normalize,
    parseAmount,
    parsePrice,
    formatEuro,
    classifyCategory,
    classifyUnique,
    detectColor,
    detectStore,
    STORES: STORE_LIST,
    enrichProduct,
    nameFromUrl,
    isLookDescription,
    missingCategories,
    rankSectionLinks,
    MIN_PER_CATEGORY,
    validatePrefs,
    sizeStatus,
    sameSize,
    isValidProduct,
    isWithinBudget,
    isCartRequest,
    classifyAddOutcome,
    productKey,
    matchCartItems,
    generate,
    pickNext
  };
});
