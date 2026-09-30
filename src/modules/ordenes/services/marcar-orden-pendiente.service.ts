import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Deshacer manual de Orden (vuelve siempre a PENDIENTE). Regla ligada al
// modelo hijo: todos sus pedidos (no eliminados) tienen que estar PENDIENTE.
export async function marcarOrdenPendiente(id: string) {
  const orden = await prisma.orden.findUnique({ where: { id } });
  if (!orden || orden.estado === "ELIMINADO") {
    throw new AppError("Orden no encontrada.", 404);
  }

  const noPendientes = await prisma.pedido.count({
    where: { orden_id: id, estado: { notIn: ["PENDIENTE", "ELIMINADO"] } },
  });
  if (noPendientes > 0) {
    throw new AppError(
      `No se puede pasar la orden a Pendiente: tiene ${noPendientes} ${noPendientes === 1 ? "pedido" : "pedidos"} en proceso o finalizados. Pasalos a Pendiente primero.`,
      409,
    );
  }

  return prisma.orden.update({
    where: { id },
    data: { estado: "PENDIENTE" },
    include: { pedidos: { select: { id: true } } },
  });
}
