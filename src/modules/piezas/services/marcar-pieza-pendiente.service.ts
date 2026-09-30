import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { propagarDesdeModulo, recalcularDespieceTipo } from "../../estados/estados.service";

// Deshacer de pieza: CORTADA -> PENDIENTE (limpia escaneado_en). Es el nivel
// hoja, no tiene hijos que lo bloqueen. Sus ancestros se recalculan solos
// (estados.service.ts): un Módulo/Pedido FINALIZADO o una Orden LISTA dejan de
// serlo, y si ya no queda ninguna pieza cortada vuelven a PENDIENTE.
export async function marcarPiezaPendiente(id: string) {
  return prisma.$transaction(async (tx) => {
    const pieza = await tx.piezaFisica.findUnique({
      where: { id },
      include: { despieceTipo: { select: { id: true, modulo_id: true } } },
    });
    if (!pieza) {
      throw new AppError("Pieza no encontrada.", 404);
    }
    if (pieza.estado === "ELIMINADA") {
      throw new AppError("Esta pieza pertenece a una orden eliminada.", 410);
    }

    const actualizada = await tx.piezaFisica.update({
      where: { id },
      data: { estado: "PENDIENTE", escaneado_en: null },
    });
    await recalcularDespieceTipo(tx, pieza.despieceTipo.id);
    await propagarDesdeModulo(tx, pieza.despieceTipo.modulo_id);

    return { id: actualizada.id, estado: actualizada.estado, modulo_id: pieza.despieceTipo.modulo_id };
  });
}
