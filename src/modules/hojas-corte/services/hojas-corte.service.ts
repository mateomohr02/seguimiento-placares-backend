import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import type { HojaCorteResponseDTO } from "../dtos/hoja-corte-response.dto";

export const MAX_PDF_BYTES = 40 * 1024 * 1024;

// Nunca se selecciona `contenido` al listar: son MB por fila.
const metaSelect = {
  id: true,
  orden_id: true,
  nombre: true,
  nombre_archivo: true,
  tamano: true,
  creado_en: true,
} as const;

function toDTO(h: {
  id: string;
  orden_id: string;
  nombre: string;
  nombre_archivo: string;
  tamano: number;
  creado_en: Date;
}): HojaCorteResponseDTO {
  return { ...h, creado_en: h.creado_en.toISOString() };
}

async function assertOrdenVigente(ordenId: string) {
  const orden = await prisma.orden.findUnique({ where: { id: ordenId }, select: { estado: true } });
  if (!orden || orden.estado === "ELIMINADO") throw new AppError("Orden no encontrada.", 404);
}

export async function listHojasDeOrden(ordenId: string) {
  await assertOrdenVigente(ordenId);
  const hojas = await prisma.hojaCorte.findMany({
    where: { orden_id: ordenId, eliminado_en: null },
    select: metaSelect,
    orderBy: [{ nombre: "asc" }, { creado_en: "asc" }],
  });
  return hojas.map(toDTO);
}

export async function crearHoja(ordenId: string, input: { nombre: string; nombreArchivo: string; contenido: Buffer }) {
  await assertOrdenVigente(ordenId);
  if (input.contenido.length === 0) throw new AppError("El archivo está vacío.", 400);
  if (input.contenido.length > MAX_PDF_BYTES) throw new AppError("El PDF supera el tamaño máximo (40 MB).", 413);
  // Firma %PDF- (puede haber basura de hasta 1024 bytes antes, según la especificación).
  if (!input.contenido.subarray(0, 1024).includes("%PDF-")) {
    throw new AppError("El archivo no es un PDF válido.", 400);
  }
  const hoja = await prisma.hojaCorte.create({
    data: {
      orden_id: ordenId,
      nombre: input.nombre,
      nombre_archivo: input.nombreArchivo,
      tamano: input.contenido.length,
      contenido: input.contenido,
    },
    select: metaSelect,
  });
  return toDTO(hoja);
}

export async function getArchivoHoja(id: string) {
  const hoja = await prisma.hojaCorte.findUnique({
    where: { id },
    select: { contenido: true, nombre_archivo: true, eliminado_en: true, orden: { select: { estado: true } } },
  });
  if (!hoja || hoja.eliminado_en || hoja.orden.estado === "ELIMINADO") {
    throw new AppError("Hoja de corte no encontrada.", 404);
  }
  return { contenido: Buffer.from(hoja.contenido), nombreArchivo: hoja.nombre_archivo };
}

export async function eliminarHoja(id: string) {
  const hoja = await prisma.hojaCorte.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!hoja || hoja.eliminado_en) throw new AppError("Hoja de corte no encontrada.", 404);
  await prisma.hojaCorte.update({ where: { id }, data: { eliminado_en: new Date() } });
}
