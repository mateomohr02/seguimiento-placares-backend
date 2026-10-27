import type { LineaProducto, Pedido } from "@prisma/client";
import type { PedidoResponseDTO } from "../dtos/pedido-response.dto";
import { lineasDeModulos } from "../../sync/linea-producto";

export function toPedidoResponseDTO(
  pedido: Pedido & { modulos: { id: string; linea: LineaProducto }[] },
): PedidoResponseDTO {
  return {
    id: pedido.id,
    codigo_pedido: pedido.codigo_pedido,
    referencia: pedido.referencia,
    nombreComercial: pedido.nombreComercial,
    estado: pedido.estado,
    modulosCount: pedido.modulos.length,
    lineas: lineasDeModulos(pedido.modulos),
  };
}
