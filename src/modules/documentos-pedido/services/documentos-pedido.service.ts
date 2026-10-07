import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { MAX_PDF_BYTES } from "../../hojas-corte/services/hojas-corte.service";
import { ETIQUETA_TIPO, TIPOS_DOCUMENTO } from "../schemas/documento-pedido.schema";

type Tipo = (typeof TIPOS_DOCUMENTO)[number];

// Nunca se selecciona `contenido` al listar: son MB por fila.
const metaSelect = {
  id: true,
  pedido_id: true,
  tipo: true,
  nombre: true,
  nombre_archivo: true,
  tamano: true,
  creado_en: true,
} as const;

function toDTO<T extends { creado_en: Date }>(d: T) {
  return { ...d, creado_en: d.creado_en.toISOString() };
}

async function assertPedidoVigente(pedidoId: string) {
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    select: { estado: true, orden: { select: { estado: true } } },
  });
  if (!pedido || pedido.estado === "ELIMINADO" || pedido.orden.estado === "ELIMINADO") {
    throw new AppError("Pedido no encontrado.", 404);
  }
}

export async function listDocumentosDePedido(pedidoId: string) {
  await assertPedidoVigente(pedidoId);
  const docs = await prisma.documentoPedido.findMany({
    where: { pedido_id: pedidoId, eliminado_en: null },
    select: metaSelect,
    orderBy: [{ tipo: "asc" }, { creado_en: "asc" }],
  });
  return docs.map(toDTO);
}

export async function crearDocumento(
  pedidoId: string,
  input: { tipo: Tipo; nombre?: string; nombreArchivo: string; contenido: Buffer },
) {
  await assertPedidoVigente(pedidoId);
  if (input.contenido.length === 0) throw new AppError("El archivo está vacío.", 400);
  if (input.contenido.length > MAX_PDF_BYTES) throw new AppError("El PDF supera el tamaño máximo (40 MB).", 413);
  if (!input.contenido.subarray(0, 1024).includes("%PDF-")) {
    throw new AppError("El archivo no es un PDF válido.", 400);
  }
  const doc = await prisma.documentoPedido.create({
    data: {
      pedido_id: pedidoId,
      tipo: input.tipo,
      nombre: input.nombre || ETIQUETA_TIPO[input.tipo],
      nombre_archivo: input.nombreArchivo,
      tamano: input.contenido.length,
      contenido: input.contenido,
    },
    select: metaSelect,
  });
  return toDTO(doc);
}

export async function getArchivoDocumento(id: string) {
  const doc = await prisma.documentoPedido.findUnique({
    where: { id },
    select: {
      contenido: true,
      nombre_archivo: true,
      eliminado_en: true,
      pedido: { select: { estado: true, orden: { select: { estado: true } } } },
    },
  });
  if (!doc || doc.eliminado_en || doc.pedido.estado === "ELIMINADO" || doc.pedido.orden.estado === "ELIMINADO") {
    throw new AppError("Documento no encontrado.", 404);
  }
  return { contenido: Buffer.from(doc.contenido), nombreArchivo: doc.nombre_archivo };
}

export async function eliminarDocumento(id: string) {
  const doc = await prisma.documentoPedido.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!doc || doc.eliminado_en) throw new AppError("Documento no encontrado.", 404);
  await prisma.documentoPedido.update({ where: { id }, data: { eliminado_en: new Date() } });
}
