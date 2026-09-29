import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

export async function getPedido(id: string) {
  const pedido = await prisma.pedido.findUnique({
    where: { id },
    include: { orden: true, modulos: { select: { id: true } } },
  });
  if (!pedido || pedido.estado === "ELIMINADO") {
    throw new AppError("Pedido no encontrado.", 404);
  }
  return pedido;
}
