import express, { Router } from "express";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import {
  archivoPlanoController,
  crearAnotacionPlanoController,
  crearPlanoController,
  eliminarAnotacionPlanoController,
  eliminarPlanoController,
  listAnotacionesPlanoController,
  listPlanosController,
} from "./controllers/planos-pedido.controller";
import { MAX_PLANO_BYTES, MIMES_PLANO } from "./services/planos-pedido.service";

// Planos de pedidos — módulo aditivo. Montado en app.ts en
// /api/pedidos/:pedidoId/planos (listar/subir) y /api/planos-pedido/:id.
export const planosDePedidoRouter = Router({ mergeParams: true });
planosDePedidoRouter.get("/", requierePermiso(PERMISOS.DOCUMENTACION_VER), listPlanosController);
planosDePedidoRouter.post(
  "/",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  express.raw({ type: [...MIMES_PLANO], limit: MAX_PLANO_BYTES }),
  crearPlanoController,
);

export const planosPedidoRouter = Router();
planosPedidoRouter.get("/:id/archivo", requierePermiso(PERMISOS.DOCUMENTACION_VER), archivoPlanoController);
planosPedidoRouter.delete("/:id", requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR), eliminarPlanoController);
planosPedidoRouter.get("/:id/anotaciones", requierePermiso(PERMISOS.DOCUMENTACION_VER), listAnotacionesPlanoController);
planosPedidoRouter.post("/:id/anotaciones", requierePermiso(PERMISOS.DOCUMENTACION_ANOTAR), crearAnotacionPlanoController);
planosPedidoRouter.delete("/:id/anotaciones/:anotacionId", requierePermiso(PERMISOS.ANOTACIONES_ELIMINAR), eliminarAnotacionPlanoController);
