'use strict';
/*
 * Prueba en un CHROMIUM REAL con la extensión cargada, contra una tienda SIMULADA en local (127.0.0.1).
 * Verifica el flujo «Añadir a la cesta» de punta a punta: pestañas, clics, espera a las peticiones, cesta real y cierre.
 * NO es Bershka: la tienda simulada es un invento mío con casos difíciles (ficha que se pinta tarde, panel de tallas,
 * petición lenta, error 500, botón que no hace nada). Que pase aquí no demuestra nada sobre Bershka.
 *
 * Requiere playwright (npm i --no-save playwright && npx playwright install chromium). Si no está, se omite.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let chromium = null;
for (const mod of ['playwright', 'playwright-core']) {
  try {
    ({ chromium } = require(mod));
    break;
  } catch (e) {
    /* sin playwright */
  }
}
const opts = { skip: chromium ? false : 'playwright no instalado (npm i --no-save playwright)', timeout: 180000 };
const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- Tienda simulada ----------------------------- */
const PRODUCTS = [
  { cat: 'camiseta', slug: 'camiseta-basica-negra', id: '111111', name: 'Camiseta básica negra', price: '15,99 €', mode: 'sizes_post' },
  { cat: 'pantalon', slug: 'pantalon-cargo-negro', id: '222222', name: 'Pantalón cargo negro', price: '29,99 €', mode: 'panel_size_adds' },
  { cat: 'zapatillas', slug: 'zapatillas-deportivas-blancas', id: '333333', name: 'Zapatillas deportivas blancas', price: '49,99 €', mode: 'sizes_post_500' },
  { cat: 'sudadera', slug: 'sudadera-oversize-gris', id: '444444', name: 'Sudadera oversize gris', price: '25,99 €', mode: 'dead_button' },
  { cat: 'accesorio', slug: 'gorra-negra', id: '555555', name: 'Gorra negra', price: '9,99 €', mode: 'panel_confirm' }
];
const hrefOf = (p) => `/es/${p.slug}-c0p${p.id}.html`;

function productPage(p) {
  const shoe = p.cat === 'zapatillas';
  const sizes = shoe ? ['41', '42', '43'] : ['S', 'M', 'L'];
  return `<!doctype html><html><head><title>${p.name}</title></head><body>
<a href="/es/cesta">Cesta <span class="cart-count">0</span></a><div id="app"></div>
<script>
var MODE=${JSON.stringify(p.mode)}, ID=${JSON.stringify(p.id)}, SIZES=${JSON.stringify(sizes)}, sel=null;
function post(){ return fetch('/api/cart/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:ID,size:sel})}); }
function sizeButtons(onpick){ var d=document.createElement('div'); d.className='size-selector';
  SIZES.forEach(function(s){ var b=document.createElement('button'); b.textContent=s; b.onclick=function(){ sel=s; onpick&&onpick(); }; d.appendChild(b); }); return d; }
function addButton(handler){ var b=document.createElement('button'); b.id='add'; b.textContent='Añadir a la cesta'; b.onclick=handler; return b; }
// La ficha se pinta TARDE (como una SPA): nada existe en el DOM durante el primer segundo y medio.
setTimeout(function(){
  var app=document.getElementById('app');
  if(MODE==='sizes_post'||MODE==='sizes_post_500'){
    app.appendChild(sizeButtons());
    app.appendChild(addButton(function(){ if(sel) setTimeout(post,800); }));
  } else if(MODE==='dead_button'){
    app.appendChild(sizeButtons());
    app.appendChild(addButton(function(){ /* no hace nada */ }));
  } else if(MODE==='panel_size_adds'){
    // «Añadir» abre el panel de tallas; elegir talla ya añade el producto.
    app.appendChild(addButton(function(){ setTimeout(function(){ if(!document.getElementById('panel')){ var pn=sizeButtons(function(){ post(); }); pn.id='panel'; app.appendChild(pn); } },600); }));
  } else if(MODE==='panel_confirm'){
    // «Añadir» abre el panel; elegir talla solo la marca; hay que pulsar «Añadir» otra vez.
    app.appendChild(addButton(function(){
      if(!document.getElementById('panel')){ setTimeout(function(){ var pn=sizeButtons(); pn.id='panel'; app.appendChild(pn); },600); }
      else if(sel){ post(); }
    }));
  }
},1500);
<\/script></body></html>`;
}

function startShop() {
  const cart = [];
  const posts = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type });
      res.end(body);
    };
    if (url.pathname === '/es/hombre.html') {
      const card = (p) => `<li><a href="${hrefOf(p)}"><img src="/img.png" alt="Conjunto de camiseta negra, sudadera gris y chaqueta bomber"></a><a href="${hrefOf(p)}">${p.name}</a><span class="price">${p.price}</span></li>`;
      return send(200, 'text/html; charset=utf-8', `<html><head><title>Novedades</title></head><body><h1>Novedades</h1><ul>${PRODUCTS.map(card).join('')}</ul></body></html>`);
    }
    const m = /^\/es\/[a-z-]+-c0p(\d+)\.html$/.exec(url.pathname);
    if (m) {
      const p = PRODUCTS.find((x) => x.id === m[1]);
      return p ? send(200, 'text/html; charset=utf-8', productPage(p)) : send(404, 'text/plain', 'no');
    }
    if (url.pathname === '/es/cesta') {
      return send(200, 'text/html; charset=utf-8', `<html><head><title>Cesta</title></head><body><h1>Tu cesta</h1><div id="c">Cargando…</div><script>setTimeout(function(){fetch('/api/cart').then(function(r){return r.json()}).then(function(items){document.getElementById('c').innerHTML=items.map(function(i){return '<div class="line"><a href="'+i.href+'">'+i.name+'</a> talla '+i.size+'</div>'}).join('')||'Tu cesta está vacía'})},700)<\/script></body></html>`);
    }
    if (url.pathname === '/api/cart') return send(200, 'application/json', JSON.stringify(cart));
    if (url.pathname === '/img.png') return send(200, 'image/gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    if (url.pathname === '/api/cart/items' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const b = JSON.parse(body || '{}');
        const p = PRODUCTS.find((x) => x.id === b.id);
        // Respuesta LENTA a propósito: cerrar la pestaña antes de que termine perdería el producto.
        setTimeout(() => {
          const rec = { id: b.id, size: b.size, at: Date.now(), status: p && p.mode === 'sizes_post_500' ? 500 : 200 };
          posts.push(rec);
          if (rec.status === 200) cart.push({ href: hrefOf(p), name: p.name, size: b.size });
          send(rec.status, 'application/json', '{}');
        }, 1200);
      });
      return;
    }
    send(404, 'text/plain', 'no');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, cart, posts, base: 'http://127.0.0.1:' + server.address().port })));
}

// Copia de la extensión con permiso de host fijo para 127.0.0.1 (en pruebas no hay nadie que acepte el aviso de Chrome).
function extensionCopy(noHost) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outfitai-ext-'));
  for (const f of ['background.js', 'popup.html', 'popup.css', 'popup.js', 'outfit-core.js', 'content.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (!noHost) mf.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf));
  return dir;
}

async function launch(noHost) {
  const ext = extensionCopy(noHost);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'outfitai-prof-'));
  const ctx = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  return { ctx, extId: sw.url().split('/')[2] };
}

async function fillAndCreate(popup, wanted) {
  await popup.evaluate((w) => {
    const d = document;
    d.getElementById('budget').value = '400';
    d.getElementById('shoeSize').value = '42';
    d.getElementById('clothingSize').value = 'M';
    d.getElementById('autoCollect').checked = false;
    d.querySelectorAll('input[name=wanted]').forEach((i) => (i.checked = w.includes(i.value)));
    d.getElementById('prefs').dispatchEvent(new Event('submit', { cancelable: true }));
  }, wanted);
  await popup.waitForFunction(() => document.querySelectorAll('#items li').length >= 1, null, { timeout: 20000 });
}

/* ------------------------------ Pruebas ------------------------------ */
test('Chromium real + tienda simulada: añade, espera a la tienda, comprueba la cesta y solo cierra lo comprobado', opts, async (t) => {
  const shop = await startShop();
  const L = await launch();
  const timeline = [];
  const t0 = Date.now();
  L.ctx.on('page', (pg) => {
    const rec = { page: pg, openedAt: Date.now() - t0 };
    timeline.push(rec);
    pg.on('close', () => (rec.closedAt = Date.now() - t0));
  });
  t.after(async () => {
    await L.ctx.close().catch(() => {});
    shop.server.close();
  });

  const listing = await L.ctx.newPage();
  await listing.goto(shop.base + '/es/hombre.html');
  const popup = await L.ctx.newPage();
  await popup.goto(`chrome-extension://${L.extId}/popup.html`);
  await listing.bringToFront();
  await fillAndCreate(popup, ['camiseta', 'sudadera', 'pantalon', 'zapatillas', 'accesorio']);
  assert.strictEqual(await popup.evaluate(() => document.querySelectorAll('#items li').length), 5, 'outfit con las 5 prendas');

  // Muestreo del panel para comprobar que el progreso es visible prenda a prenda.
  const seen = new Set();
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const txt = await popup.evaluate(() => document.getElementById('cartStatus').textContent).catch(() => '');
      seen.add(txt);
      await sleep(250);
    }
  })();
  await popup.evaluate(() => document.getElementById('addCart').click());
  await popup.waitForFunction(() => !document.getElementById('addCart').disabled && /de 5 prenda/.test(document.getElementById('cartStatus').textContent), null, { timeout: 150000, polling: 500 });
  sampling = false;
  await sampler;

  const status = await popup.evaluate(() => document.getElementById('cartStatus').textContent);
  const diag = await popup.evaluate(() => document.getElementById('cartDiagText').textContent);
  const rows = await popup.evaluate(() => Array.from(document.querySelectorAll('#cartStatus li')).map((li) => ({ text: li.textContent, cls: li.className })));
  const rowOf = (name) => rows.find((r) => r.text.startsWith(name));

  // Servidor: una petición por prenda pulsada (sin duplicados), ninguna para el botón que no hace nada.
  const count = (id) => shop.posts.filter((p) => p.id === id).length;
  assert.deepStrictEqual([count('111111'), count('222222'), count('333333'), count('444444'), count('555555')], [1, 1, 1, 0, 1], JSON.stringify(shop.posts));
  assert.deepStrictEqual(shop.posts.filter((p) => p.id === '111111')[0].size, 'M', 'usa MI talla de ropa');
  assert.deepStrictEqual(shop.posts.filter((p) => p.id === '333333')[0].size, '42', 'usa MI talla de zapatillas');
  assert.deepStrictEqual(shop.cart.map((c) => c.name).sort(), ['Camiseta básica negra', 'Gorra negra', 'Pantalón cargo negro']);

  // Panel: dice la verdad prenda a prenda.
  assert.ok(/3 de 5 prenda/.test(status), status);
  assert.ok(rowOf('Camiseta básica negra').text.includes('✓ aparece en la cesta'), rowOf('Camiseta básica negra').text);
  assert.ok(rowOf('Pantalón cargo negro').text.includes('✓ aparece en la cesta'));
  assert.ok(rowOf('Gorra negra').text.includes('✓ aparece en la cesta'));
  assert.ok(rowOf('Zapatillas deportivas blancas').text.includes('RECHAZÓ'), rowOf('Zapatillas deportivas blancas').text);
  assert.ok(rowOf('Zapatillas deportivas blancas').text.includes('NO aparece en la cesta'), rowOf('Zapatillas deportivas blancas').text);
  assert.ok(rowOf('Sudadera oversize gris').text.includes('no se vio ninguna respuesta'), rowOf('Sudadera oversize gris').text);
  assert.ok(rowOf('Sudadera oversize gris').text.includes('NO aparece en la cesta'));
  assert.ok([...seen].some((s) => /Prenda 1 de 5/.test(s)) && [...seen].some((s) => /Prenda 5 de 5/.test(s)), 'se ve el progreso de la primera a la última prenda');
  assert.ok([...seen].some((s) => /esperando a la tienda/.test(s)), 'se ve que espera a la tienda');
  assert.ok(/POST \/api\/cart\/items → 200/.test(diag) && /POST \/api\/cart\/items → 500/.test(diag), diag);
  assert.ok(/no se pulsa «Añadir» otra vez/.test(diag), 'no duplica el añadido cuando elegir la talla ya lo añade');
  assert.ok(/Pulsado de nuevo/.test(diag), 'sí pulsa de nuevo cuando el panel exige confirmar');

  // Pestañas: ninguna ficha se cerró antes de abrir la cesta; solo se cerraron las comprobadas; quedan abiertas las demás.
  const prodTabs = timeline.filter((r) => /-c0p\d+\.html/.test(r.page.url()) || r.closedAt !== undefined).filter((r) => r.page !== listing && r.page !== popup);
  const cartTab = timeline.find((r) => /\/es\/cesta/.test(r.page.url()));
  assert.ok(cartTab, 'se abrió la cesta real');
  const lastPost = Math.max(...shop.posts.map((p) => p.at)) - t0;
  const closed = timeline.filter((r) => r.closedAt !== undefined && r.page !== popup && r.page !== listing && r !== cartTab);
  assert.strictEqual(closed.length, 3, 'solo se cierran las 3 fichas comprobadas en la cesta');
  for (const r of closed) {
    assert.ok(r.closedAt > cartTab.openedAt, 'ninguna ficha se cierra antes de abrir la cesta');
    assert.ok(r.closedAt > lastPost, 'ninguna ficha se cierra antes de que la tienda responda');
  }
  const stillOpen = L.ctx.pages().map((p) => p.url());
  assert.ok(stillOpen.some((u) => u.includes('zapatillas-deportivas-blancas')), 'la ficha rechazada sigue abierta');
  assert.ok(stillOpen.some((u) => u.includes('sudadera-oversize-gris')), 'la ficha sin respuesta sigue abierta');
  assert.ok(stillOpen.some((u) => u.endsWith('/es/cesta')), 'la cesta queda abierta para verla');
  void prodTabs;
});

test('Chromium real: sin talla preferida, talla ausente o agotada NO se pulsa nada; sin botón lo dice', opts, async (t) => {
  const shop = await startShop();
  const L = await launch();
  t.after(async () => {
    await L.ctx.close().catch(() => {});
    shop.server.close();
  });
  const core = fs.readFileSync(path.join(root, 'outfit-core.js'), 'utf8');
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const page = await L.ctx.newPage();
  const run = async (html, target) => {
    await page.route('**/t.html', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto(shop.base + '/t.html');
    await page.addScriptTag({ content: core });
    await page.addScriptTag({ content: content });
    const r = await page.evaluate((tg) => globalThis.__outfitaiAddStart(tg, { pauseMs: 20, waitMs: 800 }), target);
    await page.unroute('**/t.html');
    return r;
  };
  const withClicks = '<div class="size-selector"><button>S</button><button>M</button><button disabled>L</button></div><button id="add" onclick="window.__clicked=(window.__clicked||0)+1">Añadir a la cesta</button>';
  assert.strictEqual((await run(withClicks, null)).code, 'needs_size');
  assert.strictEqual((await run(withClicks, 'XL')).code, 'size_missing');
  assert.strictEqual((await run(withClicks, 'L')).code, 'size_unavailable');
  assert.strictEqual(await page.evaluate(() => window.__clicked || 0), 0, 'el botón no se pulsó');
  const noBtn = await run('<p>hola</p>', 'M');
  assert.strictEqual(noBtn.code, 'no_button');
  const ok = await run(withClicks, 'M');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.size, 'M');
  assert.strictEqual(await page.evaluate(() => window.__clicked), 1, 'un único clic en «Añadir»');
});

test('Chromium real: sin permiso sobre la pestaña NO dice «abre una tienda»: explica el problema y ofrece permisos por tienda', opts, async (t) => {
  const shop = await startShop();
  const L = await launch(true); // sin permiso de host y sin pulsar el icono: Chrome oculta tab.url
  t.after(async () => {
    await L.ctx.close().catch(() => {});
    shop.server.close();
  });
  const listing = await L.ctx.newPage();
  await listing.goto(shop.base + '/es/hombre.html');
  const popup = await L.ctx.newPage();
  await popup.goto(`chrome-extension://${L.extId}/popup.html`);
  await listing.bringToFront();
  const seenUrl = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url);
  assert.strictEqual(seenUrl, undefined, 'precondición: Chrome oculta la dirección sin permiso');
  await popup.evaluate(() => {
    document.getElementById('budget').value = '400';
    document.getElementById('prefs').dispatchEvent(new Event('submit', { cancelable: true }));
  });
  await popup.waitForFunction(() => /No tengo acceso/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  const st = await popup.evaluate(() => ({ text: document.getElementById('status').textContent, buttons: Array.from(document.querySelectorAll('#status .access button')).map((b) => b.textContent) }));
  assert.ok(!/Abre una página de una tienda online/.test(st.text), st.text);
  assert.ok(st.buttons.includes('Bershka') && st.buttons.length === 8, st.buttons.join(','));
});
