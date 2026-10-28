import { Router } from "express";
import type { Request } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import {
  parsearBuscarEnEstacion,
  parsearBuscarPedidos,
  parsearItem,
  parsearMarca,
  parsearObservacion,
  parsearReordenar,
} from "./schemas/planificacion.schema";
import {
  actualizarItem,
  agregarObservacion,
  buscarEnEstacion,
  buscarPedidos,
  crearItem,
  editarObservacion,
  eliminarItem,
  eliminarObservacion,
  estacionesVisibles,
  getSemana,
  marcarEstado,
  reordenarItems,
  type Lector,
} from "./planificacion.service";

// Planificación semanal por estación de trabajo (diseño.md §14.4), montada en /api/planificacion.
// Ver: documentacion.ver (fábrica: solo las estaciones donde es miembro; admin, técnica y gerencia: todas las que tienen
// plantilla de planificación). Cargar, editar, quitar y reordenar filas: documentacion.gestionar (técnica), en cualquier
// estación. Marcar el estado de producción de una fila: cualquier usuario cuyas estaciones de trabajo activas tengan estado
// (`estado_id` en el body para elegir cuál si tiene varios; no depende de la estación que se esté mirando). Observaciones
// de los usuarios (§14.13): las agrega cualquiera que vea la planificación; cada uno edita y borra las suyas y quien gestiona
// (técnica) puede borrar cualquiera. Todo queda en el historial.
export const planificacionRouter = Router();

const lectorDe = (req: Request): Lector => ({
  id: req.usuario!.id,
  nombre: req.usuario!.nombre_completo,
  rol: req.usuario!.rol,
  puedeGestionar: req.usuario!.permisos.includes(PERMISOS.DOCUMENTACION_GESTIONAR),
});

const quiereTexto = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

planificacionRouter.get(
  "/estaciones",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await estacionesVisibles(lectorDe(req)))),
);

planificacionRouter.get(
  "/pedidos",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => {
    const { q, limit } = parsearBuscarPedidos(req.query);
    return sendResponse(res, 200, await buscarPedidos(q, limit));
  }),
);

planificacionRouter.get(
  "/buscar",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const { estacion, q } = parsearBuscarEnEstacion(req.query);
    return sendResponse(res, 200, await buscarEnEstacion(estacion, q, lectorDe(req)));
  }),
);

planificacionRouter.get(
  "/",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const estacion = quiereTexto(req.query.estacion);
    return sendResponse(res, 200, await getSemana(estacion === undefined ? undefined : parseIdParam(estacion), quiereTexto(req.query.semana), lectorDe(req)));
  }),
);

planificacionRouter.put(
  "/reordenar",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => {
    await reordenarItems(parsearReordenar(req.body));
    return res.status(204).end();
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
    const { marcado, estado_id } = parsearMarca(req.body);
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
