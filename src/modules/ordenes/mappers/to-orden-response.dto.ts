import type { Orden } from "@prisma/client";
import type { OrdenResponseDTO } from "../dtos/orden-response.dto";

export function toOrdenResponseDTO(
  orden: Orden & { pedidos: { id: string }[] },
): OrdenResponseDTO {
  return {
    id: orden.id,
    codigoOrdenFabricacion: orden.codigoOrdenFabricacion,
    numeroOrdenCustom: orden.numeroOrdenCustom,
    descripcion: orden.descripcion,
    estado: orden.estado,
    creado_en: orden.creado_en.toISOString(),
    pedidosCount: orden.pedidos.length,
  };
}
