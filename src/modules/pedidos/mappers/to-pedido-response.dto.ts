import type { Pedido } from "@prisma/client";
import type { PedidoResponseDTO } from "../dtos/pedido-response.dto";

export function toPedidoResponseDTO(
  pedido: Pedido & { modulos: { id: string }[] },
): PedidoResponseDTO {
  return {
    id: pedido.id,
    codigo_pedido: pedido.codigo_pedido,
    referencia: pedido.referencia,
    nombreComercial: pedido.nombreComercial,
    estado: pedido.estado,
    modulosCount: pedido.modulos.length,
  };
}
