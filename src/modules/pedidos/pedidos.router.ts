import { Router } from "express";
import { requierePermiso } from "../../modules/auth/auth.middleware";
import { PERMISOS } from "../../modules/auth/permisos";
import { getPedidoController } from "./controllers/get-pedido.controller";
import { listModulosDePedidoController } from "../modulos/controllers/list-modulos-de-pedido.controller";

// Solo lectura: el estado del pedido se deriva de sus módulos (estados.service.ts).
export const pedidosRouter = Router();

pedidosRouter.get("/:id", requierePermiso(PERMISOS.PRODUCCION_VER), getPedidoController);
pedidosRouter.get("/:id/modulos", requierePermiso(PERMISOS.PRODUCCION_VER), listModulosDePedidoController);
