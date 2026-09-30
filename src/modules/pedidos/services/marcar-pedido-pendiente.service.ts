import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Deshacer manual de Pedido (vuelve siempre a PENDIENTE). Regla ligada al
// modelo hijo: todos sus módulos (no eliminados) tienen que estar PENDIENTE.
// Si la Orden estaba LISTA (todos los pedidos finalizados), deja de estarlo:
// vuelve a EN_PROCESO para no quedar inconsistente. No baja a PENDIENTE
// sola, eso es manual.
export async function marcarPedidoPendiente(id: string) {
  return prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.findUnique({ where: { id } });
    if (!pedido || pedido.estado === "ELIMINADO") {
      throw new AppError("Pedido no encontrado.", 404);
    }

    const noPendientes = await tx.modulo.count({
      where: { pedido_id: id, estado: { notIn: ["PENDIENTE", "ELIMINADO"] } },
    });
    if (noPendientes > 0) {
      throw new AppError(
        `No se puede pasar el pedido a Pendiente: tiene ${noPendientes} ${noPendientes === 1 ? "módulo" : "módulos"} en proceso o finalizados. Pasalos a Pendiente primero.`,
        409,
      );
    }

    await tx.pedido.update({ where: { id }, data: { estado: "PENDIENTE" } });
    await tx.orden.updateMany({
      where: { id: pedido.orden_id, estado: "LISTA" },
      data: { estado: "EN_PROCESO" },
    });

    return tx.pedido.findUniqueOrThrow({ where: { id }, include: { modulos: { select: { id: true } } } });
  });
}
