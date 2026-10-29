'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../outfit-core.js');

const prefsOf = (over) => C.validatePrefs(Object.assign({ style: 'casual', budget: '120', wanted: ['camiseta', 'pantalon', 'zapatillas'] }, over)).clean;
let n = 0;
const prod = (name, euros, extra) =>
  C.enrichProduct(
    Object.assign({ id: 'https://t.example/p' + ++n, name, priceCents: Math.round(euros * 100), currency: 'EUR', url: 'https://t.example/p' + n, image: null, sizes: null }, extra),
    ''
  );

test('parsePrice: formatos españoles y otros', () => {
  assert.deepStrictEqual(C.parsePrice('15,99 €'), { kind: 'eur', cents: 1599 });
  assert.deepStrictEqual(C.parsePrice('1.299,00 €'), { kind: 'eur', cents: 129900 });
  assert.deepStrictEqual(C.parsePrice('€ 15.99'), { kind: 'eur', cents: 1599 });
  assert.deepStrictEqual(C.parsePrice('29 EUR'), { kind: 'eur', cents: 2900 });
  assert.deepStrictEqual(C.parsePrice('1 299,00 €'), { kind: 'eur', cents: 129900 });
  assert.deepStrictEqual(C.parsePrice('$19.99'), { kind: 'other' });
  assert.deepStrictEqual(C.parsePrice('19,99 £'), { kind: 'other' });
  assert.strictEqual(C.parsePrice('-30%'), null);
  assert.strictEqual(C.parsePrice(',99 €'), null);
  assert.strictEqual(C.parsePrice('15,99 € 29,99 €'), null);
  assert.strictEqual(C.parsePrice('Camiseta 15 €'), null);
});

test('formatEuro', () => {
  assert.strictEqual(C.formatEuro(12196), '121,96 €');
  assert.strictEqual(C.formatEuro(129900), '1.299,00 €');
  assert.strictEqual(C.formatEuro(5), '0,05 €');
});

test('categorías y colores', () => {
  assert.strictEqual(C.classifyCategory('Camiseta oversize estampada'), 'camiseta');
  assert.strictEqual(C.classifyCategory('Sudadera con capucha'), 'sudadera');
  assert.strictEqual(C.classifyCategory('Pantalón cargo baggy'), 'pantalon');
  assert.strictEqual(C.classifyCategory('Chaqueta vaquera'), 'chaqueta');
  assert.strictEqual(C.classifyCategory('Zapatillas deportivas negras'), 'zapatillas');
  assert.strictEqual(C.classifyCategory('Gorra con logo'), 'accesorio');
  assert.strictEqual(C.classifyCategory('Sobrecamisa de lino'), 'chaqueta');
  assert.strictEqual(C.classifyCategory('Vela aromática'), null);
  assert.strictEqual(C.classifyUnique('Pantalones y camisetas'), null);
  assert.strictEqual(C.classifyUnique('Hombre - Sudaderas'), 'sudadera');
  assert.strictEqual(C.detectColor('Camiseta azul marino'), 'marino');
  assert.strictEqual(C.detectColor('Camiseta básica negra'), 'negro');
  assert.strictEqual(C.detectColor('Sudadera'), null);
});

test('validatePrefs: rangos y obligatorios', () => {
  const bad = C.validatePrefs({ style: 'casual', height: '50', weight: '900', shoeSize: '60', budget: '2', wanted: [] });
  for (const k of ['height', 'weight', 'shoeSize', 'budget', 'wanted']) assert.ok(bad.errors[k], 'debería fallar ' + k);
  const ok = C.validatePrefs({ style: 'oldmoney', height: '178', weight: '70,5', shoeSize: '42', budget: '120,50', wanted: ['camiseta'], colors: 'negro, azul marino, fosforito' });
  assert.deepStrictEqual(ok.errors, {});
  assert.strictEqual(ok.clean.budgetCents, 12050);
  assert.deepStrictEqual(ok.clean.colorList, ['negro', 'marino']);
  assert.deepStrictEqual(ok.clean.unknownColors, ['fosforito']);
});

test('ejemplo del enunciado: 121,96 € con presupuesto 120 € se rechaza y se busca algo más barato', () => {
  const prefs = prefsOf({ budget: '120', wanted: ['camiseta', 'pantalon', 'sudadera', 'zapatillas'] });
  const r = C.generate([prod('Camiseta básica', 15.99), prod('Pantalón recto', 29.99), prod('Sudadera lisa', 25.99), prod('Zapatillas urbanas', 49.99)], prefs);
  assert.ok(r.outfits.length > 0);
  for (const o of r.outfits) {
    assert.ok(o.totalCents <= 12000);
    assert.ok(o.items.length < 4);
  }
  assert.deepStrictEqual(r.omitted, ['sudadera']);
  assert.strictEqual(r.outfits[0].totalCents, 9597);
});

test('si todo cabe se incluye todo y se informa del resto', () => {
  const prefs = prefsOf({ budget: '130', wanted: ['camiseta', 'pantalon', 'sudadera', 'zapatillas'] });
  const r = C.generate([prod('Camiseta básica', 15.99), prod('Pantalón recto', 29.99), prod('Sudadera lisa', 25.99), prod('Zapatillas urbanas', 49.99)], prefs);
  assert.strictEqual(r.outfits[0].items.length, 4);
  assert.strictEqual(r.outfits[0].totalCents, 12196);
  assert.strictEqual(r.outfits[0].remainingCents, 804);
});

test('categorías sin productos se reportan como faltantes', () => {
  const r = C.generate([prod('Camiseta básica', 15.99)], prefs0());
  function prefs0() { return prefsOf({}); }
  assert.deepStrictEqual(r.missing.sort(), ['pantalon', 'zapatillas']);
  assert.strictEqual(r.outfits.length, 1);
  assert.strictEqual(r.outfits[0].items.length, 1);
});

test('productos no EUR, sin url, agotados o sin precio no entran', () => {
  const prefs = prefsOf({ wanted: ['camiseta'] });
  const r = C.generate(
    [prod('Camiseta A', 10, { currency: 'USD' }), prod('Camiseta B', 10, { url: 'javascript:alert(1)' }), prod('Camiseta C', 10, { outOfStock: true }), prod('Camiseta D', 0)],
    prefs
  );
  assert.strictEqual(r.outfits.length, 0);
  assert.strictEqual(r.stats.invalid, 4);
});

test('tallas: se excluye lo que la ficha dice que no tiene tu talla; sin dato → "Talla por comprobar"', () => {
  const prefs = prefsOf({ wanted: ['zapatillas'], shoeSize: '42' });
  const sizes = (...l) => l.map(([label, available]) => ({ label, available }));
  const a = prod('Zapatillas A', 40, { sizes: sizes(['41', true], ['42', false], ['43', true]) });
  const b = prod('Zapatillas B', 45, { sizes: sizes(['41', true], ['42', true], ['43', true]) });
  const c = prod('Zapatillas C', 50);
  const r = C.generate([a, b, c], prefs);
  const names = r.outfits.map((o) => o.items[0].product.name).sort();
  assert.deepStrictEqual(names, ['Zapatillas B', 'Zapatillas C']);
  const st = (name) => r.outfits.find((o) => o.items[0].product.name === name).items[0].size;
  assert.strictEqual(st('Zapatillas B').state, 'ok');
  assert.strictEqual(st('Zapatillas C').text, 'Talla por comprobar');
});

test('pickNext devuelve outfits distintos hasta agotarlos', () => {
  const prefs = prefsOf({ wanted: ['camiseta', 'pantalon'], budget: '200' });
  const r = C.generate([prod('Camiseta 1', 10), prod('Camiseta 2', 12), prod('Pantalón 1', 30), prod('Pantalón 2', 35)], prefs);
  assert.strictEqual(r.outfits.length, 4);
  const shown = new Set();
  let last = null;
  for (let i = 0; i < 4; i++) {
    const o = C.pickNext(r, shown, last);
    assert.ok(o && !shown.has(o.key));
    shown.add(o.key);
    last = o;
  }
  assert.strictEqual(C.pickNext(r, shown, last), null);
});

test('estilo y colores influyen en el orden', () => {
  const prefs = prefsOf({ style: 'techwear', wanted: ['pantalon'], budget: '100', colors: 'negro' });
  const r = C.generate([prod('Pantalón recto verde', 20), prod('Pantalón cargo nylon negro', 30)], prefs);
  assert.strictEqual(r.outfits[0].items[0].product.name, 'Pantalón cargo nylon negro');
});

test('FUZZ: el presupuesto nunca se supera y los totales cuadran', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const names = { camiseta: 'Camiseta', sudadera: 'Sudadera', pantalon: 'Pantalón', chaqueta: 'Chaqueta', zapatillas: 'Zapatillas', accesorio: 'Gorra' };
  const colors = ['negro', 'blanco', 'rojo', 'verde', 'azul', 'rosa', ''];
  let checked = 0;
  for (let it = 0; it < 300; it++) {
    const products = [];
    const count = 1 + Math.floor(rnd() * 40);
    for (let i = 0; i < count; i++) {
      const cat = C.CATEGORIES[Math.floor(rnd() * 6)];
      products.push(prod(`${names[cat]} ${colors[Math.floor(rnd() * colors.length)]} ${i}`, Math.round((3 + rnd() * 120) * 100) / 100));
    }
    const wanted = C.CATEGORIES.filter(() => rnd() > 0.35);
    if (!wanted.length) wanted.push('camiseta');
    const budget = Math.round(10 + rnd() * 400);
    const prefs = C.validatePrefs({ style: Object.keys(C.STYLES)[Math.floor(rnd() * 9)], budget: String(budget), wanted, colors: 'negro, blanco' }).clean;
    const r = C.generate(products, prefs);
    for (const o of r.outfits) {
      const sum = o.items.reduce((s, i) => s + i.product.priceCents, 0);
      assert.ok(sum <= budget * 100, `supera presupuesto: ${sum} > ${budget * 100}`);
      assert.strictEqual(sum, o.totalCents);
      assert.strictEqual(o.remainingCents, budget * 100 - sum);
      const cats = o.items.map((i) => i.product.category);
      assert.strictEqual(new Set(cats).size, cats.length, 'categoría repetida');
      assert.ok(cats.every((c) => wanted.includes(c)));
      checked++;
    }
  }
  assert.ok(checked > 1000, 'el fuzz debería haber comprobado muchos outfits (' + checked + ')');
});

/* ---- v0.2: nombres de look y recogida de secciones ---- */
const CoreV2 = require('../outfit-core.js');

test('un alt con el look completo no se toma como categoría del producto', () => {
  const look = 'Conjunto de camiseta negra, sudadera gris y chaqueta bomber';
  assert.strictEqual(CoreV2.isLookDescription(look), true);
  assert.strictEqual(CoreV2.isLookDescription('Camiseta básica negra'), false);
  const p = CoreV2.enrichProduct({ name: look, url: 'https://www.bershka.com/es/pantalon-cargo-ancho-c0p10203040.html' });
  assert.strictEqual(p.category, 'pantalon');
  assert.strictEqual(CoreV2.nameFromUrl('https://www.bershka.com/es/pantalon-cargo-ancho-c0p10203040.html'), 'Pantalon cargo ancho');
});

test('missingCategories: pide secciones con menos de 3 productos válidos', () => {
  const mk = (id, category) => ({ id, name: 'x' + id, priceCents: 1000, currency: 'EUR', url: 'https://t.example/' + id, category });
  const prods = [mk(1, 'camiseta'), mk(2, 'camiseta'), mk(3, 'camiseta'), mk(4, 'pantalon')];
  const prefs = { wanted: ['camiseta', 'pantalon', 'zapatillas'] };
  assert.deepStrictEqual(CoreV2.missingCategories(prods, prefs), ['pantalon', 'zapatillas']);
});

test('rankSectionLinks: elige enlaces de sección y descarta productos, precios y otras webs', () => {
  const links = [
    { href: '/es/hombre/ropa/pantalones-c1010.html', text: 'Pantalones', inNav: true },
    { href: '/es/hombre/ropa/pantalones/vaqueros-c1011.html', text: 'Vaqueros', inNav: true },
    { href: '/es/hombre/zapatos/zapatillas-c1020.html', text: 'Zapatillas', inNav: true },
    { href: '/es/pantalon-cargo-ancho-c0p10203040.html', text: 'Pantalón cargo ancho', inNav: false },
    { href: '/es/camiseta-basica-c0p999999.html', text: 'Camiseta básica 12,99 €', inNav: false },
    { href: 'https://otra.example/zapatillas', text: 'Zapatillas', inNav: true },
    { href: '/es/mujer/ropa/pantalones-c2010.html', text: 'Pantalones', inNav: true },
    { href: '/es/carrito', text: 'Cesta', inNav: true }
  ];
  const r = CoreV2.rankSectionLinks(links, { pageUrl: 'https://www.bershka.com/es/hombre/ropa/camisetas-c1000.html', categories: ['pantalon', 'zapatillas', 'camiseta'] });
  const by = Object.fromEntries(r.map((x) => [x.category, x.url]));
  assert.strictEqual(by.pantalon, 'https://www.bershka.com/es/hombre/ropa/pantalones-c1010.html');
  assert.strictEqual(by.zapatillas, 'https://www.bershka.com/es/hombre/zapatos/zapatillas-c1020.html');
  assert.ok(!by.camiseta, 'el enlace con precio y id de producto no es sección');
});

/* ---------------- v0.5.0: confirmación de «Añadir a la cesta» y comprobación de la cesta ---------------- */
test('classifyAddOutcome: solo una petición de escritura a una ruta de cesta con 2xx cuenta como confirmada', () => {
  const post = (url, status, done = true, extra = {}) => Object.assign({ kind: 'fetch', method: 'POST', url, status, done }, extra);
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://t.example/api/cart/items', 200)] }).state, 'confirmed');
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://t.example/itxrest/orders/shopcart', 201)] }).state, 'confirmed');
  // petición aún en curso: NO se da por terminada
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://t.example/api/cart/items', null, false)] }).state, 'pending');
  // error de la tienda o de red: rechazada
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://t.example/api/cart/items', 500)] }).state, 'rejected');
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://t.example/api/cart/items', 403)] }).state, 'rejected');
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://t.example/api/cart/items', 0, true, { error: true })] }).state, 'rejected');
  // un GET, o un POST a una ruta ajena a la cesta (analítica), no confirma nada
  assert.strictEqual(C.classifyAddOutcome({ net: [{ method: 'GET', url: 'https://t.example/api/cart', status: 200, done: true }] }).state, 'unconfirmed');
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://analytics.example/collect', 204)] }).state, 'unconfirmed');
  // si una petición de cesta falló y otra funcionó, manda la que funcionó
  assert.strictEqual(C.classifyAddOutcome({ net: [post('https://t.example/api/cart/items', 500), post('https://t.example/api/cart/items', 200)] }).state, 'confirmed');
});

test('classifyAddOutcome: el texto de la página o Resource Timing solo dan «probable», nunca confirmación', () => {
  assert.strictEqual(C.classifyAddOutcome({ domChanged: true }).state, 'probable');
  assert.strictEqual(C.classifyAddOutcome({ perf: [{ url: 'https://t.example/api/cart/items', status: 200 }] }).state, 'probable');
  assert.strictEqual(C.classifyAddOutcome({ perf: [{ url: 'https://t.example/api/cart/items', status: 500 }] }).state, 'unconfirmed');
  assert.strictEqual(C.classifyAddOutcome({}).state, 'unconfirmed');
  assert.strictEqual(C.classifyAddOutcome(null).state, 'unconfirmed');
});

test('productKey: identificador de producto de la URL (c0pNNN, número largo) o ruta', () => {
  assert.strictEqual(C.productKey('https://www.bershka.com/es/pantalon-cargo-negro-c0p123456.html?colorId=800'), '123456');
  assert.strictEqual(C.productKey('https://www.bershka.com/es/pantalon-cargo-negro-c0p123456.html'), C.productKey('https://www.bershka.com/es/cesta/otro-nombre-c0p123456.html'));
  assert.strictEqual(C.productKey('https://tienda.example/p/987654321/camiseta'), '987654321');
  assert.strictEqual(C.productKey('https://tienda.example/camisetas/basica/'), '/camisetas/basica');
  assert.strictEqual(C.productKey('no es una url'), null);
});

test('matchCartItems: reconoce por enlace, por nombre, ausentes y cesta ilegible', () => {
  const prods = [
    { id: 'a', name: 'Camiseta básica negra', url: 'https://t.example/es/camiseta-basica-negra-c0p111.html' },
    { id: 'b', name: 'Pantalón cargo negro', url: 'https://t.example/es/pantalon-cargo-negro-c0p222.html' },
    { id: 'c', name: 'Zapatillas deportivas blancas', url: 'https://t.example/es/zapatillas-c0p333.html' }
  ];
  const cart = { links: ['https://t.example/es/camiseta-basica-negra-c0p111.html?x=1', 'https://t.example/es/ayuda'], text: 'Tu cesta Pantalón cargo negro talla M 29,99 €' };
  const r = C.matchCartItems(prods, cart);
  assert.deepStrictEqual(r.map((x) => x.state), ['found_link', 'found_name', 'not_found']);
  // cesta sin productos legibles: no se afirma nada
  assert.deepStrictEqual(C.matchCartItems(prods, { links: [], text: 'Cargando…' }).map((x) => x.state), ['unreadable', 'unreadable', 'unreadable']);
  assert.deepStrictEqual(C.matchCartItems(prods, null).map((x) => x.state), ['unreadable', 'unreadable', 'unreadable']);
  // un nombre muy corto no basta para dar un falso positivo
  assert.strictEqual(C.matchCartItems([{ id: 'z', name: 'Top', url: 'https://t.example/es/top-c0p9.html' }], { links: [], text: 'Cesta con un top de punto y muchas cosas más por aquí dentro' })[0].state, 'not_found');
});
