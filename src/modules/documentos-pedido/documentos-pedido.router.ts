import express, { Router } from "express";
import { requierePermiso } from "../../modules/auth/auth.middleware";
import { PERMISOS } from "../../modules/auth/permisos";
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
documentosDePedidoRouter.get("/", requierePermiso(PERMISOS.DOCUMENTACION_VER), listDocumentosController);
documentosDePedidoRouter.post("/", requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR), express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }), crearDocumentoController);

export const documentosPedidoRouter = Router();
documentosPedidoRouter.get("/:id/archivo", requierePermiso(PERMISOS.DOCUMENTACION_VER), archivoDocumentoController);
documentosPedidoRouter.delete("/:id", requierePermiso(PERMISOS.DOCUMENTACION_GESTIONAR), eliminarDocumentoController);
documentosPedidoRouter.get("/:id/anotaciones", requierePermiso(PERMISOS.DOCUMENTACION_VER), listAnotacionesDocumentoController);
documentosPedidoRouter.post("/:id/anotaciones", requierePermiso(PERMISOS.DOCUMENTACION_ANOTAR), crearAnotacionDocumentoController);
documentosPedidoRouter.delete("/:id/anotaciones/:anotacionId", requierePermiso(PERMISOS.ANOTACIONES_ELIMINAR), eliminarAnotacionDocumentoController);
