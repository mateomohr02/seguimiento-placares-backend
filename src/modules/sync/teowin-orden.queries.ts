import { teowinQuery } from "../../config/teowin";
import type {
  TeowinDespieceRow,
  TeowinModuloInfo,
  TeowinOrdenCabecera,
  TeowinPedidoInfo,
} from "./teowin-orden.types";

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
// Filtro de "es una pieza de placar": d.idCatalogo = 4, NO familia IN
// ('PZA','PZC','PZD','PZP') como decía diseño.md §3.2 originalmente.
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
     LEFT JOIN tArticuloDescripciones ad
         ON ad.familia = d.familia
        AND ad.articulo = d.articulo
        AND ad.idioma = 'ES'
        AND ad.idCatalogo = d.idCatalogo
     WHERE ofab.codigoOrdenFabricacion = @orden
       AND d.siEscandallo = 1
       AND d.idCatalogo = 4`,
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
     LEFT JOIN tArticuloDescripciones ad
         ON ad.familia = padre.familia
        AND ad.articulo = padre.articulo
        AND ad.idioma = 'ES'
        AND ad.idCatalogo = padre.idCatalogo
     WHERE padre.presupuesto = @codigoPedido
       AND padre.codigoPadre = -1`,
    { codigoPedido },
  );
}
