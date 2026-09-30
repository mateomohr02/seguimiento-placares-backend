import { Router } from "express";
import { getModuloController } from "./controllers/get-modulo.controller";
import { listPiezasDeModuloController } from "../piezas/controllers/list-piezas-de-modulo.controller";

// Solo lectura: el estado del módulo se deriva de sus piezas (estados.service.ts).
export const modulosRouter = Router();

modulosRouter.get("/:id", getModuloController);
modulosRouter.get("/:id/piezas", listPiezasDeModuloController);
