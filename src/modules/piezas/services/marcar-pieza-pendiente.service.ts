import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Deshacer de pieza: CORTADA -> PENDIENTE (limpia escaneado_en). Es el nivel
// hoja, no tiene hijos que lo bloqueen. No toca el estado de Módulo/Pedido/
// Orden: bajarlos a Pendiente es manual y exige que todos sus hijos estén
// Pendientes.
export async function marcarPiezaPendiente(id: string) {
  const pieza = await prisma.piezaFisica.findUnique({
    where: { id },
    include: { despieceTipo: { select: { modulo_id: true } } },
  });
  if (!pieza) {
    throw new AppError("Pieza no encontrada.", 404);
  }
  if (pieza.estado === "ELIMINADA") {
    throw new AppError("Esta pieza pertenece a una orden eliminada.", 410);
  }

  const actualizada = await prisma.piezaFisica.update({
    where: { id },
    data: { estado: "PENDIENTE", escaneado_en: null },
  });
  return { id: actualizada.id, estado: actualizada.estado, modulo_id: pieza.despieceTipo.modulo_id };
}
