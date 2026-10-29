import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { AppError } from "../../utils/AppError";
import { MAX_ARCHIVO_BYTES } from "./importar/importar.parser";
import { parsearConfirmar } from "./importar/importar.schema";
import { confirmar, previsualizar } from "./importar/importar.service";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import {
  parsearBuscarEnPlanificacion,
  parsearBuscarPedidos,
  parsearPedidoPorTw,
  parsearItem,
  parsearMarca,
  parsearObservacion,
  parsearReordenar,
} from "./schemas/planificacion.schema";
import {
  actualizarItem,
  agregarObservacion,
  buscarEnPlanificacion,
  buscarPedidoPorNTw,
  buscarPedidos,
  crearItem,
  editarObservacion,
  eliminarItem,
  eliminarObservacion,
  getSemana,
  marcarEstado,
  planificacionesVisibles,
  reordenarItems,
  type Lector,
} from "./planificacion.service";

// Planificaciones semanales (diseño.md §14.4 y §19.5), montadas en /api/planificacion. Son independientes de las estaciones: el
// catálogo es TERMOLAMINADO (por semana) y CALIDAD (por día, lunes a sábado); el parámetro/campo `plantilla` elige cuál.
// Ver: documentacion.ver (admin, técnica y gerencia: todas las del catálogo; fábrica: las asignadas a sus estaciones activas, sin
// repetir). Cargar, editar, quitar, reordenar e importar filas: documentacion.gestionar (técnica), en cualquier planificación.
// Marcar el estado de producción de una fila: cualquier usuario cuyas estaciones de trabajo activas tengan estado
// (`estado_id` en el body para elegir cuál si tiene varios; no depende de la planificación que se esté mirando). Observaciones
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

// Importador desde Excel (Planificación DD-MM-AA.xlsx): dos llamadas sin estado, ver importar/. Solo quien gestiona.
// `previsualizar` recibe el .xlsx (multipart/form-data, campo `archivo`, un solo archivo, hasta 5 MB) y no escribe nada;
// `confirmar` recibe JSON con las filas ya interpretadas (y corregidas) y las carga en una transacción.
const subirExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARCHIVO_BYTES, files: 1, fields: 5, parts: 8 },
}).single("archivo");

function recibirExcel(req: Request, res: Response, next: NextFunction) {
  if (!req.is("multipart/form-data")) return next(new AppError("Enviá el archivo como multipart/form-data, en el campo «archivo».", 400));
  subirExcel(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new AppError("El archivo supera el máximo de 5 MB.", 413));
      if (err.code === "LIMIT_UNEXPECTED_FILE") return next(new AppError("Enviá un solo archivo, en el campo «archivo».", 400));
      return next(new AppError("No se pudo leer el archivo enviado.", 400));
    }
    return next(new AppError("No se pudo leer el archivo enviado.", 400));
  });
}

planificacionRouter.post(
  "/importar/previsualizar",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  recibirExcel,
  catchAsync(async (req, res) => {
    if (!req.file) throw new AppError("Falta el archivo (campo «archivo»).", 400);
    return sendResponse(res, 200, await previsualizar(req.file.originalname, req.file.buffer));
  }),
);

planificacionRouter.post(
  "/importar/confirmar",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => sendResponse(res, 200, await confirmar(parsearConfirmar(req.body)))),
);

planificacionRouter.get(
  "/planificaciones",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await planificacionesVisibles(lectorDe(req)))),
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
  "/pedido",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  catchAsync(async (req, res) => sendResponse(res, 200, await buscarPedidoPorNTw(parsearPedidoPorTw(req.query).n_tw))),
);

planificacionRouter.get(
  "/buscar",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    const { plantilla, q } = parsearBuscarEnPlanificacion(req.query);
    return sendResponse(res, 200, await buscarEnPlanificacion(plantilla, q, lectorDe(req)));
  }),
);

planificacionRouter.get(
  "/",
  requierePermiso(PERMISOS.DOCUMENTACION_VER),
  catchAsync(async (req, res) => {
    return sendResponse(res, 200, await getSemana(quiereTexto(req.query.plantilla), quiereTexto(req.query.semana), lectorDe(req)));
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
