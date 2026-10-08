import type { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import type { CreateAnotacionInput } from "../../hojas-corte/schemas/anotacion.schema";

// Mismo contrato que las anotaciones de hojas de corte (coordenadas normalizadas).
function toDTO(a: {
  id: string;
  documento_pedido_id: string;
  pagina: number | null;
  tipo: "TEXTO" | "DIBUJO";
  datos: unknown;
  creado_en: Date;
}) {
  return { ...a, creado_en: a.creado_en.toISOString() };
}

async function assertDocumentoVigente(id: string) {
  const doc = await prisma.documentoPedido.findUnique({
    where: { id },
    select: { eliminado_en: true, pedido: { select: { estado: true, orden: { select: { estado: true } } } } },
  });
  if (!doc || doc.eliminado_en || doc.pedido.estado === "ELIMINADO" || doc.pedido.orden.estado === "ELIMINADO") {
    throw new AppError("Documento no encontrado.", 404);
  }
}

export async function listAnotacionesDocumento(documentoId: string) {
  await assertDocumentoVigente(documentoId);
  const rows = await prisma.documentoPedidoAnotacion.findMany({
    where: { documento_pedido_id: documentoId, eliminado_en: null },
    orderBy: { creado_en: "asc" },
  });
  return rows.map(toDTO);
}

export async function crearAnotacionDocumento(documentoId: string, input: CreateAnotacionInput) {
  await assertDocumentoVigente(documentoId);
  const row = await prisma.documentoPedidoAnotacion.create({
    data: {
      documento_pedido_id: documentoId,
      pagina: input.pagina,
      tipo: input.tipo,
      datos: input.datos as Prisma.InputJsonValue,
    },
  });
  return toDTO(row);
}

export async function eliminarAnotacionDocumento(documentoId: string, anotacionId: string) {
  const row = await prisma.documentoPedidoAnotacion.findUnique({ where: { id: anotacionId } });
  if (!row || row.documento_pedido_id !== documentoId || row.eliminado_en) {
    throw new AppError("Anotación no encontrada.", 404);
  }
  await prisma.documentoPedidoAnotacion.update({ where: { id: anotacionId }, data: { eliminado_en: new Date() } });
}
