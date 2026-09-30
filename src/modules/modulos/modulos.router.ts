import { Router } from "express";
import { getModuloController } from "./controllers/get-modulo.controller";
import { marcarModuloFinalizadoController } from "./controllers/marcar-modulo-finalizado.controller";
import { listPiezasDeModuloController } from "../piezas/controllers/list-piezas-de-modulo.controller";

import { marcarModuloPendienteController } from "./controllers/marcar-modulo-pendiente.controller";
export const modulosRouter = Router();

modulosRouter.get("/:id", getModuloController);
modulosRouter.get("/:id/piezas", listPiezasDeModuloController);
modulosRouter.patch("/:id/finalizar", marcarModuloFinalizadoController);
modulosRouter.patch("/:id/pendiente", marcarModuloPendienteController);
