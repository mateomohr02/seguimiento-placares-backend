import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// diseño.md §5.2 / Vista 1 "Descartar": soft delete en cascada, solo en la
// base propia (Postgres). Nada se borra físicamente — orden, pedidos,
// módulos, tipos de pieza pasan a ELIMINADO y las piezas físicas a
// ELIMINADA, con eliminado_en como auditoría — para conservar el historial
// de lo que se llegó a cortar (§4.2: un escaneo posterior de esas etiquetas
// se reconoce y responde 410). Liberar el estado ELIMINADO también libera
// los índices únicos parciales (§8.3): la orden se puede volver a agregar.
// TeoWin no se toca.
export async function eliminarOrden(id: string) {
  return prisma.$transaction(async (tx) => {
    const orden = await tx.orden.findUnique({ where: { id } });
    if (!orden || orden.estado === "ELIMINADO") {
      throw new AppError("Orden no encontrada.", 404);
    }

    const ahora = new Date();
    const deOrden = { modulo: { pedido: { orden_id: id } } };

    await tx.piezaFisica.updateMany({
      where: { despieceTipo: deOrden, estado: { not: "ELIMINADA" } },
      data: { estado: "ELIMINADA", eliminado_en: ahora },
    });
    await tx.despieceTipo.updateMany({
      where: { ...deOrden, estado: { not: "ELIMINADO" } },
      data: { estado: "ELIMINADO", eliminado_en: ahora },
    });
    await tx.modulo.updateMany({
      where: { pedido: { orden_id: id }, estado: { not: "ELIMINADO" } },
      data: { estado: "ELIMINADO", eliminado_en: ahora },
    });
    await tx.pedido.updateMany({
      where: { orden_id: id, estado: { not: "ELIMINADO" } },
      data: { estado: "ELIMINADO", eliminado_en: ahora },
    });

    return tx.orden.update({
      where: { id },
      data: { estado: "ELIMINADO", eliminado_en: ahora },
      include: { pedidos: { select: { id: true } } },
    });
  });
}
