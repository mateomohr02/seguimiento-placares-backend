import type { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import type { CreateAnotacionInput } from "../../hojas-corte/schemas/anotacion.schema";

// Mismo contrato que las anotaciones de hojas de corte (coordenadas normalizadas).
function toDTO(a: {
  id: string;
  plano_pedido_id: string;
  pagina: number | null;
  tipo: "TEXTO" | "DIBUJO";
  datos: unknown;
  creado_en: Date;
}) {
  return { ...a, creado_en: a.creado_en.toISOString() };
}

async function assertPlanoVigente(id: string) {
  const plano = await prisma.planoPedido.findUnique({
    where: { id },
    select: { eliminado_en: true, pedido: { select: { estado: true, orden: { select: { estado: true } } } } },
  });
  if (!plano || plano.eliminado_en || plano.pedido.estado === "ELIMINADO" || plano.pedido.orden.estado === "ELIMINADO") {
    throw new AppError("Plano no encontrado.", 404);
  }
}

export async function listAnotacionesPlano(planoId: string) {
  await assertPlanoVigente(planoId);
  const rows = await prisma.planoPedidoAnotacion.findMany({
    where: { plano_pedido_id: planoId, eliminado_en: null },
    orderBy: { creado_en: "asc" },
  });
  return rows.map(toDTO);
}

export async function crearAnotacionPlano(planoId: string, input: CreateAnotacionInput) {
  await assertPlanoVigente(planoId);
  const row = await prisma.planoPedidoAnotacion.create({
    data: {
      plano_pedido_id: planoId,
      pagina: input.pagina,
      tipo: input.tipo,
      datos: input.datos as Prisma.InputJsonValue,
    },
  });
  return toDTO(row);
}

export async function eliminarAnotacionPlano(planoId: string, anotacionId: string) {
  const row = await prisma.planoPedidoAnotacion.findUnique({ where: { id: anotacionId } });
  if (!row || row.plano_pedido_id !== planoId || row.eliminado_en) {
    throw new AppError("Anotación no encontrada.", 404);
  }
  await prisma.planoPedidoAnotacion.update({ where: { id: anotacionId }, data: { eliminado_en: new Date() } });
}
