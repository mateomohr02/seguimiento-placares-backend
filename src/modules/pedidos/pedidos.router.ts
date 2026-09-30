import { Router } from "express";
import { getPedidoController } from "./controllers/get-pedido.controller";
import { listModulosDePedidoController } from "../modulos/controllers/list-modulos-de-pedido.controller";

// Solo lectura: el estado del pedido se deriva de sus módulos (estados.service.ts).
export const pedidosRouter = Router();

pedidosRouter.get("/:id", getPedidoController);
pedidosRouter.get("/:id/modulos", listModulosDePedidoController);
