import express, { Router } from "express";
import { requierePermiso } from "../../modules/auth/auth.middleware";
import { PERMISOS } from "../../modules/auth/permisos";
import {
  archivoHojaController,
  crearHojaController,
  eliminarHojaController,
  listHojasController,
} from "./controllers/hojas-corte.controller";
import {
  crearAnotacionController,
  eliminarAnotacionController,
  listAnotacionesController,
} from "./controllers/anotaciones.controller";
import { MAX_PDF_BYTES } from "./services/hojas-corte.service";

// Hojas de corte (PDF) por orden — módulo aditivo, no modifica las rutas existentes.
// Montado en app.ts en /api/ordenes/:ordenId/hojas-corte (listar/subir) y
// /api/hojas-corte/:id (archivo/eliminar).
export const hojasDeOrdenRouter = Router({ mergeParams: true });
hojasDeOrdenRouter.get("/", requierePermiso(PERMISOS.DOCUMENTACION_VER), listHojasController);
hojasDeOrdenRouter.post("/", requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR), express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }), crearHojaController);

export const hojasCorteRouter = Router();
hojasCorteRouter.get("/:id/archivo", requierePermiso(PERMISOS.DOCUMENTACION_VER), archivoHojaController);
hojasCorteRouter.delete("/:id", requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR), eliminarHojaController);
hojasCorteRouter.get("/:id/anotaciones", requierePermiso(PERMISOS.DOCUMENTACION_VER), listAnotacionesController);
hojasCorteRouter.post("/:id/anotaciones", requierePermiso(PERMISOS.DOCUMENTACION_ANOTAR), crearAnotacionController);
hojasCorteRouter.delete("/:id/anotaciones/:anotacionId", requierePermiso(PERMISOS.ANOTACIONES_ELIMINAR), eliminarAnotacionController);
