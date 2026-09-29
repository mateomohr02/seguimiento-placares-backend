import { prisma } from "../../../config/prisma";

// diseño.md Vista 2 — pedidos de una orden.
export async function listPedidosDeOrden(ordenId: string) {
  return prisma.pedido.findMany({
    where: { orden_id: ordenId, estado: { not: "ELIMINADO" } },
    orderBy: { codigo_pedido: "asc" },
    include: { modulos: { select: { id: true } } },
  });
}
