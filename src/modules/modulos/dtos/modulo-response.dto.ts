import type { LineaProducto } from "@prisma/client";

/** Partida de TeoWin del módulo (detalle del presupuesto). */
export interface PartidaResponseDTO {
  unidades: number;
  referencia: string;
  titulo: string | null;
  /** Texto multilínea con \n, sin saltos finales. */
  descripcion: string;
  largo: number | null;
  alto: number | null;
  profundidad: number | null;
  capitulo: string | null;
  /** Importes: solo si el usuario tiene el permiso `modulos.precios`; si no, las claves no existen. */
  variantes?: number | null;
  precio?: number | null;
  total?: number | null;
}

export interface ModuloResponseDTO {
  id: string;
  idEscena: number;
  descripcion: string;
  /** Línea de producto del módulo: PLACARES (catálogo 4) o COCINAS (catálogo 3). */
  linea: LineaProducto;
  estado: string;
  despieceTiposCount: number;
  /** null si el módulo no tiene partida cargada. */
  partida: PartidaResponseDTO | null;
}
