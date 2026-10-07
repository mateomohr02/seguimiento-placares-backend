import { z } from "zod";
import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { AppError } from "../../../utils/AppError";
import { parseIdParam } from "../../../utils/parseIdParam";
import { crearHoja, eliminarHoja, getArchivoHoja, listHojasDeOrden } from "../services/hojas-corte.service";

// El PDF viaja como body binario crudo (application/pdf); nombre y archivo por query.
const UploadQuerySchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre de la hoja.").max(80),
  archivo: z.string().trim().min(1).max(255),
});

export const listHojasController = catchAsync(async (req, res) => {
  const hojas = await listHojasDeOrden(parseIdParam(req.params.ordenId));
  return sendResponse(res, 200, hojas);
});

export const crearHojaController = catchAsync(async (req, res) => {
  const ordenId = parseIdParam(req.params.ordenId);
  const { nombre, archivo } = UploadQuerySchema.parse(req.query);
  if (!Buffer.isBuffer(req.body)) throw new AppError("Se esperaba un PDF (Content-Type: application/pdf).", 415);
  const hoja = await crearHoja(ordenId, { nombre, nombreArchivo: archivo, contenido: req.body });
  return sendResponse(res, 201, hoja);
});

export const archivoHojaController = catchAsync(async (req, res) => {
  const { contenido, nombreArchivo } = await getArchivoHoja(parseIdParam(req.params.id));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", contenido.length);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.end(contenido);
});

export const eliminarHojaController = catchAsync(async (req, res) => {
  await eliminarHoja(parseIdParam(req.params.id));
  return sendResponse(res, 200, null);
});
