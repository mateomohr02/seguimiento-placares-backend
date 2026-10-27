import type { LineaProducto } from "@prisma/client";
import { prisma } from "../../../config/prisma";

// diseño.md Vista 1 — listado de órdenes vigentes (no eliminadas). Por
// defecto oculta las archivadas; con `archivadas: true` devuelve solo esas.
// Con `linea` devuelve solo las órdenes que tienen al menos un módulo de esa
// línea (una orden mixta aparece tanto en PLACARES como en COCINAS).
export async function listOrdenes({ archivadas, linea }: { archivadas: boolean; linea?: LineaProducto }) {
  return prisma.orden.findMany({
    where: {
      estado: { not: "ELIMINADO" },
      archivada_en: archivadas ? { not: null } : null,
      ...(linea
        ? { pedidos: { some: { estado: { not: "ELIMINADO" }, modulos: { some: { estado: { not: "ELIMINADO" }, linea } } } } }
        : {}),
    },
    orderBy: { creado_en: "desc" },
    include: {
      // codigo_pedido: el buscador del listado también encuentra órdenes por pedido.
      pedidos: {
        where: { estado: { not: "ELIMINADO" } },
        select: { id: true, codigo_pedido: true, modulos: { where: { estado: { not: "ELIMINADO" } }, select: { linea: true } } },
      },
    },
  });
}
