import express, { Router } from "express";
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
planosDePedidoRouter.get("/", listPlanosController);
planosDePedidoRouter.post(
  "/",
  express.raw({ type: [...MIMES_PLANO], limit: MAX_PLANO_BYTES }),
  crearPlanoController,
);

export const planosPedidoRouter = Router();
planosPedidoRouter.get("/:id/archivo", archivoPlanoController);
planosPedidoRouter.delete("/:id", eliminarPlanoController);
planosPedidoRouter.get("/:id/anotaciones", listAnotacionesPlanoController);
planosPedidoRouter.post("/:id/anotaciones", crearAnotacionPlanoController);
planosPedidoRouter.delete("/:id/anotaciones/:anotacionId", eliminarAnotacionPlanoController);
