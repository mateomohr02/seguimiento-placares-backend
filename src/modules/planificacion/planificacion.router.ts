import { Router } from "express";
import { z } from "zod";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { AppError } from "../../utils/AppError";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import type { Request } from "express";
import { actualizarItem, agregarObservacion, crearItem, editarObservacion, eliminarItem, eliminarObservacion, getSemana, marcarEstado, type Lector } from "./planificacion.service";

// Planificación semanal de Termolaminado cargada por sistema (diseño.md §14.4), montada en /api/planificacion.
// Ver: documentacion.ver. Cargar, editar y quitar filas: documentacion.gestionar (técnica). Marcar el estado de
// producción de una fila: cualquier usuario cuyas estaciones de trabajo activas tengan estado (`estado_id` en el body
// para elegir cuál si tiene varios). Observaciones de los usuarios (§14.13): las agrega cualquiera que vea la planificación;
// cada uno edita y borra las suyas y quien gestiona (técnica) puede borrar cualquiera. Todo queda en el historial.
export const planificacionRouter = Router();

const lectorDe = (req: Request): Lector => ({
  id: req.usuario!.id,
  nombre: req.usuario!.nombre_completo,
  puedeGestionar: req.usuario!.permisos.includes(PERMISOS.DOCUMENTACION_GESTIONAR),
});

const ObservacionSchema = z.object({
  texto: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, "Escribí la observación.").max(500, "La observación admite hasta 500 caracteres.")),
});

function parsearObservacion(body: unknown) {
  const r = ObservacionSchema.safeParse(body);
  if (r.success) return r.data;
  throw new AppError(r.error.issues[0].message, 400);
}

const texto = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().max(max).nullable());
const fechaOpc = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener el formato AAAA-MM-DD").nullable());

const ItemSchema = z
  .object({
    tipo: z.enum(["PEDIDOS", "RECLAMOS"]),
    semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La semana debe tener el formato AAAA-MM-DD."),
    cliente: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(120)),
    n_tw: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""), z.string().max(40)),
    n_orden: texto(40),
    modelo: texto(80),
    color: texto(80),
    fabrica: fechaOpc,
    fecha_limite: fechaOpc,
    distribuidor: texto(80),
    ticket: texto(40),
    tipo_reclamo: texto(200),
    compromiso: fechaOpc,
    finalizado_en: fechaOpc,
    observaciones: texto(500),
  })
  .refine((i) => i.cliente !== "" || i.n_tw !== "", { message: "Cargá al menos el cliente o el N° TW." });

function parsearItem(body: unknown) {
  const r = ItemSchema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const campo = issue.path[0] ? `${String(issue.path[0])}: ` : "";
  throw new AppError(`${campo}${issue.message}`, 400);
}

planificacionRouter.get(
  "/",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const semana = typeof req.query.semana === "string" && req.query.semana !== "" ? req.query.semana : undefined;
    return sendResponse(res, 200, await getSemana(semana, lectorDe(req)));
  }),
);

planificacionRouter.post(
  "/items",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => sendResponse(res, 201, await crearItem(parsearItem(req.body), lectorDe(req)))),
);

planificacionRouter.put(
  "/items/:id",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => sendResponse(res, 200, await actualizarItem(parseIdParam(String(req.params.id)), parsearItem(req.body), lectorDe(req)))),
);

planificacionRouter.delete(
  "/items/:id",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => {
    await eliminarItem(parseIdParam(String(req.params.id)));
    return sendResponse(res, 200, null);
  }),
);

planificacionRouter.put(
  "/items/:id/marca",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const { marcado, estado_id } = z.object({ marcado: z.boolean(), estado_id: z.string().uuid().optional() }).parse(req.body);
    return sendResponse(res, 200, await marcarEstado(parseIdParam(String(req.params.id)), lectorDe(req), marcado, estado_id));
  }),
);

planificacionRouter.post(
  "/items/:id/observaciones",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const { texto } = parsearObservacion(req.body);
    return sendResponse(res, 201, await agregarObservacion(parseIdParam(String(req.params.id)), texto, lectorDe(req)));
  }),
);

planificacionRouter.put(
  "/observaciones/:id",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const { texto } = parsearObservacion(req.body);
    return sendResponse(res, 200, await editarObservacion(parseIdParam(String(req.params.id)), texto, lectorDe(req)));
  }),
);

planificacionRouter.delete(
  "/observaciones/:id",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await eliminarObservacion(parseIdParam(String(req.params.id)), lectorDe(req)))),
);
