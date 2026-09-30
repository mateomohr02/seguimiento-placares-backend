import { Router } from "express";
import { getPedidoController } from "./controllers/get-pedido.controller";
import { marcarPedidoFinalizadoController } from "./controllers/marcar-pedido-finalizado.controller";
import { listModulosDePedidoController } from "../modulos/controllers/list-modulos-de-pedido.controller";

import { marcarPedidoPendienteController } from "./controllers/marcar-pedido-pendiente.controller";
export const pedidosRouter = Router();

pedidosRouter.get("/:id", getPedidoController);
pedidosRouter.get("/:id/modulos", listModulosDePedidoController);
pedidosRouter.patch("/:id/finalizar", marcarPedidoFinalizadoController);
pedidosRouter.patch("/:id/pendiente", marcarPedidoPendienteController);
