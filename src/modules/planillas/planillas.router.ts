import express, { Router } from "express";
import { z } from "zod";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { AppError } from "../../utils/AppError";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import { parsearPlanillaBody, parseEstacion } from "./schemas/planilla.schema";
import {
  coloresUsados,
  getPlanilla,
  getPlanillaDelDia,
  getVersion,
  guardarPlanilla,
  indicadores,
  listarRegistros,
  sugerirPedidos,
  trazabilidadDePedido,
} from "./services/planillas.service";
import {
  agregarFoto,
  eliminarFoto,
  estacionDeFila,
  estacionDeFoto,
  guardarAccesos,
  listarAccesos,
  getFoto,
  guardarOperarios,
  listarOperarios,
  MAX_FOTO_BYTES,
  MIMES_FOTO,
} from "./services/fotos-operarios.service";

// Planillas de producción de Termolaminado (diseño.md §14). Montado en /api/planillas.
// Ver (tabla, indicadores, trazabilidad): planillas.ver. Completar y corregir: planillas.completar.
export const planillasRouter = Router();

// Completar una planilla exige el permiso (en la ruta) y tener asignada esa estación.
function exigirAcceso(asignadas: string[], estacion: string) {
  if (!asignadas.includes(estacion)) throw new AppError("No tenés acceso a esta planilla.", 403);
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

planillasRouter.get(
  "/dia/:estacion/:fecha",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    return sendResponse(res, 200, await getPlanillaDelDia(parseEstacion(String(req.params.estacion)), String(req.params.fecha)));
  }),
);

planillasRouter.put(
  "/dia/:estacion/:fecha",
  requierePermiso(PERMISOS.PLANILLAS_COMPLETAR),
  catchAsync(async (req, res) => {
    const estacion = parseEstacion(String(req.params.estacion));
    exigirAcceso(req.usuario!.planillas, estacion);
    const body = parsearPlanillaBody(req.body);
    const planilla = await guardarPlanilla(estacion, String(req.params.fecha), body, req.usuario!.nombre);
    return sendResponse(res, 200, planilla);
  }),
);

const RegistrosQuery = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  estacion: z.string().optional(),
  estado: z.enum(["BORRADOR", "GUARDADA"]).optional(),
  pedido: z.string().max(40).optional(),
});

planillasRouter.get(
  "/registros",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    const q = RegistrosQuery.parse(req.query);
    return sendResponse(
      res,
      200,
      await listarRegistros({ ...q, estacion: q.estacion ? parseEstacion(q.estacion) : undefined }),
    );
  }),
);

planillasRouter.get(
  "/indicadores",
  requierePermiso(PERMISOS.PLANILLAS_INDICADORES),
  catchAsync(async (req, res) => sendResponse(res, 200, await indicadores(str(req.query.desde), str(req.query.hasta)))),
);

planillasRouter.get(
  "/trazabilidad",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await trazabilidadDePedido(str(req.query.pedido) ?? ""))),
);

planillasRouter.get(
  "/pedidos-sugeridos",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await sugerirPedidos(str(req.query.q) ?? ""))),
);

planillasRouter.get(
  "/colores",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (_req, res) => sendResponse(res, 200, await coloresUsados())),
);

planillasRouter.get(
  "/operarios",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (_req, res) => sendResponse(res, 200, await listarOperarios())),
);

planillasRouter.put(
  "/operarios",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (req, res) => {
    const { operarios } = z.object({ operarios: z.array(z.string().max(60)).max(10) }).parse(req.body);
    return sendResponse(res, 200, await guardarOperarios(operarios));
  }),
);

// Qué planillas completa cada usuario (lo configura técnica).
planillasRouter.get(
  "/accesos",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (_req, res) => sendResponse(res, 200, await listarAccesos())),
);

planillasRouter.put(
  "/accesos/:usuarioId",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (req, res) => {
    const { estaciones } = z.object({ estaciones: z.array(z.string()).max(3) }).parse(req.body);
    await guardarAccesos(parseIdParam(String(req.params.usuarioId)), estaciones);
    return sendResponse(res, 200, await listarAccesos());
  }),
);

planillasRouter.get(
  "/versiones/:id",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await getVersion(parseIdParam(String(req.params.id))))),
);

planillasRouter.post(
  "/filas/:filaId/fotos",
  requierePermiso(PERMISOS.PLANILLAS_COMPLETAR),
  express.raw({ type: [...MIMES_FOTO], limit: MAX_FOTO_BYTES }),
  catchAsync(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError("Se esperaba una imagen (JPG, PNG o WEBP).", 415);
    const filaId = parseIdParam(String(req.params.filaId));
    exigirAcceso(req.usuario!.planillas, await estacionDeFila(filaId));
    return sendResponse(res, 201, await agregarFoto(filaId, req.body, req.usuario!.nombre));
  }),
);

planillasRouter.get(
  "/fotos/:fotoId",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    const { contenido, mime } = await getFoto(parseIdParam(String(req.params.fotoId)));
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", contenido.length);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(contenido);
  }),
);

planillasRouter.delete(
  "/fotos/:fotoId",
  requierePermiso(PERMISOS.PLANILLAS_COMPLETAR),
  catchAsync(async (req, res) => {
    const fotoId = parseIdParam(String(req.params.fotoId));
    exigirAcceso(req.usuario!.planillas, await estacionDeFoto(fotoId));
    await eliminarFoto(fotoId);
    return sendResponse(res, 200, null);
  }),
);

// Al final: `/:id` no tiene que tapar a las rutas fijas de arriba.
planillasRouter.get(
  "/:id",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await getPlanilla(parseIdParam(String(req.params.id))))),
);
