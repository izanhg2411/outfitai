'use strict';
/*
 * Prueba de integración del popup con un Chrome simulado (chrome.storage / tabs / scripting).
 * No sustituye a una prueba en Chrome real, pero verifica el flujo popup → extractor → generador → pantalla.
 * Requiere jsdom (npm i --no-save jsdom); si no está, se omite.
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
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const shopHtml = (() => {
  const card = (n, name, price) => `<li><a href="/p/${n}"><img src="https://img.example/${n}.jpg" alt="${name}"></a><a href="/p/${n}">${name}</a><span class="price">${price}</span></li>`;
  return `<html><head><title>Ropa</title></head><body><h1>Novedades</h1><ul>
    ${card(1, 'Camiseta básica negra', '15,99 €')}
    ${card(2, 'Pantalón cargo negro', '29,99 €')}
    ${card(3, 'Sudadera oversize gris', '25,99 €')}
    ${card(4, 'Zapatillas deportivas blancas', '49,99 €')}
    ${card(5, 'Chaqueta bomber', '59,99 €')}
    ${card(6, 'Camiseta estampada blanca', '12,99 €')}
  </ul></body></html>`;
})();

function setup(sharedStore) {
  const shop = new JSDOM(shopHtml, { url: 'https://www.bershka.com/es/hombre.html', runScripts: 'outside-only' });
  const store = sharedStore || {};
  const dom = new JSDOM(read('popup.html').replace(/<script[^>]*><\/script>/g, ''), { url: 'chrome-extension://x/popup.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = {
    storage: {
      local: {
        get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : {}),
        set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
        remove: async (k) => delete store[k]
      }
    },
    tabs: { query: async () => [{ id: 1, url: 'https://www.bershka.com/es/hombre.html' }] },
    scripting: {
      executeScript: async (inj) => {
        if (inj.files) {
          shop.window.eval(read('outfit-core.js'));
          shop.window.eval(read('content.js'));
          return [{ result: null }];
        }
        return [{ result: JSON.parse(JSON.stringify(shop.window.__outfitaiExtract())) }];
      }
    }
  };
  w.eval(read('outfit-core.js'));
  w.eval(read('popup.js'));
  return { w, store };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('popup: carga preferencias, crea outfit dentro del presupuesto y genera otro', opts, async () => {
  const { w, store } = setup();
  await wait(50);
  const d = w.document;
  assert.strictEqual(d.getElementById('style').options.length, 9);
  d.getElementById('budget').value = '200';
  d.getElementById('shoeSize').value = '42';
  d.querySelector('input[name=wanted][value=sudadera]').checked = true;
  d.getElementById('prefs').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await wait(300);

  assert.strictEqual(d.getElementById('result').hidden, false);
  const rows = d.querySelectorAll('#items li');
  assert.ok(rows.length >= 3, 'filas: ' + rows.length);
  const totalText = d.querySelector('#totals strong').textContent;
  const total = Number(totalText.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  assert.ok(total > 0 && total <= 200, 'total ' + totalText);
  assert.ok(d.getElementById('totals').textContent.includes('Dinero restante'));
  assert.ok(d.querySelector('#items a').href.startsWith('https://www.bershka.com/p/'));
  assert.ok(d.getElementById('items').textContent.includes('Talla por comprobar'));
  assert.ok(store.outfitai_prefs && store.outfitai_prefs.budget === '200', 'preferencias guardadas');
  assert.ok(Object.keys(store.outfitai_pool_v2).length === 6, 'productos guardados');
  assert.strictEqual(d.getElementById('storeBadge').textContent, 'Bershka');

  const first = d.getElementById('items').textContent;
  d.getElementById('next').click();
  await wait(50);
  assert.notStrictEqual(d.getElementById('items').textContent, first, 'otro outfit distinto');
});

test('popup: valida presupuesto y no analiza si hay errores', opts, async () => {
  const { w } = setup();
  await wait(50);
  const d = w.document;
  d.getElementById('budget').value = '3';
  d.getElementById('prefs').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await wait(100);
  assert.strictEqual(d.getElementById('errors').hidden, false);
  assert.strictEqual(d.getElementById('result').hidden, true);
});

test('popup: recoge automáticamente las secciones que faltan y cierra las pestañas', opts, async () => {
  const look = 'Conjunto de camiseta negra, sudadera gris y chaqueta bomber';
  const card = (slug, price) => `<li><a href="/es/${slug}-c0p10203${price.replace(/\D/g, '')}.html"><img src="https://img.example/${slug}.jpg" alt="${look}"></a><span class="price">${price}</span></li>`;
  const nav = '<nav><a href="/es/h/pantalones-c1010.html">Pantalones</a><a href="/es/h/zapatillas-c1020.html">Zapatillas</a><a href="/es/h/camisetas-c1000.html">Camisetas</a></nav>';
  const pages = {
    'https://www.bershka.com/es/h/camisetas-c1000.html': `<html><head><title>Camisetas</title></head><body>${nav}<h1>Camisetas</h1><ul>${card('camiseta-basica-negra', '12,99 €')}${card('camiseta-oversize-blanca', '15,99 €')}${card('camiseta-rayas-azul', '14,99 €')}</ul></body></html>`,
    'https://www.bershka.com/es/h/pantalones-c1010.html': `<html><head><title>Pantalones</title></head><body>${nav}<h1>Pantalones</h1><ul>${card('pantalon-cargo-negro', '29,99 €')}${card('pantalon-wide-leg-gris', '25,99 €')}${card('jeans-baggy-azul', '35,99 €')}</ul></body></html>`,
    'https://www.bershka.com/es/h/zapatillas-c1020.html': `<html><head><title>Zapatillas</title></head><body>${nav}<h1>Zapatillas</h1><ul>${card('zapatillas-running-blancas', '39,99 €')}${card('zapatillas-skate-negras', '45,99 €')}${card('zapatillas-retro-grises', '49,99 €')}</ul></body></html>`
  };
  const doms = {};
  const domFor = (u) => (doms[u] = doms[u] || new JSDOM(pages[u], { url: u, runScripts: 'outside-only' }));
  const store = {};
  const tabsByid = {};
  const closed = [];
  let nextId = 10;
  const activeUrl = 'https://www.bershka.com/es/h/camisetas-c1000.html';
  const dom = new JSDOM(read('popup.html').replace(/<script[^>]*><\/script>/g, ''), { url: 'chrome-extension://x/popup.html', runScripts: 'outside-only' });
  const w = dom.window;
  const urlOfTab = (id) => (id === 1 ? activeUrl : tabsByid[id]);
  const listeners = [];
  w.chrome = {
    storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))), remove: async (k) => delete store[k] } },
    permissions: { contains: async () => false, request: async () => true },
    tabs: {
      query: async () => [{ id: 1, url: activeUrl }],
      create: async ({ url, active }) => {
        assert.strictEqual(active, false, 'las pestañas auxiliares se abren en segundo plano');
        const id = nextId++;
        tabsByid[id] = url;
        return { id, url };
      },
      get: async (id) => ({ id, status: 'complete' }),
      remove: async (id) => closed.push(id),
      onUpdated: { addListener: (l) => listeners.push(l), removeListener: () => {} }
    },
    scripting: {
      executeScript: async (inj) => {
        const win = domFor(urlOfTab(inj.target.tabId)).window;
        if (inj.files) {
          win.eval(read('outfit-core.js'));
          win.eval(read('content.js'));
          return [{ result: null }];
        }
        const src = String(inj.func);
        const args = inj.args || [];
        if (src.includes('__outfitaiSections')) return [{ result: JSON.parse(JSON.stringify(win.__outfitaiSections(...args))) }];
        if (src.includes('__outfitaiScroll')) return [{ result: true }];
        return [{ result: JSON.parse(JSON.stringify(win.__outfitaiExtract())) }];
      }
    }
  };
  w.eval(read('outfit-core.js'));
  w.eval(read('popup.js'));
  await wait(50);
  const d = w.document;
  d.getElementById('budget').value = '150';
  d.getElementById('prefs').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await wait(600);

  const pool = Object.values(store.outfitai_pool_v2);
  const cats = pool.reduce((a, p) => ((a[p.category] = (a[p.category] || 0) + 1), a), {});
  assert.deepStrictEqual(cats, { camiseta: 3, pantalon: 3, zapatillas: 3 }, JSON.stringify(cats));
  assert.deepStrictEqual(closed.sort(), [10, 11], 'las pestañas auxiliares se cierran');
  const rows = Array.from(d.querySelectorAll('#items li')).map((li) => li.textContent);
  assert.strictEqual(rows.length, 3, rows.join(' | '));
  assert.ok(!rows.some((t) => /conjunto/i.test(t)), 'ningún nombre es la descripción del look');
  assert.ok(d.getElementById('status').textContent.includes('Secciones recogidas automáticamente'));
  const total = Number(d.querySelector('#totals strong').textContent.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  assert.ok(total > 0 && total <= 150);
});

test('popup: vista previa del outfit (el flujo de la cesta se prueba en test/browser.test.js)', opts, async () => {
  const card = (n, name, price) => `<li><a href="/p/${n}"><img src="https://img.example/${n}.jpg" alt="x"></a><a href="/p/${n}">${name}</a><span class="price">${price}</span></li>`;
  const list = `<html><head><title>Ropa</title></head><body><h1>Novedades</h1><ul>${card(1, 'Camiseta básica negra', '15,99 €')}${card(2, 'Pantalón cargo negro', '29,99 €')}${card(3, 'Zapatillas deportivas blancas', '49,99 €')}</ul></body></html>`;
  const prod = (n) => `<html><body><a href="/es/cesta">Cesta <span class="cart-count">0</span></a><div class="size-selector"><button id="s">${n === 3 ? '42' : 'M'}</button><button>${n === 3 ? '43' : 'L'}</button></div><button id="add">Añadir a la cesta</button><script>var ok=false;document.getElementById('s').onclick=function(){ok=true};document.getElementById('add').onclick=function(){if(ok)document.querySelector('.cart-count').textContent='1'};<\/script></body></html>`;
  const pages = { 'https://www.bershka.com/es/hombre.html': list, 'https://www.bershka.com/p/1': prod(1), 'https://www.bershka.com/p/2': prod(2), 'https://www.bershka.com/p/3': prod(3) };
  const doms = {};
  const domFor = (u) => (doms[u] = doms[u] || new JSDOM(pages[u], { url: u, runScripts: 'dangerously' }));
  const store = {};
  const tabs = {};
  const closed = [];
  const created = [];
  let nextId = 10;
  const active = 'https://www.bershka.com/es/hombre.html';
  const dom = new JSDOM(read('popup.html').replace(/<script[^>]*><\/script>/g, ''), { url: 'chrome-extension://x/popup.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = {
    storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))), remove: async (k) => delete store[k] } },
    permissions: { contains: async () => true, request: async () => true },
    tabs: {
      query: async () => [{ id: 1, url: active }],
      create: async ({ url, active: a }) => { const id = nextId++; tabs[id] = url; created.push({ url, active: a }); return { id, url }; },
      get: async (id) => ({ id, status: 'complete' }),
      remove: async (id) => closed.push(id),
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: {
      executeScript: async (inj) => {
        const url = inj.target.tabId === 1 ? active : tabs[inj.target.tabId];
        const win = domFor(url).window;
        if (inj.files) { win.eval(read('outfit-core.js')); win.eval(read('content.js')); return [{ result: null }]; }
        const src = String(inj.func);
        if (src.includes('__outfitaiSections')) return [{ result: { ok: true, sections: [] } }];
        return [{ result: JSON.parse(JSON.stringify(win.__outfitaiExtract())) }];
      }
    }
  };
  w.eval(read('outfit-core.js'));
  w.eval(read('popup.js'));
  await wait(50);
  const d = w.document;
  d.getElementById('budget').value = '120';
  d.getElementById('clothingSize').value = 'M';
  d.getElementById('shoeSize').value = '42';
  d.getElementById('autoCollect').checked = false;
  d.getElementById('prefs').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await wait(300);

  // Vista previa: una figura por prenda, con precio.
  d.getElementById('tabPreview').click();
  assert.strictEqual(d.getElementById('preview').hidden, false);
  assert.strictEqual(d.getElementById('items').hidden, true);
  assert.strictEqual(d.querySelectorAll('#preview .pv-fig').length, 3);
  assert.ok(d.getElementById('preview').textContent.includes('Total'));
  d.getElementById('tabList').click();
  assert.strictEqual(d.getElementById('items').hidden, false);
});

test('popup: si el panel se cierra, al reabrirlo se restaura el mismo outfit, la vista y el estado', opts, async () => {
  const a = setup();
  await wait(50);
  const d1 = a.w.document;
  d1.getElementById('budget').value = '200';
  d1.getElementById('shoeSize').value = '42';
  d1.getElementById('autoCollect').checked = false;
  d1.getElementById('prefs').dispatchEvent(new a.w.Event('submit', { cancelable: true }));
  await wait(300);
  d1.getElementById('next').click(); // un segundo outfit, distinto del primero
  await wait(50);
  d1.getElementById('tabPreview').click();
  await wait(120);
  const before = d1.getElementById('items').textContent;
  assert.ok(before.length > 20);

  // «Cerrar» el panel y abrir otro nuevo con el mismo almacenamiento.
  const b = setup(a.store);
  await wait(300);
  const d2 = b.w.document;
  assert.strictEqual(d2.getElementById('result').hidden, false);
  assert.strictEqual(d2.getElementById('items').textContent, before, 'mismo outfit');
  assert.strictEqual(d2.getElementById('preview').hidden, false, 'misma pestaña de vista');
  assert.ok(d2.getElementById('status').textContent.includes('restaurado'));
});
