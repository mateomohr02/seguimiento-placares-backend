import { prisma } from "../../../config/prisma";

// diseño.md Vista 1 — listado de órdenes vigentes (no eliminadas). Por
// defecto oculta las archivadas; con `archivadas: true` devuelve solo esas.
export async function listOrdenes({ archivadas }: { archivadas: boolean }) {
  return prisma.orden.findMany({
    where: {
      estado: { not: "ELIMINADO" },
      archivada_en: archivadas ? { not: null } : null,
    },
    orderBy: { creado_en: "desc" },
    include: {
      // codigo_pedido: el buscador del listado también encuentra órdenes por pedido.
      pedidos: { where: { estado: { not: "ELIMINADO" } }, select: { id: true, codigo_pedido: true } },
    },
  });
}
