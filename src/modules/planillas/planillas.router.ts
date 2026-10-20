import express, { Router } from "express";
import { z } from "zod";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { AppError } from "../../utils/AppError";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import { ESTACIONES, parsearPlanillaBody, parseEstacion, type Estacion } from "./schemas/planilla.schema";
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
  getFoto,
  MAX_FOTO_BYTES,
  MIMES_FOTO,
} from "./services/fotos-operarios.service";
import {
  guardarConfiguracionUsuario,
  guardarEstados,
  listarConfiguracionUsuarios,
  listarEstados,
  MAX_OPERARIOS,
  operariosDe,
} from "./services/configuracion-usuarios.service";

// Planillas de producción de Termolaminado (diseño.md §14). Montado en /api/planillas.
// Ver (tabla, indicadores, trazabilidad): planillas.ver. Completar y corregir: planillas.completar.
export const planillasRouter = Router();

// Completar una planilla exige el permiso (en la ruta) y tener asignada esa estación.
function exigirAcceso(asignadas: string[], estacion: string) {
  if (!asignadas.includes(estacion)) throw new AppError("No tenés acceso a esta planilla.", 403);
}

// Estaciones cuyos registros puede ver el usuario: los de fábrica, solo las planillas que tienen asignadas;
// el resto de los roles (técnica, gerencia, admin), todas.
function estacionesVisibles(u: { rol: string; planillas: string[] }): Estacion[] {
  return u.rol === "fabrica" ? ESTACIONES.filter((e) => u.planillas.includes(e)) : [...ESTACIONES];
}

function exigirVisible(u: { rol: string; planillas: string[] }, estacion: string) {
  if (!(estacionesVisibles(u) as string[]).includes(estacion)) throw new AppError("No tenés acceso a los registros de esta planilla.", 403);
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

planillasRouter.get(
  "/dia/:estacion/:fecha",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    const estacion = parseEstacion(String(req.params.estacion));
    exigirVisible(req.usuario!, estacion);
    return sendResponse(res, 200, await getPlanillaDelDia(estacion, String(req.params.fecha)));
  }),
);

planillasRouter.put(
  "/dia/:estacion/:fecha",
  requierePermiso(PERMISOS.PLANILLAS_COMPLETAR),
  catchAsync(async (req, res) => {
    const estacion = parseEstacion(String(req.params.estacion));
    exigirAcceso(req.usuario!.planillas, estacion);
    const body = parsearPlanillaBody(req.body);
    const planilla = await guardarPlanilla(estacion, String(req.params.fecha), body, req.usuario!.nombre, req.usuario!.id);
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
    const estacion = q.estacion ? parseEstacion(q.estacion) : undefined;
    if (estacion) exigirVisible(req.usuario!, estacion);
    return sendResponse(res, 200, await listarRegistros({ ...q, estacion, estaciones: estacionesVisibles(req.usuario!) }));
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
    const visibles = estacionesVisibles(req.usuario!);
    if (visibles.length === 0) throw new AppError("No tenés acceso a los registros de ninguna planilla.", 403);
    return sendResponse(res, 200, await trazabilidadDePedido(str(req.query.pedido) ?? "", visibles));
  }),
);

planillasRouter.get(
  "/pedidos-sugeridos",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await sugerirPedidos(str(req.query.q) ?? "", estacionesVisibles(req.usuario!)))),
);

planillasRouter.get(
  "/colores",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, await coloresUsados(estacionesVisibles(req.usuario!)))),
);

// Los operarios entre los que elige el usuario que completa la planilla (los configura técnica por usuario).
planillasRouter.get(
  "/operarios",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => sendResponse(res, 200, { operarios: await operariosDe(req.usuario!.id) })),
);

// Configuración por usuario de fábrica (técnica): planillas que completa, estado de producción y operarios.
planillasRouter.get(
  "/accesos",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (_req, res) => sendResponse(res, 200, await listarConfiguracionUsuarios())),
);

planillasRouter.put(
  "/accesos/:usuarioId",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (req, res) => {
    const input = z
      .object({
        estaciones: z.array(z.string()).max(3),
        estado_id: z.string().uuid().nullable(),
        operarios: z.array(z.string().max(60)).max(MAX_OPERARIOS),
      })
      .parse(req.body);
    await guardarConfiguracionUsuario(parseIdParam(String(req.params.usuarioId)), input);
    return sendResponse(res, 200, await listarConfiguracionUsuarios());
  }),
);

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
    const version = await getVersion(parseIdParam(String(req.params.id)));
    exigirVisible(req.usuario!, version.estacion);
    return sendResponse(res, 200, version);
  }),
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
    const fotoId = parseIdParam(String(req.params.fotoId));
    exigirVisible(req.usuario!, await estacionDeFoto(fotoId));
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
    exigirAcceso(req.usuario!.planillas, await estacionDeFoto(fotoId));
    await eliminarFoto(fotoId);
    return sendResponse(res, 200, null);
  }),
);

// Al final: `/:id` no tiene que tapar a las rutas fijas de arriba.
planillasRouter.get(
  "/:id",
  requierePermiso(PERMISOS.PLANILLAS_VER),
  catchAsync(async (req, res) => {
    const planilla = await getPlanilla(parseIdParam(String(req.params.id)));
    exigirVisible(req.usuario!, planilla.estacion);
    return sendResponse(res, 200, planilla);
  }),
);
