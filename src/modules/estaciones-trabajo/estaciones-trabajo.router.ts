import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/ApiResponse";
import { parseIdParam } from "../../utils/parseIdParam";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import { parsearEstacionCrear, parsearEstacionEditar } from "./schemas/estacion-trabajo.schema";
import { actualizarEstacion, crearEstacion, listarEstaciones } from "./services/estaciones-trabajo.service";

// Estaciones de trabajo — diseño.md §17. Montado en /api/estaciones-trabajo. Todo con planillas.configurar (técnica y admin).
export const estacionesTrabajoRouter = Router();

estacionesTrabajoRouter.get(
  "/",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (req, res) => sendResponse(res, 200, await listarEstaciones(req.usuario!))),
);

estacionesTrabajoRouter.post(
  "/",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (req, res) => sendResponse(res, 201, await crearEstacion(parsearEstacionCrear(req.body), req.usuario!))),
);

estacionesTrabajoRouter.patch(
  "/:id",
  requierePermiso(PERMISOS.PLANILLAS_CONFIGURAR),
  catchAsync(async (req, res) =>
    sendResponse(res, 200, await actualizarEstacion(parseIdParam(String(req.params.id)), parsearEstacionEditar(req.body), req.usuario!)),
  ),
);
