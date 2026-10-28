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
  getFoto,
  MAX_FOTO_BYTES,
  MIMES_FOTO,
  ubicacionDeFila,
  ubicacionDeFoto,
} from "./services/fotos-operarios.service";
import { guardarEstados, listarEstados } from "./services/configuracion-usuarios.service";
import { exigirAcceso, exigirVisible, tiposVisibles } from "./services/acceso-planillas";

// Planillas de producción de Termolaminado (diseño.md §14). Montado en /api/planillas.
// Ver (tabla, indicadores, trazabilidad): planillas.ver. Completar y corregir: planillas.completar.
export const planillasRouter = Router();

// Acceso por estación de trabajo (diseño.md §17): ver acceso-planillas.ts.
// Completar exige ser miembro activo de la estación (que tenga ese tipo de planilla) o `planillas.configurar`.
// Ver: fabrica solo las planillas de sus estaciones; el resto de los roles, todas.

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

planillasRouter.get(
  "/dia/:estacionTrabajoId/:planilla/:fecha",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    const estacionTrabajoId = parseIdParam(String(req.params.estacionTrabajoId));
    const tipo = parseEstacion(String(req.params.planilla));
    return sendResponse(res, 200, await getPlanillaDelDia(req.usuario!, estacionTrabajoId, tipo, String(req.params.fecha)));
  }),
);

planillasRouter.put(
  "/dia/:estacionTrabajoId/:planilla/:fecha",
  requierePermiso(PERMISOS.PLANILLAS_COMPLETAR),
  catchAsync(async (req, res) => {
    const estacionTrabajoId = parseIdParam(String(req.params.estacionTrabajoId));
    const tipo = parseEstacion(String(req.params.planilla));
    const body = parsearPlanillaBody(req.body);
    const planilla = await guardarPlanilla(req.usuario!, estacionTrabajoId, tipo, String(req.params.fecha), body);
    return sendResponse(res, 200, planilla);
  }),
);

const RegistrosQuery = z.object({
  desde: z.string().optional(),
  hasta: z.string().optional(),
  /** Tipo de planilla (LIJADO, ENCOLADO, PVC). */
  estacion: z.string().optional(),
  /** Estación de trabajo. */
  estacion_trabajo_id: z.string().uuid().optional(),
  estado: z.enum(["BORRADOR", "GUARDADA"]).optional(),
  pedido: z.string().max(40).optional(),
});

planillasRouter.get(
  "/registros",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    const q = RegistrosQuery.parse(req.query);
    const u = req.usuario!;
    const estacion = q.estacion ? parseEstacion(q.estacion) : undefined;
    if (estacion && !tiposVisibles(u).includes(estacion)) throw new AppError("No tenés acceso a los registros de esta planilla.", 403);
    if (q.estacion_trabajo_id && u.rol === "fabrica" && !u.estaciones.some((e) => e.id === q.estacion_trabajo_id)) {
      throw new AppError("No tenés acceso a los registros de esa estación de trabajo.", 403);
    }
    return sendResponse(res, 200, await listarRegistros(u, { ...q, estacion }));
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
  catchAsync(async (req, res) => {
    if (tiposVisibles(req.usuario!).length === 0) throw new AppError("No tenés acceso a los registros de ninguna planilla.", 403);
    return sendResponse(res, 200, await trazabilidadDePedido(req.usuario!, str(req.query.pedido) ?? ""));
  }),
);

planillasRouter.get(
  "/pedidos-sugeridos",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await sugerirPedidos(req.usuario!, str(req.query.q) ?? ""))),
);

planillasRouter.get(
  "/colores",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await coloresUsados(req.usuario!))),
);

// La configuración por usuario (/planillas/accesos) se quitó: las planillas y el estado productivo los tiene la
// estación de trabajo (/api/estaciones-trabajo, diseño.md §17).

// Catálogo de estados de producción (los define técnica).
planillasRouter.get(
  "/estados",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (_req, res) => sendResponse(res, 200, await listarEstados())),
);

planillasRouter.put(
  "/estados",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (req, res) => {
    const { estados } = z
      .object({ estados: z.array(z.object({ id: z.string().uuid().optional(), nombre: z.string().max(60), color: z.string().max(7).nullable().optional() })).max(30) })
      .parse(req.body);
    return sendResponse(res, 200, await guardarEstados(estados));
  }),
);

planillasRouter.get(
  "/versiones/:id",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    return sendResponse(res, 200, await getVersion(req.usuario!, parseIdParam(String(req.params.id))));
  }),
);

planillasRouter.post(
  "/filas/:filaId/fotos",
  requierePermiso(PERMISOS.PLANILLAS_COMPLETAR),
  express.raw({ type: [...MIMES_FOTO], limit: MAX_FOTO_BYTES }),
  catchAsync(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError("Se esperaba una imagen (JPG, PNG o WEBP).", 415);
    const filaId = parseIdParam(String(req.params.filaId));
    exigirAcceso(req.usuario!, await ubicacionDeFila(filaId));
    return sendResponse(res, 201, await agregarFoto(filaId, req.body, req.usuario!.nombre_completo));
  }),
);

planillasRouter.get(
  "/fotos/:fotoId",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    const fotoId = parseIdParam(String(req.params.fotoId));
    exigirVisible(req.usuario!, await ubicacionDeFoto(fotoId));
    const { contenido, mime } = await getFoto(fotoId);
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
    exigirAcceso(req.usuario!, await ubicacionDeFoto(fotoId));
    await eliminarFoto(fotoId);
    return sendResponse(res, 200, null);
  }),
);

// Al final: `/:id` no tiene que tapar a las rutas fijas de arriba.
planillasRouter.get(
  "/:id",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    return sendResponse(res, 200, await getPlanilla(req.usuario!, parseIdParam(String(req.params.id))));
  }),
);
