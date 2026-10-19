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
      .object({ estados: z.array(z.object({ id: z.string().uuid().optional(), nombre: z.string().max(60) })).max(30) })
      .parse(req.body);
    return sendResponse(res, 200, await guardarEstados(estados));
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
