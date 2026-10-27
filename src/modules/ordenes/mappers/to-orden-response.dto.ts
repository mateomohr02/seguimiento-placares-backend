import type { LineaProducto, Orden } from "@prisma/client";
import type { OrdenResponseDTO } from "../dtos/orden-response.dto";
import { lineasDeModulos } from "../../sync/linea-producto";

export function toOrdenResponseDTO(
  orden: Orden & {
    pedidos: { id: string; codigo_pedido?: string; modulos: { linea: LineaProducto }[] }[];
  },
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
    lineas: lineasDeModulos(orden.pedidos.flatMap((p) => p.modulos)),
  };
}
