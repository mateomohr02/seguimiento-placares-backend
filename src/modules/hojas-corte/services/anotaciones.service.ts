import type { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import type { CreateAnotacionInput } from "../schemas/anotacion.schema";

export interface AnotacionResponseDTO {
  id: string;
  hoja_corte_id: string;
  pagina: number | null;
  tipo: "TEXTO" | "DIBUJO";
  datos: unknown;
  creado_en: string;
}

function toDTO(a: {
  id: string;
  hoja_corte_id: string;
  pagina: number | null;
  tipo: "TEXTO" | "DIBUJO";
  datos: unknown;
  creado_en: Date;
}): AnotacionResponseDTO {
  return { ...a, creado_en: a.creado_en.toISOString() };
}

async function assertHojaVigente(hojaId: string) {
  const hoja = await prisma.hojaCorte.findUnique({
    where: { id: hojaId },
    select: { eliminado_en: true, orden: { select: { estado: true } } },
  });
  if (!hoja || hoja.eliminado_en || hoja.orden.estado === "ELIMINADO") {
    throw new AppError("Hoja de corte no encontrada.", 404);
  }
}

export async function listAnotaciones(hojaId: string) {
  await assertHojaVigente(hojaId);
  const rows = await prisma.hojaCorteAnotacion.findMany({
    where: { hoja_corte_id: hojaId, eliminado_en: null },
    orderBy: { creado_en: "asc" },
  });
  return rows.map(toDTO);
}

export async function crearAnotacion(hojaId: string, input: CreateAnotacionInput) {
  await assertHojaVigente(hojaId);
  const row = await prisma.hojaCorteAnotacion.create({
    data: {
      hoja_corte_id: hojaId,
      pagina: input.pagina,
      tipo: input.tipo,
      datos: input.datos as Prisma.InputJsonValue,
    },
  });
  return toDTO(row);
}

export async function eliminarAnotacion(hojaId: string, anotacionId: string) {
  const row = await prisma.hojaCorteAnotacion.findUnique({ where: { id: anotacionId } });
  if (!row || row.hoja_corte_id !== hojaId || row.eliminado_en) {
    throw new AppError("Anotación no encontrada.", 404);
  }
  await prisma.hojaCorteAnotacion.update({ where: { id: anotacionId }, data: { eliminado_en: new Date() } });
}
