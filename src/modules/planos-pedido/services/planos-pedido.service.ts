import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

// Planos: imágenes (lo habitual) o PDF. Límite por archivo; una foto/captura
// de plano pesa 1–10 MB.
export const MAX_PLANO_BYTES = 40 * 1024 * 1024;
export const MIMES_PLANO = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
type MimePlano = (typeof MIMES_PLANO)[number];

// El tipo declarado por el cliente no alcanza: se verifica la firma del archivo.
function coincideFirma(mime: MimePlano, b: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/pdf":
      return b.subarray(0, 1024).includes("%PDF-");
  }
}

// Nunca se selecciona `contenido` al listar: son MB por fila.
const metaSelect = {
  id: true,
  pedido_id: true,
  nombre: true,
  nombre_archivo: true,
  mime: true,
  tamano: true,
  creado_en: true,
  modulo: { select: { id: true, idEscena: true, descripcion: true } },
} as const;

function toDTO<T extends { creado_en: Date }>(p: T) {
  return { ...p, creado_en: p.creado_en.toISOString() };
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

export async function listPlanosDePedido(pedidoId: string) {
  await assertPedidoVigente(pedidoId);
  const planos = await prisma.planoPedido.findMany({
    where: { pedido_id: pedidoId, eliminado_en: null },
    select: metaSelect,
    orderBy: { creado_en: "asc" },
  });
  return planos.map(toDTO);
}

export async function crearPlano(
  pedidoId: string,
  input: { nombre: string; nombreArchivo: string; moduloId?: string; mime: string; contenido: Buffer },
) {
  await assertPedidoVigente(pedidoId);
  if (!(MIMES_PLANO as readonly string[]).includes(input.mime)) {
    throw new AppError("Formato no soportado. Usá JPG, PNG, WEBP o PDF.", 415);
  }
  if (input.contenido.length === 0) throw new AppError("El archivo está vacío.", 400);
  if (input.contenido.length > MAX_PLANO_BYTES) throw new AppError("El archivo supera el tamaño máximo (40 MB).", 413);
  if (!coincideFirma(input.mime as MimePlano, input.contenido)) {
    throw new AppError("El contenido del archivo no coincide con su formato.", 400);
  }
  if (input.moduloId) {
    const modulo = await prisma.modulo.findUnique({ where: { id: input.moduloId }, select: { pedido_id: true, estado: true } });
    if (!modulo || modulo.pedido_id !== pedidoId || modulo.estado === "ELIMINADO") {
      throw new AppError("El módulo no pertenece a este pedido.", 400);
    }
  }
  const plano = await prisma.planoPedido.create({
    data: {
      pedido_id: pedidoId,
      modulo_id: input.moduloId ?? null,
      nombre: input.nombre,
      nombre_archivo: input.nombreArchivo,
      mime: input.mime,
      tamano: input.contenido.length,
      contenido: input.contenido,
    },
    select: metaSelect,
  });
  return toDTO(plano);
}

export async function getArchivoPlano(id: string) {
  const plano = await prisma.planoPedido.findUnique({
    where: { id },
    select: {
      contenido: true,
      nombre_archivo: true,
      mime: true,
      eliminado_en: true,
      pedido: { select: { estado: true, orden: { select: { estado: true } } } },
    },
  });
  if (!plano || plano.eliminado_en || plano.pedido.estado === "ELIMINADO" || plano.pedido.orden.estado === "ELIMINADO") {
    throw new AppError("Plano no encontrado.", 404);
  }
  return { contenido: Buffer.from(plano.contenido), nombreArchivo: plano.nombre_archivo, mime: plano.mime };
}

export async function eliminarPlano(id: string) {
  const plano = await prisma.planoPedido.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!plano || plano.eliminado_en) throw new AppError("Plano no encontrado.", 404);
  await prisma.planoPedido.update({ where: { id }, data: { eliminado_en: new Date() } });
}
