import type { TeowinDespieceRow } from "./teowin-orden.types";

// Una fila de despiece de TeoWin NO equivale siempre a una pieza física:
// - Con etiqueta (filas en tdespieceLineaPresupuestoUnico): una pieza física
//   por cada idUnico.
// - Sin etiqueta, `unidades` puede ser fraccionario. Ej. los paneles PZPP/PAN
//   del pedido 26-02149: dos filas de 0,5 (323 x 688) = un panel, y cuatro de
//   0,25 (160 x 688) = otro panel. Contar una pieza por fila daba 6 en vez de 2
//   (y antes de incluir PZPP, 0). Se agrupan por tipo (mismo módulo, familia,
//   artículo, color y medidas) y se suman las unidades; cualquier resto
//   fraccionario cuenta como una pieza más (hay que cortarla igual).
// Las piezas sin etiqueta quedan con idUnico null: no se escanean, se dan por
// cortadas con el botón manual (diseño.md §6, mismo caso que los fondos).
export interface DespieceGrupo {
  pedido: string;
  modulo_id: number;
  familia: string;
  articulo: string;
  color: string;
  idCatalogo: number;
  medida1: number;
  medida2: number;
  pieza_descripcion: string | null;
  /** Un elemento por pieza física; null = sin etiqueta. */
  idUnicos: (number | null)[];
}

const EPSILON = 1e-6;

export function agruparDespiece(rows: TeowinDespieceRow[]): DespieceGrupo[] {
  const grupos = new Map<string, DespieceGrupo & { unidadesSinEtiqueta: number }>();

  for (const r of rows) {
    // Con etiqueta se agrupa por fila de despiece; sin etiqueta, por tipo.
    const key =
      r.idunico !== null
        ? `u|${r.pieza_tipo_id}`
        : `s|${r.pedido}|${r.modulo_id}|${r.familia}|${r.articulo}|${r.color}|${r.idCatalogo}|${r.medida1}|${r.medida2}`;

    let g = grupos.get(key);
    if (!g) {
      g = {
        pedido: r.pedido,
        modulo_id: r.modulo_id,
        familia: r.familia,
        articulo: r.articulo,
        color: r.color,
        idCatalogo: r.idCatalogo,
        medida1: r.medida1,
        medida2: r.medida2,
        pieza_descripcion: r.pieza_descripcion,
        idUnicos: [],
        unidadesSinEtiqueta: 0,
      };
      grupos.set(key, g);
    }

    if (r.idunico !== null) g.idUnicos.push(r.idunico);
    else g.unidadesSinEtiqueta += Number(r.unidades);
  }

  return [...grupos.values()].map(({ unidadesSinEtiqueta, ...g }) => {
    if (g.idUnicos.length === 0) {
      const cantidad = Math.max(1, Math.ceil(unidadesSinEtiqueta - EPSILON));
      g.idUnicos = Array.from({ length: cantidad }, () => null);
    }
    return g;
  });
}
