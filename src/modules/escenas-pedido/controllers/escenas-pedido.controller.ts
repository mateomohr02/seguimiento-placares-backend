import { z } from "zod";
import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { AppError } from "../../../utils/AppError";
import { parseIdParam } from "../../../utils/parseIdParam";
import { crearEscena, eliminarEscena, getEscena, listEscenasDePedido } from "../services/escenas-pedido.service";

// El .3d viaja como body binario crudo; el resto por query.
const UploadQuerySchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre de la escena.").max(80),
  archivo: z.string().trim().min(1).max(255),
});

export const listEscenasController = catchAsync(async (req, res) => {
  return sendResponse(res, 200, await listEscenasDePedido(parseIdParam(req.params.pedidoId)));
});

export const crearEscenaController = catchAsync(async (req, res) => {
  const pedidoId = parseIdParam(req.params.pedidoId);
  const { nombre, archivo } = UploadQuerySchema.parse(req.query);
  if (!Buffer.isBuffer(req.body)) throw new AppError("Subí el archivo .3d de la escena.", 415);
  return sendResponse(res, 201, await crearEscena(pedidoId, { nombre, nombreArchivo: archivo, contenido: req.body }));
});

export const getEscenaController = catchAsync(async (req, res) => {
  return sendResponse(res, 200, await getEscena(parseIdParam(req.params.id)));
});

export const eliminarEscenaController = catchAsync(async (req, res) => {
  await eliminarEscena(parseIdParam(req.params.id));
  return sendResponse(res, 200, null);
});
