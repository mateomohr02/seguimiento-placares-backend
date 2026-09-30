import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Archivar es solo visibilidad en el listado inicial: no toca `estado` (la
// orden sigue "vigente" para el índice único de §8.3 y el escaneo sigue
// funcionando sobre sus piezas).
export async function setOrdenArchivada(id: string, archivada: boolean) {
  const orden = await prisma.orden.findUnique({ where: { id } });
  if (!orden || orden.estado === "ELIMINADO") {
    throw new AppError("Orden no encontrada.", 404);
  }
  return prisma.orden.update({
    where: { id },
    data: { archivada_en: archivada ? new Date() : null },
    include: { pedidos: { select: { id: true } } },
  });
}
