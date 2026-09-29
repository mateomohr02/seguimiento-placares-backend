import { Router } from "express";
import { getPedidoController } from "./controllers/get-pedido.controller";
import { marcarPedidoFinalizadoController } from "./controllers/marcar-pedido-finalizado.controller";
import { listModulosDePedidoController } from "../modulos/controllers/list-modulos-de-pedido.controller";

export const pedidosRouter = Router();

pedidosRouter.get("/:id", getPedidoController);
pedidosRouter.get("/:id/modulos", listModulosDePedidoController);
pedidosRouter.patch("/:id/finalizar", marcarPedidoFinalizadoController);
