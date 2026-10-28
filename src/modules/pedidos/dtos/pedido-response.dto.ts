import type { LineaProducto } from "@prisma/client";

export interface PedidoResponseDTO {
  id: string;
  codigo_pedido: string;
  referencia: string;
  nombreComercial: string;
  estado: string;
  modulosCount: number;
  /** Líneas de producto del pedido (derivadas de sus módulos), en orden PLACARES, COCINAS. */
  lineas: LineaProducto[];
}
