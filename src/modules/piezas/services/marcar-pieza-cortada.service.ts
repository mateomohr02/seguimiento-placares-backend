import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { propagarDesdeModulo, recalcularDespieceTipo } from "../../estados/estados.service";

// diseño.md §6/§8.2 — cascada automática: al marcar una PiezaFisica como
// CORTADA (por escaneo en Vista 5, o por confirmación manual en Vista 4),
// se recalcula DespieceTipo → Modulo → Pedido → Orden (estados.service.ts):
// suben de PENDIENTE a EN_PRODUCCION (EN_PROCESO en Orden). Nunca escribe
// FINALIZADO en Módulo/Pedido acá — eso es manual (marcar-finalizado).
//
// PiezaFisica.estado no tiene un valor FINALIZADO propio (§8.2: solo
// PENDIENTE | CORTADA | ELIMINADA) — el botón "Marcar finalizado" a nivel
// pieza de la Vista 4 (§6, doble función: confirma piezas escaneadas y da
// por resueltas las que nunca pasan por Rover) usa este mismo camino,
// marcando CORTADA manualmente en vez de un estado separado.
export async function marcarPiezaCortada(where: { id: string } | { idUnico: number }) {
  return prisma.$transaction(async (tx) => {
    const include = {
      despieceTipo: {
        include: {
          modulo: {
            include: {
              pedido: { include: { orden: true } },
            },
          },
        },
      },
    } as const;

    // El índice único parcial (§8.3) garantiza a lo sumo una fila vigente por
    // idUnico, pero puede haber varias ELIMINADA históricas con el mismo
    // idUnico tras una resincronización — se busca primero la vigente, y
    // solo si no hay, una histórica para dar el mensaje de etiqueta inválida.
    const piezaFisica =
      "id" in where
        ? await tx.piezaFisica.findFirst({ where: { id: where.id }, include })
        : ((await tx.piezaFisica.findFirst({
            where: { idUnico: where.idUnico, estado: { not: "ELIMINADA" } },
            include,
          })) ??
          (await tx.piezaFisica.findFirst({
            where: { idUnico: where.idUnico, estado: "ELIMINADA" },
            orderBy: { creado_en: "desc" },
            include,
          })));

    if (!piezaFisica) {
      throw new AppError("No se encontró ninguna pieza con ese código.", 404);
    }

    if (piezaFisica.estado === "ELIMINADA") {
      throw new AppError(
        "Esta pieza pertenece a una orden que fue descartada/invalidada. La etiqueta ya no es válida — hay que reimprimirla.",
        410,
      );
    }

    // Si ya estaba CORTADA es un re-escaneo: el frontend lo muestra distinto.
    const yaEscaneada = piezaFisica.estado === "CORTADA";

    if (piezaFisica.estado === "PENDIENTE") {
      await tx.piezaFisica.update({
        where: { id: piezaFisica.id },
        data: { estado: "CORTADA", escaneado_en: new Date() },
      });
    }

    const { despieceTipo } = piezaFisica;
    const { modulo } = despieceTipo;
    const { pedido } = modulo;
    const { orden } = pedido;

    // Correspondencias de estado entre niveles: ver estados.service.ts
    await recalcularDespieceTipo(tx, despieceTipo.id);
    await propagarDesdeModulo(tx, modulo.id);

    return {
      yaEscaneada,
      pieza: {
        id: piezaFisica.id,
        idUnico: piezaFisica.idUnico,
        familia: despieceTipo.familia,
        articulo: despieceTipo.articulo,
        color: despieceTipo.color,
        descripcion: despieceTipo.descripcion,
        medida1: despieceTipo.medida1.toString(),
        medida2: despieceTipo.medida2.toString(),
      },
      modulo: { id: modulo.id, idEscena: modulo.idEscena, descripcion: modulo.descripcion },
      pedido: { id: pedido.id, codigo_pedido: pedido.codigo_pedido, referencia: pedido.referencia },
      orden: { id: orden.id, numeroOrdenCustom: orden.numeroOrdenCustom },
    };
  });
}
