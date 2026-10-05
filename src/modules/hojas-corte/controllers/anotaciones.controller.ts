import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { CreateAnotacionSchema } from "../schemas/anotacion.schema";
import { crearAnotacion, eliminarAnotacion, listAnotaciones } from "../services/anotaciones.service";

export const listAnotacionesController = catchAsync(async (req, res) => {
  return sendResponse(res, 200, await listAnotaciones(parseIdParam(req.params.id)));
});

export const crearAnotacionController = catchAsync(async (req, res) => {
  const input = CreateAnotacionSchema.parse(req.body);
  return sendResponse(res, 201, await crearAnotacion(parseIdParam(req.params.id), input));
});

export const eliminarAnotacionController = catchAsync(async (req, res) => {
  await eliminarAnotacion(parseIdParam(req.params.id), parseIdParam(req.params.anotacionId));
  return sendResponse(res, 200, null);
});
