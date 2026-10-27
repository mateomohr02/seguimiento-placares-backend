import type { LineaProducto } from "@prisma/client";

export interface OrdenResponseDTO {
  id: string;
  codigoOrdenFabricacion: number;
  numeroOrdenCustom: string;
  descripcion: string;
  estado: string;
  creado_en: string;
  archivada_en: string | null;
  pedidosCount: number;
  /** Códigos de pedido de la orden (para buscar por pedido en el listado). */
  codigosPedido: string[];
  /** Líneas de producto de la orden (derivadas de sus módulos), en orden PLACARES, COCINAS. Una orden mixta trae ambas. */
  lineas: LineaProducto[];
}
