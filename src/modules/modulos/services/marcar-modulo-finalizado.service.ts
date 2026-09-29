import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// diseño.md §6 — confirmación manual de Módulo. Sin cascada hacia arriba ni
// hacia abajo: el paso a FINALIZADO en Pedido es un botón propio e
// independiente (§8.2 "El paso a FINALIZADO... es exclusivamente manual").
export async function marcarModuloFinalizado(id: string) {
  const modulo = await prisma.modulo.findUnique({ where: { id } });
  if (!modulo || modulo.estado === "ELIMINADO") {
    throw new AppError("Módulo no encontrado.", 404);
  }
  return prisma.modulo.update({
    where: { id },
    data: { estado: "FINALIZADO" },
    include: { despieceTipos: { select: { id: true } } },
  });
}
