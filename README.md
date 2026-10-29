# OutfitAI

Extensión de Chrome (Manifest V3) que, mientras navegas por una tienda de ropa online, combina los productos que detecta en la página para proponerte outfits según tu estilo y tu presupuesto. Todo se calcula en local: sin backend, sin claves API, sin servicios de pago y sin enviar datos a ningún servidor.

## Instalación (modo desarrollador)

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta del proyecto (la que contiene el archivo `manifest.json`).
4. (Opcional) Fija el icono de OutfitAI en la barra de Chrome.

## Cómo usarla

Al pulsar el icono, OutfitAI se abre en el **panel lateral** de Chrome (v116+): no se cierra al hacer clic en la página, cambiar de pestaña o abrir pestañas auxiliares. Además, el outfit mostrado, la vista elegida y el estado de la cesta se **guardan** y se restauran al reabrir (24 h). Si el panel lateral no pudiera leer la página, se pedirá el permiso de esa tienda y se reintentará.

1. Entra en una tienda y abre un **listado de productos** o una **ficha de producto**. Desplázate hasta el final para que la tienda cargue los productos.
2. Haz clic en el icono de OutfitAI y rellena tus preferencias (se guardan solas): estilo, presupuesto, altura, peso, talla de zapatillas (EU), talla de ropa, colores y prendas deseadas.
3. Pulsa **Crear mi outfit**. Verás las prendas con imagen, precio, categoría, estado de la talla y enlace a la tienda, más el total, el presupuesto y el dinero restante.
3b. **Recogida automática de secciones** (casilla activada por defecto): si faltan prendas (menos de 3 productos de una categoría deseada), la extensión busca en el menú de la tienda los enlaces a esas secciones, las abre **en pestañas en segundo plano**, las desplaza para cargar productos, lee los precios y **cierra cada pestaña**. Máximo 6 secciones por pulsación. La primera vez Chrome pide permiso para leer **esa tienda** (permiso opcional por origen).
3c. **Vista previa del outfit**: pestaña junto a la lista que compone las fotos de las prendas como se llevan puestas (capas superiores, pantalón, zapatillas, accesorio) con precio y total. Es una composición con las fotos de la tienda, no una prueba virtual.
3d. **Añadir a la cesta**: abre la ficha de cada prenda (en primer plano), elige **tu talla** (ropa o zapatillas), pulsa «Añadir a la cesta» y **espera a que la tienda responda** (3–15 s por prenda, mirando las peticiones de cesta que lanza la propia página). **No cierra ninguna ficha** durante el proceso: al final abre la **cesta real**, comprueba qué prendas del outfit aparecen y solo cierra las fichas de las que sí aparecen. Las demás quedan abiertas y el panel explica por qué. Muestra el progreso prenda a prenda, tiene botón **Detener** y un «Detalle técnico» copiable. Si falta tu talla, no aparece o está agotada, **no elige ninguna por ti**. La talla no se comprueba dentro de la cesta.
4. **Generar otro outfit** propone una combinación distinta. **Actualizar productos** vuelve a leer la página actual.

Los productos detectados se **guardan en el navegador 7 días** (máx. 400) para poder combinar lo que has visto en varias secciones (p. ej. camisetas en una página y pantalones en otra). Se pueden borrar con «Vaciar productos guardados». Cada prenda muestra la fecha en que se vio su precio: confírmalo siempre en la tienda.

## Permisos y por qué

| Permiso | Motivo |
|---|---|
| `storage` | Guardar tus preferencias y los productos detectados (`chrome.storage.local`). |
| `activeTab` | Leer **solo la pestaña activa** y **solo cuando abres la extensión**. |
| `sidePanel` | Mostrar la extensión en el panel lateral. |
| `scripting` | Inyectar el lector de productos en esa pestaña. |
| `optional_host_permissions` | Solo se solicita al pulsar el botón y solo para el dominio de la tienda, para leer las otras secciones. Si lo rechazas, todo funciona como antes. |

No hay `host_permissions` obligatorios ni content scripts permanentes: la extensión no se ejecuta en ninguna página hasta que pulsas su botón.

## Qué funciona realmente (verificado con pruebas automáticas)

`npm test` ejecuta 29 pruebas (las de jsdom se omiten si no está instalado: `npm i --no-save jsdom`):

- Lectura de precios en formato español (`15,99 €`, `1.299,00 €`, precio partido en varios `<span>`), descartando otras monedas, precios sin moneda confirmada, precios ambiguos y precios tachados.
- Extracción de JSON-LD `Product` (incluye `@graph`, listas y variantes), de tarjetas de catálogo y de tallas de una ficha, sobre **páginas simuladas**.
- Generador: el ejemplo de 121,96 € con presupuesto de 120 € se rechaza y se propone un outfit más barato; prueba aleatoria de 300 catálogos / más de 1000 outfits en la que **el total nunca supera el presupuesto**, el total y el restante cuadran y no se repiten categorías.
- Flujo del popup (validación → guardado → lectura → generación → pantalla → «Generar otro») con un Chrome simulado.

## Tiendas

| Tienda | Estado |
|---|---|
| Bershka, Zara, Pull&Bear, Stradivarius, H&M, ASOS, Massimo Dutti, Mango | **Reconocidas por nombre, pero NO verificadas.** Usan el modo genérico (JSON-LD + tarjetas visibles). No he podido abrir ninguna en un navegador real, así que no afirmo que funcionen. |
| Cualquier otra tienda | Modo genérico, sin verificar. |

No hay adaptador específico de Bershka: no he podido comprobar su estructura real. Existe un punto de extensión (`ADAPTERS` en `content.js`) para añadirlo cuando se haya verificado.

## Limitaciones

- **No he probado la extensión en Chrome.** Las pruebas usan DOM simulado; el comportamiento en tiendas reales (carga dinámica, bloqueos, estructuras propias) puede diferir.
- Solo precios en **EUR**; el resto se descarta y se cuenta.
- La categoría se deduce del **nombre** (o de la URL, o del título de la página si menciona una sola categoría). Lo que no se reconoce no se usa. Se avisa cuando la categoría viene de la página.
- Las **tallas** solo se muestran como disponibles si la ficha de producto lista tallas; en listados siempre aparece «Talla por comprobar». Si la ficha dice que tu talla no está o está agotada, esa prenda se excluye. La detección de «agotado» en el DOM es heurística: confirma siempre en la tienda.
- **Altura y peso** se guardan como referencia pero **no se usan** para deducir tallas (no se inventan equivalencias).
- Los colores se deducen del nombre/URL; sin color reconocido, la prenda cuenta como neutra.
- Si una tienda carga precios con scripts que no aparecen en el DOM o los bloquea, no se detectará nada y se muestra un mensaje explicándolo.
- Sin iconos propios (Chrome usa el genérico).

- **Bershka (alt = look completo)**: el texto alternativo de la imagen ya no se usa como nombre si describe varias prendas; el nombre sale del título/enlace o, si no, de la URL, y la categoría se decide por el nombre único o por la URL.
- Flujo de recogida de secciones (permiso → enlaces de menú → pestañas en segundo plano → cierre) con un Chrome simulado.

**Sin verificar en Bershka real** (v0.5.0 solo se ha probado en Chromium real contra una tienda simulada): que el botón de añadir y las tallas de Bershka sean reconocibles por texto/clases (la automatización se basa en el texto «Añadir a la cesta» y en elementos con «size/talla» en la clase), que la cesta sea una URL abrible (si es un panel lateral no se abrirá), que el menú de cada tienda exponga enlaces `<a>` reconocibles, que los productos aparezcan en el DOM tras 4-5 s de scroll, y los avisos de Chrome al pedir el permiso.

## Pruebas en Chromium real (v0.5.0)

`test/browser.test.js` carga la extensión en un Chromium real y la prueba contra una tienda **simulada** en local. Requiere `npm i --no-save playwright && npx playwright install chromium`; si no está, se omite. No sustituye a probar Bershka.

El flujo de la cesta instala en la ficha (solo mientras añade) un observador de solo lectura de `fetch`/XHR: anota método, ruta sin parámetros y estado; no lee cuerpos, cabeceras ni cookies, y nada sale del navegador.

## Pendiente

- Probar en Chrome real y ajustar por tienda (empezando por Bershka).
- Adaptadores específicos verificados.
- Guía de tallas, outfits favoritos, mejor clasificación de estilos y colores.
- Iconos.
