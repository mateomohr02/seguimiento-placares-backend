import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Deshacer manual de Módulo (vuelve siempre a PENDIENTE). Regla ligada al
// modelo hijo: no se puede si alguna de sus piezas físicas está CORTADA
// (hay que deshacer primero cada pieza). Sin cascada hacia arriba: Pedido y
// Orden bajan a PENDIENTE solo con su propio botón.
export async function marcarModuloPendiente(id: string) {
  const modulo = await prisma.modulo.findUnique({ where: { id } });
  if (!modulo || modulo.estado === "ELIMINADO") {
    throw new AppError("Módulo no encontrado.", 404);
  }

  const cortadas = await prisma.piezaFisica.count({
    where: { despieceTipo: { modulo_id: id }, estado: "CORTADA" },
  });
  if (cortadas > 0) {
    throw new AppError(
      `No se puede pasar el módulo a Pendiente: tiene ${cortadas} ${cortadas === 1 ? "pieza finalizada" : "piezas finalizadas"}. Pasalas a Pendiente primero.`,
      409,
    );
  }

  return prisma.modulo.update({
    where: { id },
    data: { estado: "PENDIENTE" },
    include: { despieceTipos: { select: { id: true } } },
  });
}
