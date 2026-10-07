import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { AppError } from "../../../utils/AppError";
import { parseIdParam } from "../../../utils/parseIdParam";
import { CreateAnotacionSchema } from "../../hojas-corte/schemas/anotacion.schema";
import { UploadDocumentoQuerySchema } from "../schemas/documento-pedido.schema";
import {
  crearDocumento,
  eliminarDocumento,
  getArchivoDocumento,
  listDocumentosDePedido,
} from "../services/documentos-pedido.service";
import {
  crearAnotacionDocumento,
  eliminarAnotacionDocumento,
  listAnotacionesDocumento,
} from "../services/anotaciones-documento.service";

export const listDocumentosController = catchAsync(async (req, res) => {
  return sendResponse(res, 200, await listDocumentosDePedido(parseIdParam(req.params.pedidoId)));
});

export const crearDocumentoController = catchAsync(async (req, res) => {
  const pedidoId = parseIdParam(req.params.pedidoId);
  const { tipo, nombre, archivo } = UploadDocumentoQuerySchema.parse(req.query);
  if (!Buffer.isBuffer(req.body)) throw new AppError("Se esperaba un PDF (Content-Type: application/pdf).", 415);
  const doc = await crearDocumento(pedidoId, { tipo, nombre, nombreArchivo: archivo, contenido: req.body });
  return sendResponse(res, 201, doc);
});

export const archivoDocumentoController = catchAsync(async (req, res) => {
  const { contenido, nombreArchivo } = await getArchivoDocumento(parseIdParam(req.params.id));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", contenido.length);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.end(contenido);
});

export const eliminarDocumentoController = catchAsync(async (req, res) => {
  await eliminarDocumento(parseIdParam(req.params.id));
  return sendResponse(res, 200, null);
});

export const listAnotacionesDocumentoController = catchAsync(async (req, res) => {
  return sendResponse(res, 200, await listAnotacionesDocumento(parseIdParam(req.params.id)));
});

export const crearAnotacionDocumentoController = catchAsync(async (req, res) => {
  const input = CreateAnotacionSchema.parse(req.body);
  return sendResponse(res, 201, await crearAnotacionDocumento(parseIdParam(req.params.id), input));
});

export const eliminarAnotacionDocumentoController = catchAsync(async (req, res) => {
  await eliminarAnotacionDocumento(parseIdParam(req.params.id), parseIdParam(req.params.anotacionId));
  return sendResponse(res, 200, null);
});
