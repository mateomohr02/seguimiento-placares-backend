import express, { Router } from "express";
import { MAX_PDF_BYTES } from "../hojas-corte/services/hojas-corte.service";
import {
  archivoDocumentoController,
  crearAnotacionDocumentoController,
  crearDocumentoController,
  eliminarAnotacionDocumentoController,
  eliminarDocumentoController,
  listAnotacionesDocumentoController,
  listDocumentosController,
} from "./controllers/documentos-pedido.controller";

// Documentación de pedidos (PDF) — módulo aditivo. Montado en app.ts en
// /api/pedidos/:pedidoId/documentos (listar/subir) y /api/documentos-pedido/:id.
export const documentosDePedidoRouter = Router({ mergeParams: true });
documentosDePedidoRouter.get("/", listDocumentosController);
documentosDePedidoRouter.post("/", express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }), crearDocumentoController);

export const documentosPedidoRouter = Router();
documentosPedidoRouter.get("/:id/archivo", archivoDocumentoController);
documentosPedidoRouter.delete("/:id", eliminarDocumentoController);
documentosPedidoRouter.get("/:id/anotaciones", listAnotacionesDocumentoController);
documentosPedidoRouter.post("/:id/anotaciones", crearAnotacionDocumentoController);
documentosPedidoRouter.delete("/:id/anotaciones/:anotacionId", eliminarAnotacionDocumentoController);
