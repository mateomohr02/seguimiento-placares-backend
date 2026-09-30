import type { Orden } from "@prisma/client";
import type { OrdenResponseDTO } from "../dtos/orden-response.dto";

export function toOrdenResponseDTO(
  orden: Orden & { pedidos: { id: string; codigo_pedido?: string }[] },
): OrdenResponseDTO {
  return {
    id: orden.id,
    codigoOrdenFabricacion: orden.codigoOrdenFabricacion,
    numeroOrdenCustom: orden.numeroOrdenCustom,
    descripcion: orden.descripcion,
    estado: orden.estado,
    creado_en: orden.creado_en.toISOString(),
    archivada_en: orden.archivada_en ? orden.archivada_en.toISOString() : null,
    pedidosCount: orden.pedidos.length,
    codigosPedido: orden.pedidos.flatMap((p) => (p.codigo_pedido ? [p.codigo_pedido] : [])),
  };
}
