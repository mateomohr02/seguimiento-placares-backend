import { Router } from "express";
import { requierePermiso } from "../../modules/auth/auth.middleware";
import { PERMISOS } from "../../modules/auth/permisos";
import { getModuloController } from "./controllers/get-modulo.controller";
import { listPiezasDeModuloController } from "../piezas/controllers/list-piezas-de-modulo.controller";

// Solo lectura: el estado del módulo se deriva de sus piezas (estados.service.ts).
export const modulosRouter = Router();

modulosRouter.get("/:id", requierePermiso(PERMISOS.PRODUCCION_VER), getModuloController);
modulosRouter.get("/:id/piezas", requierePermiso(PERMISOS.PRODUCCION_VER), listPiezasDeModuloController);
