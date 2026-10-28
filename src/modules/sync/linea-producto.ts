import type { LineaProducto } from "@prisma/client";

// Línea de producto de un módulo. Único lugar donde se mapea idCatalogo de TeoWin -> línea.
//
// Catálogos de TeoWin que se sincronizan: 3 = Cocinas, 4 = Placares (NO se incluyen 100242 ni
// 100265). Una orden/pedido puede ser mixto (módulos de ambas líneas) y se sincroniza una sola vez.
//
// CRITERIO de línea de un módulo (se guarda en Modulo.linea):
//  1. El idCatalogo de la fila raíz del módulo (tdespieceLineaPresupuesto con codigoPadre = -1,
//     la que describe al mueble completo): 3 -> COCINAS, 4 -> PLACARES.
//  2. Si la raíz es de otro catálogo (o no existe), se usa el catálogo dominante (el de más filas)
//     de las piezas de corte del módulo.
//  3. Si tampoco hay un catálogo reconocible, PLACARES (la línea histórica).
// Pedido y Orden no persisten línea: exponen `lineas` derivado de sus módulos.
export const CATALOGO_COCINAS = 3;
export const CATALOGO_PLACARES = 4;

/** Catálogos cuyas piezas de corte se sincronizan. */
export const CATALOGOS_SINCRONIZADOS = [CATALOGO_COCINAS, CATALOGO_PLACARES] as const;

const LINEA_POR_CATALOGO: Record<number, LineaProducto> = {
  [CATALOGO_COCINAS]: "COCINAS",
  [CATALOGO_PLACARES]: "PLACARES",
};

/** Orden canónico de las líneas al listarlas. */
export const LINEAS_ORDENADAS: LineaProducto[] = ["PLACARES", "COCINAS"];

export function lineaDeCatalogo(idCatalogo: number | null | undefined): LineaProducto | null {
  if (idCatalogo === null || idCatalogo === undefined) return null;
  return LINEA_POR_CATALOGO[Number(idCatalogo)] ?? null;
}

/** Línea de un módulo: catálogo de la raíz y, si no sirve, catálogo dominante de sus piezas de corte. */
export function lineaDeModulo(
  idCatalogoRaiz: number | null | undefined,
  idCatalogosDePiezas: number[],
): LineaProducto {
  const deRaiz = lineaDeCatalogo(idCatalogoRaiz);
  if (deRaiz) return deRaiz;

  const cuenta = new Map<number, number>();
  for (const c of idCatalogosDePiezas) {
    if (lineaDeCatalogo(c)) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
  }
  let mejor: number | null = null;
  for (const [c, n] of cuenta) {
    // Ante empate gana el catálogo menor, para que el resultado sea determinista.
    if (mejor === null || n > (cuenta.get(mejor) ?? 0) || (n === (cuenta.get(mejor) ?? 0) && c < mejor)) {
      mejor = c;
    }
  }
  return lineaDeCatalogo(mejor) ?? "PLACARES";
}

/** Líneas distintas de un conjunto de módulos, en orden canónico. */
export function lineasDeModulos(modulos: { linea: LineaProducto }[]): LineaProducto[] {
  const set = new Set(modulos.map((m) => m.linea));
  return LINEAS_ORDENADAS.filter((l) => set.has(l));
}

export function esLineaProducto(valor: unknown): valor is LineaProducto {
  return valor === "PLACARES" || valor === "COCINAS";
}
