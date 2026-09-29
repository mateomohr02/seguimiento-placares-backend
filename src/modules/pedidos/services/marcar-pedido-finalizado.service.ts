import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// diseño.md §6/§8.2 — confirmación manual de Pedido. Es el único nivel que
// dispara una regla automática hacia arriba: Orden pasa a LISTA cuando el
// 100% de sus pedidos (no eliminados) están FINALIZADO (§9 punto 1: asunción
// que el propio diseño deja pendiente de confirmar, pero es la única que
// quedó documentada).
export async function marcarPedidoFinalizado(id: string) {
  return prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.findUnique({ where: { id } });
    if (!pedido || pedido.estado === "ELIMINADO") {
      throw new AppError("Pedido no encontrado.", 404);
    }

    await tx.pedido.update({ where: { id }, data: { estado: "FINALIZADO" } });

    const pedidosDeOrden = await tx.pedido.findMany({
      where: { orden_id: pedido.orden_id, estado: { not: "ELIMINADO" } },
    });
    const todosFinalizados = pedidosDeOrden.every(
      (p) => p.id === id || p.estado === "FINALIZADO",
    );

    if (todosFinalizados) {
      await tx.orden.update({ where: { id: pedido.orden_id }, data: { estado: "LISTA" } });
    }

    return tx.pedido.findUniqueOrThrow({ where: { id }, include: { modulos: { select: { id: true } } } });
  });
}
