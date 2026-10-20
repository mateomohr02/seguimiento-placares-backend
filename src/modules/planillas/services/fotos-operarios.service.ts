import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";

export const MAX_FOTO_BYTES = 8 * 1024 * 1024;
export const MAX_FOTOS_POR_FILA = 12;
export const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;

// Tipo real según la firma del archivo (no se confía en lo que declara el cliente).
export function mimePorFirma(b: Buffer): (typeof MIMES_FOTO)[number] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

// Fotos de la pieza antes de termolaminar: solo en filas de la planilla PVC.
export async function agregarFoto(filaId: string, contenido: Buffer, usuario: string) {
  if (contenido.length === 0) throw new AppError("La imagen está vacía.", 400);
  if (contenido.length > MAX_FOTO_BYTES) throw new AppError("La foto supera el tamaño máximo (8 MB).", 413);
  const mime = mimePorFirma(contenido);
  if (!mime) throw new AppError("El archivo no es una imagen válida (JPG, PNG o WEBP).", 415);

  const fila = await prisma.planillaFila.findUnique({
    where: { id: filaId },
    select: { planilla_id: true, planilla: { select: { estacion: true } }, _count: { select: { fotos: { where: { eliminado_en: null } } } } },
  });
  if (!fila) throw new AppError("Fila no encontrada.", 404);
  if (fila.planilla.estacion !== "PVC") throw new AppError("Solo las filas de PVC llevan fotos.", 400);
  if (fila._count.fotos >= MAX_FOTOS_POR_FILA) throw new AppError(`Una fila admite hasta ${MAX_FOTOS_POR_FILA} fotos.`, 400);

  const foto = await prisma.planillaFoto.create({
    data: { fila_id: filaId, mime, tamano: contenido.length, contenido },
    select: { id: true, mime: true, tamano: true, creado_en: true },
  });
  await prisma.planillaProduccion.update({ where: { id: fila.planilla_id }, data: { actualizado_en: new Date(), modificado_por: usuario } });
  return { ...foto, creado_en: foto.creado_en.toISOString() };
}

export async function getFoto(id: string) {
  const f = await prisma.planillaFoto.findUnique({ where: { id }, select: { contenido: true, mime: true, eliminado_en: true } });
  if (!f || f.eliminado_en) throw new AppError("Foto no encontrada.", 404);
  return { contenido: Buffer.from(f.contenido), mime: f.mime };
}

export async function eliminarFoto(id: string) {
  const f = await prisma.planillaFoto.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!f || f.eliminado_en) throw new AppError("Foto no encontrada.", 404);
  await prisma.planillaFoto.update({ where: { id }, data: { eliminado_en: new Date() } });
}

// Estación de la planilla a la que pertenece una fila o una foto (para exigir el acceso asignado).
export async function estacionDeFila(filaId: string) {
  const f = await prisma.planillaFila.findUnique({ where: { id: filaId }, select: { planilla: { select: { estacion: true } } } });
  if (!f) throw new AppError("Fila no encontrada.", 404);
  return f.planilla.estacion;
}

export async function estacionDeFoto(fotoId: string) {
  const f = await prisma.planillaFoto.findUnique({ where: { id: fotoId }, select: { fila: { select: { planilla: { select: { estacion: true } } } } } });
  if (!f) throw new AppError("Foto no encontrada.", 404);
  return f.fila.planilla.estacion;
}
