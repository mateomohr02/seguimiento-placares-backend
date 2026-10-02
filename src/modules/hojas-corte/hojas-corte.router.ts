import express, { Router } from "express";
import {
  archivoHojaController,
  crearHojaController,
  eliminarHojaController,
  listHojasController,
} from "./controllers/hojas-corte.controller";
import { MAX_PDF_BYTES } from "./services/hojas-corte.service";

// Hojas de corte (PDF) por orden — módulo aditivo, no modifica las rutas existentes.
// Montado en app.ts en /api/ordenes/:ordenId/hojas-corte (listar/subir) y
// /api/hojas-corte/:id (archivo/eliminar).
export const hojasDeOrdenRouter = Router({ mergeParams: true });
hojasDeOrdenRouter.get("/", listHojasController);
hojasDeOrdenRouter.post("/", express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }), crearHojaController);

export const hojasCorteRouter = Router();
hojasCorteRouter.get("/:id/archivo", archivoHojaController);
hojasCorteRouter.delete("/:id", eliminarHojaController);
