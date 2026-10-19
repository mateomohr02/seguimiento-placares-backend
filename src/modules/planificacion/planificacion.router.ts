import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { AppError } from "../../utils/AppError";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import { AREA_TERMOLAMINADO, fechaISO, parseFecha } from "../planillas/schemas/planilla.schema";
import { mimePorFirma } from "../planillas/services/fotos-operarios.service";

// Planificación semanal del área (pedidos y reclamos) que baja la oficina técnica, como
// archivo PDF o imagen (diseño.md §14.4). Se reutilizan los permisos de documentación:
// ver = documentacion.ver; subir y eliminar = documentacion.gestionar.
export const MAX_PLANIFICACION_BYTES = 40 * 1024 * 1024;
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export const planificacionRouter = Router();

// Lunes de la semana de una fecha (la semana de producción va de lunes a viernes).
function lunesDe(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(d.getTime() - dow * 86_400_000);
}

const meta = {
  id: true,
  tipo: true,
  semana_inicio: true,
  nombre: true,
  nombre_archivo: true,
  mime: true,
  tamano: true,
  creado_en: true,
} as const;

planificacionRouter.get(
  "/",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (_req, res) => {
    const docs = await prisma.planificacionSemanal.findMany({
      where: { area: AREA_TERMOLAMINADO, eliminado_en: null },
      select: meta,
      orderBy: [{ semana_inicio: "desc" }, { tipo: "asc" }, { creado_en: "desc" }],
      take: 60,
    });
    return sendResponse(res, 200, docs.map((d) => ({ ...d, semana_inicio: fechaISO(d.semana_inicio), creado_en: d.creado_en.toISOString() })));
  }),
);

const SubirQuery = z.object({
  tipo: z.enum(["PEDIDOS", "RECLAMOS"]),
  semana: z.string(),
  nombre: z.string().trim().max(80).optional(),
  archivo: z.string().trim().min(1).max(255),
});

planificacionRouter.post(
  "/",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  express.raw({ type: MIMES, limit: MAX_PLANIFICACION_BYTES }),
  catchAsync(async (req, res) => {
    const q = SubirQuery.parse(req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError("Se esperaba un PDF o una imagen (JPG, PNG, WEBP).", 415);
    const esPdf = req.body.subarray(0, 1024).includes("%PDF-");
    const mime = esPdf ? "application/pdf" : mimePorFirma(req.body);
    if (!mime) throw new AppError("El archivo no es un PDF ni una imagen válida.", 400);
    const semana = lunesDe(parseFecha(q.semana, "La semana"));
    const doc = await prisma.planificacionSemanal.create({
      data: {
        area: AREA_TERMOLAMINADO,
        tipo: q.tipo,
        semana_inicio: semana,
        nombre: q.nombre || (q.tipo === "PEDIDOS" ? "Planificación de pedidos" : "Reclamos"),
        nombre_archivo: q.archivo,
        mime,
        tamano: req.body.length,
        contenido: req.body,
      },
      select: meta,
    });
    return sendResponse(res, 201, { ...doc, semana_inicio: fechaISO(doc.semana_inicio), creado_en: doc.creado_en.toISOString() });
  }),
);

planificacionRouter.get(
  "/:id/archivo",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const d = await prisma.planificacionSemanal.findUnique({
      where: { id: parseIdParam(String(req.params.id)) },
      select: { contenido: true, mime: true, nombre_archivo: true, eliminado_en: true },
    });
    if (!d || d.eliminado_en) throw new AppError("Documento no encontrado.", 404);
    res.setHeader("Content-Type", d.mime);
    res.setHeader("Content-Length", d.contenido.length);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(d.nombre_archivo)}`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(Buffer.from(d.contenido));
  }),
);

planificacionRouter.delete(
  "/:id",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => {
    const id = parseIdParam(String(req.params.id));
    const d = await prisma.planificacionSemanal.findUnique({ where: { id }, select: { eliminado_en: true } });
    if (!d || d.eliminado_en) throw new AppError("Documento no encontrado.", 404);
    await prisma.planificacionSemanal.update({ where: { id }, data: { eliminado_en: new Date() } });
    return sendResponse(res, 200, null);
  }),
);
