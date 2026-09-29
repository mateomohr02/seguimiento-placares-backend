import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

export async function getModulo(id: string) {
  const modulo = await prisma.modulo.findUnique({
    where: { id },
    include: { pedido: { include: { orden: true } }, despieceTipos: { select: { id: true } } },
  });
  if (!modulo || modulo.estado === "ELIMINADO") {
    throw new AppError("Módulo no encontrado.", 404);
  }
  return modulo;
}
