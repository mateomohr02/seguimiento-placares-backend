import { prisma } from "../../../config/prisma";

// diseño.md Vista 3 — módulos de un pedido.
export async function listModulosDePedido(pedidoId: string) {
  return prisma.modulo.findMany({
    where: { pedido_id: pedidoId, estado: { not: "ELIMINADO" } },
    orderBy: { idEscena: "asc" },
    include: { despieceTipos: { select: { id: true } } },
  });
}
