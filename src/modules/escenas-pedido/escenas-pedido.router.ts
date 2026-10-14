import express, { Router } from "express";
import { requierePermiso } from "../auth/auth.middleware";
import { PERMISOS } from "../auth/permisos";
import {
  crearEscenaController,
  eliminarEscenaController,
  getEscenaController,
  listEscenasController,
} from "./controllers/escenas-pedido.controller";
import { MAX_ESCENA_BYTES } from "./services/escenas-pedido.service";

// Escenas 3D de pedidos — módulo aditivo, solo lectura (sin anotaciones). Mismos
// permisos que la documentación. Montado en app.ts en /api/pedidos/:pedidoId/escenas
// (listar/subir) y /api/escenas-pedido/:id.
export const escenasDePedidoRouter = Router({ mergeParams: true });
escenasDePedidoRouter.get("/", requierePermiso(PERMISOS.DOCUMENTACION_VER), listEscenasController);
escenasDePedidoRouter.post(
  "/",
  requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR),
  express.raw({ type: "application/x-teowin-3d", limit: MAX_ESCENA_BYTES }),
  crearEscenaController,
);

export const escenasPedidoRouter = Router();
escenasPedidoRouter.get("/:id/escena", requierePermiso(PERMISOS.DOCUMENTACION_VER), getEscenaController);
escenasPedidoRouter.delete("/:id", requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR), eliminarEscenaController);
