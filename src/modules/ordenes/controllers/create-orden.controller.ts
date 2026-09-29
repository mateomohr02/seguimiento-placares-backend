import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { syncOrdenFromTeowin } from "../services/sync-orden.service";
import { toOrdenResponseDTO } from "../mappers/to-orden-response.dto";
import type { CreateOrdenSchemaType } from "../schemas/create-orden.schema";

export const createOrdenController = catchAsync(async (req, res) => {
  const { codigoOrdenFabricacion } = req.body as CreateOrdenSchemaType;
  const orden = await syncOrdenFromTeowin(codigoOrdenFabricacion);
  return sendResponse(res, 201, toOrdenResponseDTO(orden));
});
