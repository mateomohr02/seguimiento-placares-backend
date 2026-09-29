import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

export async function getOrden(id: string) {
  const orden = await prisma.orden.findUnique({ where: { id }, include: { pedidos: { select: { id: true } } } });
  if (!orden || orden.estado === "ELIMINADO") {
    throw new AppError("Orden no encontrada.", 404);
  }
  return orden;
}
