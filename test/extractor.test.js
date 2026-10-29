'use strict';
/*
 * Pruebas del extractor con DOM simulado (jsdom). jsdom NO es dependencia de la extensión;
 * si no está instalado, estas pruebas se omiten. Para ejecutarlas: npm i --no-save jsdom
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  /* sin jsdom */
}
const opts = { skip: JSDOM ? false : 'jsdom no instalado (npm i --no-save jsdom)' };

const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'outfit-core.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

function run(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.eval(coreSrc);
  dom.window.eval(contentSrc);
  return JSON.parse(JSON.stringify(dom.window.__outfitaiExtract()));
}

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

test('ficha de producto con JSON-LD (EUR) y tallas', opts, () => {
  const html = `<html><head><title>Camiseta oversize negra</title><meta property="og:type" content="product">
  ${ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Camiseta oversize negra', image: ['https://img.example/a.jpg'], color: 'Negro', offers: { '@type': 'Offer', price: '15.99', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } })}
  </head><body><h1>Camiseta oversize negra</h1>
  <div class="size-selector"><button>S</button><button>M</button><button disabled>L</button><button class="size is-unavailable">XL</button></div></body></html>`;
  const r = run(html, 'https://www.bershka.com/es/camiseta-oversize-c0p1.html?x=1#frag');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.store.id, 'bershka');
  assert.strictEqual(r.pageType, 'product');
  assert.strictEqual(r.products.length, 1);
  const p = r.products[0];
  assert.strictEqual(p.priceCents, 1599);
  assert.strictEqual(p.currency, 'EUR');
  assert.strictEqual(p.url, 'https://www.bershka.com/es/camiseta-oversize-c0p1.html?x=1');
  assert.strictEqual(p.image, 'https://img.example/a.jpg');
  assert.deepStrictEqual(p.sizes, [
    { label: 'S', available: true },
    { label: 'M', available: true },
    { label: 'L', available: false },
    { label: 'XL', available: false }
  ]);
});

test('JSON-LD sin moneda, con otra moneda o agotado: no se inventa nada', opts, () => {
  const mk = (name, offers) => ({ '@type': 'Product', name, url: 'https://shop.example/' + name, offers });
  const html = `<html><head>${ld({ '@graph': [
    mk('sin-moneda', { price: '10' }),
    mk('dolares', { price: '10', priceCurrency: 'USD' }),
    mk('agotado', { price: '10', priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock' }),
    mk('bueno', { price: '12.5', priceCurrency: 'EUR' })
  ] })}</head><body></body></html>`;
  const r = run(html, 'https://shop.example/catalogo');
  assert.strictEqual(r.stats.unknownCurrency, 1);
  assert.strictEqual(r.stats.nonEur, 1);
  assert.strictEqual(r.stats.outOfStock, 1);
  const byName = Object.fromEntries(r.products.map((p) => [p.name, p]));
  assert.ok(byName['bueno'] && byName['bueno'].priceCents === 1250);
  assert.ok(byName['agotado'].outOfStock === true);
  assert.ok(!byName['sin-moneda'] && !byName['dolares']);
});

test('catálogo con tarjetas: precio tachado, precio partido, otra moneda y precio ambiguo', opts, () => {
  const card = (href, name, inner) => `<li class="card"><a href="${href}"><img src="https://img.example/${name}.jpg" alt="${name}"></a><a href="${href}" class="t">${name}</a>${inner}</li>`;
  const html = `<html><head><title>Camisetas hombre</title></head><body><nav><a href="/">Inicio</a><a href="/mujer">Mujer</a></nav><h1>Camisetas</h1><ul>
    ${card('/p/1', 'Camiseta básica blanca', '<span class="price">15,99 €</span>')}
    ${card('/p/2', 'Camiseta estampada', '<span class="old-price">29,99 €</span><span class="price-current">19,99 €</span>')}
    ${card('/p/3', 'Camiseta split', '<div class="price"><span>24</span><span>,95 €</span></div>')}
    ${card('/p/4', 'Camiseta dólares', '<span class="price">$19.99</span>')}
    ${card('/p/5', 'Camiseta ambigua', '<span class="price">9,99 €</span><span class="price">12,99 €</span>')}
    ${card('/p/6', 'Camiseta cara', '<span class="price">1.299,00 €</span>')}
    ${card('javascript:void(0)', 'Camiseta rota', '<span class="price">5,00 €</span>')}
    </ul></body></html>`;
  const r = run(html, 'https://tienda.example/hombre/camisetas');
  assert.strictEqual(r.pageType, 'catalog');
  const price = Object.fromEntries(r.products.map((p) => [p.name, p.priceCents]));
  assert.strictEqual(price['Camiseta básica blanca'], 1599);
  assert.strictEqual(price['Camiseta estampada'], 1999, 'debe ignorar el precio tachado');
  assert.strictEqual(price['Camiseta split'], 2495);
  assert.strictEqual(price['Camiseta cara'], 129900);
  assert.ok(!('Camiseta dólares' in price));
  assert.ok(!('Camiseta ambigua' in price));
  assert.ok(!('Camiseta rota' in price));
  assert.strictEqual(r.stats.nonEur, 1);
  assert.strictEqual(r.stats.ambiguous, 1);
  assert.strictEqual(r.products.find((p) => p.name === 'Camiseta básica blanca').url, 'https://tienda.example/p/1');
  assert.ok(r.pageCategoryText.toLowerCase().includes('camisetas'));
});

test('página sin productos devuelve lista vacía (sin inventar)', opts, () => {
  const r = run('<html><body><h1>Sobre nosotros</h1><p>Somos una tienda desde 1990 €</p></body></html>', 'https://tienda.example/about');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.products.length, 0);
});

test('Bershka: el alt describe el look completo; el nombre sale de la URL y la categoría es la correcta', opts, () => {
  const look = 'Conjunto de camiseta negra, sudadera gris y chaqueta bomber';
  const card = (slug, price) => `<li><a href="/es/${slug}-c0p1020304${price.length}.html"><img src="https://img.example/${slug}.jpg" alt="${look}"></a><span class="price">${price}</span></li>`;
  const html = `<html><head><title>Pantalones hombre</title></head><body><h1>Pantalones</h1><ul>
    ${card('pantalon-cargo-negro', '29,99 €')}${card('pantalon-wide-leg-gris', '25,99 €')}${card('jeans-baggy-azul', '35,99 €')}${card('pantalon-chino-beige', '27,99 €')}
  </ul></body></html>`;
  const r = run(html, 'https://www.bershka.com/es/hombre/ropa/pantalones-c1010.html');
  assert.strictEqual(r.products.length, 4);
  const Core = require('../outfit-core.js');
  for (const p of r.products) {
    assert.ok(!/conjunto/i.test(p.name), 'nombre no debe ser el look: ' + p.name);
    assert.strictEqual(Core.enrichProduct(p, r.pageCategoryText).category, 'pantalon', p.name);
  }
});

test('__outfitaiSections devuelve enlaces de sección de la página', opts, () => {
  const html = `<html><body><nav><a href="/es/hombre/ropa/pantalones-c1010.html">Pantalones</a><a href="/es/hombre/zapatos/zapatillas-c1020.html">Zapatillas</a></nav><h1>Camisetas</h1></body></html>`;
  const dom = new JSDOM(html, { url: 'https://www.bershka.com/es/hombre/ropa/camisetas-c1000.html', runScripts: 'outside-only' });
  dom.window.eval(coreSrc);
  dom.window.eval(contentSrc);
  const r = JSON.parse(JSON.stringify(dom.window.__outfitaiSections(['pantalon', 'zapatillas'], [])));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sections.map((s) => s.category).sort(), ['pantalon', 'zapatillas']);
});

// Las pruebas de «añadir a la cesta» (talla, botón, dobles clics) viven ahora en test/browser.test.js: se ejecutan en un
// Chromium real, donde los eventos y las peticiones se comportan como en Chrome y no como en jsdom.
