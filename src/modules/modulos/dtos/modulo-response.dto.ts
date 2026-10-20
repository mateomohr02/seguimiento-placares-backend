import type { LineaProducto } from "@prisma/client";

export interface ModuloResponseDTO {
  id: string;
  idEscena: number;
  descripcion: string;
  /** Línea de producto del módulo: PLACARES (catálogo 4) o COCINAS (catálogo 3). */
  linea: LineaProducto;
  estado: string;
  despieceTiposCount: number;
}
