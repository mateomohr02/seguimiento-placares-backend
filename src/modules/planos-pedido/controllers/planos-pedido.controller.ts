import { z } from "zod";
import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { AppError } from "../../../utils/AppError";
import { parseIdParam } from "../../../utils/parseIdParam";
import { CreateAnotacionSchema } from "../../hojas-corte/schemas/anotacion.schema";
import { crearPlano, eliminarPlano, getArchivoPlano, listPlanosDePedido } from "../services/planos-pedido.service";
import {
  crearAnotacionPlano,
  eliminarAnotacionPlano,
  listAnotacionesPlano,
} from "../services/anotaciones-plano.service";

// El archivo viaja como body binario crudo (Content-Type = su formato); el resto por query.
const UploadQuerySchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre del plano.").max(80),
  archivo: z.string().trim().min(1).max(255),
  moduloId: z.string().uuid().optional(),
});

export const listPlanosController = catchAsync(async (req, res) => {
  return sendResponse(res, 200, await listPlanosDePedido(parseIdParam(req.params.pedidoId)));
});

export const crearPlanoController = catchAsync(async (req, res) => {
  const pedidoId = parseIdParam(req.params.pedidoId);
  const { nombre, archivo, moduloId } = UploadQuerySchema.parse(req.query);
  if (!Buffer.isBuffer(req.body)) throw new AppError("Formato no soportado. Usá JPG, PNG, WEBP o PDF.", 415);
  const mime = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const plano = await crearPlano(pedidoId, { nombre, nombreArchivo: archivo, moduloId, mime, contenido: req.body });
  return sendResponse(res, 201, plano);
});

export const archivoPlanoController = catchAsync(async (req, res) => {
  const { contenido, nombreArchivo, mime } = await getArchivoPlano(parseIdParam(req.params.id));
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", contenido.length);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.end(contenido);
});

export const eliminarPlanoController = catchAsync(async (req, res) => {
  await eliminarPlano(parseIdParam(req.params.id));
  return sendResponse(res, 200, null);
});

export const listAnotacionesPlanoController = catchAsync(async (req, res) => {
  return sendResponse(res, 200, await listAnotacionesPlano(parseIdParam(req.params.id)));
});

export const crearAnotacionPlanoController = catchAsync(async (req, res) => {
  const input = CreateAnotacionSchema.parse(req.body);
  return sendResponse(res, 201, await crearAnotacionPlano(parseIdParam(req.params.id), input));
});

export const eliminarAnotacionPlanoController = catchAsync(async (req, res) => {
  await eliminarAnotacionPlano(parseIdParam(req.params.id), parseIdParam(req.params.anotacionId));
  return sendResponse(res, 200, null);
});
