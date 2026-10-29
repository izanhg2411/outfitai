# CAMBIOS — OutfitAI v0.5.1

- **Corregido (visto en tu captura en bershka.com)**: el panel decía «Abre una página de una tienda online» estando en Bershka. Causa: sin permiso sobre la pestaña, Chrome oculta su dirección (`tab.url` indefinida) y el código lo trataba como «no es una web». El panel lateral sigue abierto al cambiar de pestaña y el permiso `activeTab` del icono solo vale para la pestaña donde se pulsó. Ahora distingue ese caso, lo explica (pulsa el icono de OutfitAI en la pestaña de la tienda) y ofrece un botón por tienda conocida que pide el permiso opcional de ese dominio y reintenta.
- Prueba nueva en Chromium real (extensión sin permisos): comprueba el mensaje y los 8 botones. Lo que NO he podido probar: pulsar un botón de permiso (el aviso de Chrome no se puede aceptar en pruebas automáticas) ni tu Bershka real.

# CAMBIOS — OutfitAI v0.5.0

## Novedades v0.5.0 — «Añadir a la cesta» rehecho

**Lo que NO he podido hacer** (este entorno no tiene acceso a internet): abrir Bershka real, mirar su DOM con Elements ni ver qué petición hace al añadir en Network. Por eso **no sé** cuál de tus hipótesis a–e es la causa real, no he escrito selectores de Bershka y **no uso ningún endpoint interno** (no lo he verificado y no lo invento).

**Defectos reales que sí he encontrado leyendo el código de v0.4.0** (independientes de lo que haga Bershka):

- La pestaña se cerraba **siempre** (`finally`), incluso con «no he podido confirmar»: contradice lo que pides.
- «Confirmado» dependía de que cambiara el texto de elementos con «cart/bag/basket/cesta» (`cartSignal`): cualquier cambio de la página (un aviso, una animación) cerraba la pestaña antes de que la tienda respondiera.
- La espera tras pulsar era corta y fija (≈ 0,6 s + 6 × 0,6 s), sin mirar si había una petición en curso.
- Si el panel de tallas aparecía después del clic, se pulsaba «Añadir» una segunda vez sin saber si el primer clic ya había añadido: riesgo de **duplicados**.
- Las pestañas se abrían en segundo plano (`active:false`): los navegadores frenan los temporizadores y algunas webs no pintan hasta ser visibles. Es una hipótesis, no un hecho confirmado; por eso ahora se abren en primer plano.

**Cómo funciona ahora**

1. Por prenda: abre la ficha (en primer plano) → espera a que se pinte (hasta 8 s) → elige **tu** talla → pulsa «Añadir» (secuencia completa pointer/mouse/click) → si aparece un panel de tallas, lo gestiona y **solo vuelve a pulsar si no se ha visto ya una petición de cesta** (sin observador de red, no pulsa).
2. Espera a la tienda: mínimo 3 s y hasta 15 s; no termina mientras haya una petición de cesta en curso. Observa (solo lectura, en la propia ficha) método, ruta sin parámetros y estado de los `fetch`/XHR. Resultado por prenda: *aceptada* (POST/PUT/PATCH a ruta de cesta con 2xx), *rechazada* (4xx/5xx/red), *indicios* o *sin respuesta*. El texto de la página **ya no confirma nada**, solo da «indicios».
3. **Ninguna ficha se cierra durante el proceso.** Al final se abre la **cesta real**, se leen sus enlaces y se comparan con el outfit por identificador de producto (`productKey`). Solo se cierran las fichas de prendas que aparecen en la cesta; las demás quedan abiertas y el panel explica por qué (rechazada, sin respuesta, no aparece…).
4. Panel: progreso «Prenda i de n» y estado de cada una en directo, botón **Detener**, y un **«Detalle técnico»** copiable (peticiones observadas, pasos, enlaces vistos en la cesta; sin cookies, cabeceras ni cuerpos). Si no encuentra la URL de la cesta, lo dice y no afirma nada.
5. No se verifica la **talla** dentro de la cesta (no hay forma genérica fiable): el panel lo avisa.

**Pruebas**

- `outfit-core.js` (`classifyAddOutcome`, `productKey`, `matchCartItems`, `isCartRequest`): +4 pruebas en Node, en verde.
- **Nuevo `test/browser.test.js`: Chromium real con la extensión cargada** contra una tienda **simulada** en local (ficha que se pinta tarde, panel de tallas, petición lenta, error 500, botón que no hace nada, cesta que se pinta con retraso). Comprueba, entre otras cosas, que no hay duplicados, que usa tu talla, que ninguna ficha se cierra antes de abrir la cesta ni antes de que la tienda responda, y que quedan abiertas las no comprobadas. Requiere `npm i --no-save playwright` (se omite si no está). Esto **no demuestra nada sobre Bershka**.
- Retiradas las pruebas jsdom de «añadir a la cesta» (aseguraban el comportamiento antiguo) y sustituidas por las de Chromium. Las pruebas jsdom restantes **no se han podido ejecutar en este entorno** (no hay jsdom).
- Resultado aquí: 19 en verde sin Playwright; 21 con Playwright (11 jsdom omitidas).

## Qué necesito de ti para cerrar el problema (DevTools en una ficha real de Bershka)

1. **Elements**: haz clic derecho en el selector de talla (una talla) → Inspeccionar; copia el HTML de ese elemento y de su contenedor, y lo mismo del botón «Añadir a la cesta». Anota si el selector de talla está ya visible o aparece tras pulsar el botón.
2. **Network** (marca «Preserve log», filtro Fetch/XHR): pulsa Añadir y copia, de la petición que se dispara, **método, URL sin parámetros, código de estado y si tiene «Initiator»**. No pegues cookies ni cabeceras de autorización.
3. Pulsa el nuevo botón con la extensión y pega el **«Detalle técnico»** del panel: dice qué peticiones vio, si hubo rechazo (¿401/403/429?) y qué leyó en la cesta.

Con eso escribo el adaptador verificado de Bershka; si la API interna fuera la mejor vía, te diré primero cómo la he verificado.

# v0.4.0

## Novedades v0.4.0

- **Panel lateral** en lugar de popup (`background.js`, permiso `sidePanel`, Chrome ≥ 116): un popup se cierra al perder el foco (pestañas nuevas, avisos de permisos…) y con él se perdía el outfit y el proceso de la cesta.
- **Sesión persistente**: outfit actual, outfits ya vistos, vista (lista/previa) y estado de la cesta se guardan y se restauran al reabrir. Se regenera desde los productos guardados y solo se restaura si el outfit guardado sigue existiendo.
- Si la lectura de la pestaña falla en el panel, se pide el permiso de la tienda y se reintenta.
- 29 pruebas en verde. **Sin probar en Chrome real**: que el icono abra el panel y que `activeTab` cubra la pestaña (si no, se usa el permiso de tienda).

# v0.3.0

## Novedades v0.3.0

- **Vista previa del outfit** (pestaña en el popup): composición plana con las fotos y precios.
- **Botón «Añadir a la cesta»**: automatiza la ficha de producto (talla → botón → comprobación de que la cesta cambió) y abre la cesta. No inventa tallas; informa por prenda de lo conseguido y deja abiertas las fichas que no pudo completar. Usa el mismo permiso opcional por tienda.
- Corregido: tarjetas cuyo primer enlace es la imagen (sin texto) quedaban sin nombre; ahora se miran todos los enlaces de la tarjeta al mismo producto.
- 28 pruebas en verde (DOM simulado). **No probado en Chrome ni en la cesta real de Bershka.**

# v0.2.0

## Novedades v0.2.0

- **Bug Bershka**: el `alt` de las imágenes describe el look completo («Conjunto de camiseta negra…») y se usaba como nombre, de modo que pantalones salían como camiseta/sudadera/chaqueta. Ahora `cardName` deja el alt al final, descarta cualquier texto que nombre varias categorías (`isLookDescription`) y recurre al slug de la URL (`nameFromUrl`). `enrichProduct` prioriza el nombre inequívoco, luego la URL.
- **Recogida automática de secciones**: `missingCategories` detecta qué falta; `content.js` aporta enlaces del menú (`__outfitaiSections`) y `Core.rankSectionLinks` elige uno por categoría (descarta fichas de producto, enlaces con precio y otros dominios); el popup abre cada sección en una pestaña en segundo plano, hace scroll (`__outfitaiScroll`), extrae y cierra la pestaña. Permiso de host **opcional** por tienda (`optional_host_permissions`), pedido al pulsar el botón; casilla para desactivarlo.
- Clave de almacenamiento `outfitai_pool_v2`: los productos guardados por la v0.1.0 (con categorías erróneas) se descartan.
- 24 pruebas (6 nuevas), todas en verde con DOM simulado; **sigue sin probarse en Chrome real**.

# v0.1.0

## Archivos creados

| Archivo | Contenido |
|---|---|
| `manifest.json` | MV3; permisos `storage`, `activeTab`, `scripting`; sin hosts ni content scripts permanentes. |
| `popup.html` / `popup.css` / `popup.js` | Interfaz compacta, preferencias persistentes, escaneo, resultados. Se pinta solo con `textContent`/nodos DOM. |
| `outfit-core.js` | Lógica pura: precios, categorías, colores, estilos, validación, tallas y generador. Funciona en el popup y en Node. |
| `content.js` | Extractor inyectado bajo demanda (JSON-LD, tarjetas de catálogo, tallas de ficha). |
| `test/*.test.js`, `package.json` | 18 pruebas (`npm test`). |
| `README.md`, `CAMBIOS.md` | Documentación. |

## Decisiones importantes

- **JavaScript sin framework ni dependencias**: React/Vite no aportaban valor a un popup de este tamaño.
- **Inyección bajo demanda con `activeTab` + `scripting`** en lugar de content scripts en `<all_urls>`: permisos mínimos; la extensión no toca ninguna web hasta que se abre.
- **Importes en céntimos enteros** y comprobación final `isWithinBudget` sobre cada outfit: el presupuesto no se supera por errores de redondeo. La búsqueda poda cualquier combinación que ya no pueda caber.
- **Búsqueda exhaustiva acotada** (máx. 8 candidatos por categoría: 6 mejores por puntuación + los más baratos, para no perder combinaciones viables). Puntuación = afinidad de estilo (palabras clave y colores) + colores preferidos + coherencia de color (neutros combinan; más de un color vivo penaliza) + aprovechamiento del presupuesto + talla confirmada.
- **Si no cabe todo**, se omiten prendas en este orden: accesorio, chaqueta, sudadera, zapatillas, pantalón, camiseta, y se informa de lo omitido y de lo que falta.
- **Solo EUR**; sin moneda confirmada, con otra moneda, precio ambiguo (varios precios sin marcar cuál es el actual) o agotado según JSON-LD → descartado y contado, nunca inventado.
- **Productos guardados 7 días** (extra respecto al enunciado): un listado suele tener una sola categoría, así que sin acumular entre páginas casi nunca habría outfit completo. Es local, se puede vaciar y cada prenda muestra la fecha de su precio.
- **Altura/peso no influyen en tallas** (el enunciado pide no inventar equivalencias). Son opcionales, pero se validan si se rellenan; el presupuesto sí es obligatorio.
- **Sin adaptador de Bershka**: no he podido ver su estructura real; en lugar de inventar selectores dejo el punto de extensión `ADAPTERS`.
- Aprendido en pruebas: «Generar otro» no cambia nada cuando solo existe una combinación válida; en ese caso la extensión lo dice.

## Limitaciones encontradas

- No hay navegador en este entorno: la extensión **no se ha probado en Chrome ni en tiendas reales**. Verificado: sintaxis de los tres scripts, manifiesto JSON válido, 18 pruebas automáticas con DOM y Chrome simulados.
- La clasificación por palabras clave puede fallar con nombres ambiguos o en otros idiomas distintos de español/inglés.
- La detección de tallas agotadas por clases CSS es heurística.

## Prueba manual recomendada (5 minutos)

1. Carga la carpeta en `chrome://extensions` → «Cargar descomprimida» y comprueba que no aparecen errores en la tarjeta de la extensión.
2. Abre un listado de camisetas en Bershka (o similar), desplázate hasta el final, abre OutfitAI y pulsa «Crear mi outfit». Mira si dice cuántos productos detectó.
3. Repite en un listado de pantalones y otro de zapatillas; vuelve a pulsar el botón: deberían combinarse.
4. Comprueba que total ≤ presupuesto y que los enlaces abren el producto correcto y el precio coincide.
5. Si detecta 0 productos, haz clic derecho en el popup → Inspeccionar para ver errores, y dime la tienda y la URL para añadir un adaptador.
