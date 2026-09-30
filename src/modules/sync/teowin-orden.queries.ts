import { teowinQuery } from "../../config/teowin";
import type {
  TeowinDespieceRow,
  TeowinModuloInfo,
  TeowinOrdenCabecera,
  TeowinPedidoInfo,
} from "./teowin-orden.types";

// Qué filas del despiece son piezas de CORTE (y no tarugos, herrajes, guías,
// tiradores, etc.). BUG REAL (orden 263500002, pedido 26-02149, módulo 38:
// 40 piezas en la app vs. 42 en el escandallo): faltaban los paneles
// PZPP/PAN. Filtrar solo por idCatalogo = 4 no alcanza — el catálogo de
// placares también trae TAR3D/HER3D/GC3D/TIR marcados siEscandallo — y la
// lista fija PZA/PZC/PZD/PZP que documentaba diseño.md §3.2 es la del
// catálogo 3 (Cocinas): en el catálogo 4 la familia de paneles se llama
// PZPP, no PZP. La fuente de verdad es el propio listado de corte de
// TeoWin: tFamiliasListadosFabricacion, listado A02, catálogo 4 (hoy PZPP,
// PZD, PZC, PZA). Se lee de ahí, en vez de fijarla en el código, para que
// una familia nueva en ese listado entre sola.
const FAMILIAS_DE_CORTE = `EXISTS (
         SELECT 1 FROM tFamiliasListadosFabricacion fl
         WHERE fl.codigoListado = 'A02'
           AND fl.idCatalogo = 4
           AND fl.empresa = d.empresa
           AND fl.familia = d.familia)`;

// diseño.md §3.1 — cabecera de la orden (descripción, número corto).
export async function fetchOrdenCabecera(orden: number): Promise<TeowinOrdenCabecera | null> {
  const rows = await teowinQuery<TeowinOrdenCabecera>(
    `SELECT numeroOrden, numeroOrdenCustom, descripcion
     FROM tListaOrdenesFabricacion
     WHERE numeroOrden = @orden`,
    { orden },
  );
  return rows[0] ?? null;
}

// diseño.md §3.6, extendida con:
// - d.medida1/d.medida2 (documentadas en §3.4 sobre la misma tabla/alias
//   d = tdespieceLineaPresupuesto, no incluidas en el ejemplo de §3.6 pero
//   necesarias para poblar DespieceTipo.medida1/medida2).
// - descripción de artículo de la propia pieza, con el mismo join documentado
//   en §3.3 para la descripción del módulo (tArticuloDescripciones por
//   familia/articulo/idioma='ES') pero aplicado a familia/articulo de la
//   pieza (d) en vez de la fila raíz del mueble.
//
// BUG REAL encontrado con la orden 243300013 (2200 piezas): sin
// `ad.idCatalogo = d.idCatalogo` en el join, tArticuloDescripciones puede
// tener más de una fila para el mismo familia/articulo/idioma con distinto
// idCatalogo (confirmado con datos reales: MOESS/C4CYE tiene una fila con
// idCatalogo=4 y otra con idCatalogo=100265, misma descripción). Sin filtrar
// por idCatalogo, el LEFT JOIN duplicaba filas — de 2200 piezas reales
// pasaban a 3607, con 863 idUnico repetidos, lo que rompía el INSERT contra
// el índice único de la sección 8.3 con un 409 engañoso ("ya existe") para
// una orden que en realidad nunca se había llegado a insertar.
// IDIOMA: en tArticuloDescripciones el español está cargado como 'ESP' (más
// completo) y como 'ES' (parcial) — filtrar solo 'ES' dejaba sin descripción
// a piezas como PZD/D ("DIVISOR DE PLACARD", solo existe como 'ESP'). Como
// para un mismo familia/articulo/idCatalogo pueden existir ambas filas, el
// join se hace con OUTER APPLY TOP 1 (prefiere 'ESP') para no duplicar filas
// (mismo fan-out del bug descrito arriba). Igual en fetchModulosDePedido.
// Filtro de "es una pieza de placar": d.idCatalogo = 4 (separa las líneas de
// producto) MÁS pertenecer a las familias de corte del catálogo 4 (ver
// FAMILIAS_DE_CORTE arriba) — no la lista fija PZA/PZC/PZD/PZP de diseño.md
// §3.2 original, que es la del catálogo 3.
// Confirmado con el Maestro de Productos de TeoWin que las mismas familias
// (ej. PZA) existen con artículos distintos en el catálogo 3 (Cocinas) y en
// el catálogo 4 (Placares) — filtrar solo por familia podía traer piezas de
// cocina mezcladas en un pedido que combinara ambos. El catálogo (idCatalogo)
// es la columna que TeoWin usa para separar líneas de producto.
export async function fetchOrdenDespiece(orden: number): Promise<TeowinDespieceRow[]> {
  return teowinQuery<TeowinDespieceRow>(
    `SELECT
        ofab.codigoOrdenFabricacion AS orden_fabricacion,
        d.presupuesto               AS pedido,
        d.idEscena                  AS modulo_id,
        d.codigo                    AS pieza_tipo_id,
        d.familia, d.articulo, d.color, d.idCatalogo,
        d.medida1, d.medida2,
        d.unidades,
        u.id                        AS idunico,
        ad.descripcion               AS pieza_descripcion
     FROM tOrdenesFabricacion ofab
     JOIN tdespieceLineaPresupuesto d
         ON d.presupuesto = ofab.codigoPresupuesto
     LEFT JOIN tdespieceLineaPresupuestoUnico u
         ON u.idDespiece = d.codigo
     OUTER APPLY (
         SELECT TOP 1 x.descripcion
         FROM tArticuloDescripciones x
         WHERE x.familia = d.familia
           AND x.articulo = d.articulo
           AND x.idCatalogo = d.idCatalogo
           AND x.idioma IN ('ESP', 'ES')
         ORDER BY CASE WHEN x.idioma = 'ESP' THEN 0 ELSE 1 END
     ) ad
     WHERE ofab.codigoOrdenFabricacion = @orden
       AND d.siEscandallo = 1
       AND d.idCatalogo = 4
       AND ${FAMILIAS_DE_CORTE}`,
    { orden },
  );
}

// diseño.md §8.2 "Nombre del cliente" / "referencia es de Pedido" — join
// documentado (tpedido.referencia, tpedido.codigo_cliente -> tcliente.codigo
// -> tcliente.nombreComercial), sin ejemplo de SELECT propio en el diseño.
export async function fetchPedidoInfo(codigoPedido: string): Promise<TeowinPedidoInfo | null> {
  const rows = await teowinQuery<TeowinPedidoInfo>(
    `SELECT p.codigo_pedido, p.referencia, c.nombreComercial
     FROM tpedido p
     LEFT JOIN tcliente c ON c.codigo = p.codigo_cliente
     WHERE p.codigo_pedido = @codigoPedido`,
    { codigoPedido },
  );
  return rows[0] ?? null;
}

// diseño.md §3.3 — descripción y medidas de cada módulo (fila raíz codigoPadre = -1)
// de un pedido dado. `ad.idCatalogo = padre.idCatalogo` evita el mismo
// problema de fan-out que en fetchOrdenDespiece (ver comentario ahí) —
// tArticuloDescripciones puede tener varias filas por familia/articulo/idioma
// con distinto idCatalogo.
export async function fetchModulosDePedido(codigoPedido: string): Promise<TeowinModuloInfo[]> {
  return teowinQuery<TeowinModuloInfo>(
    `SELECT
        padre.idEscena AS modulo_id,
        padre.familia  AS familia_mueble,
        padre.articulo AS articulo_mueble,
        ad.descripcion AS descripcion_mueble,
        padre.medida1  AS L,
        padre.medida2  AS H,
        padre.medida3  AS P
     FROM tdespieceLineaPresupuesto padre
     OUTER APPLY (
         SELECT TOP 1 x.descripcion
         FROM tArticuloDescripciones x
         WHERE x.familia = padre.familia
           AND x.articulo = padre.articulo
           AND x.idCatalogo = padre.idCatalogo
           AND x.idioma IN ('ESP', 'ES')
         ORDER BY CASE WHEN x.idioma = 'ESP' THEN 0 ELSE 1 END
     ) ad
     WHERE padre.presupuesto = @codigoPedido
       AND padre.codigoPadre = -1`,
    { codigoPedido },
  );
}
