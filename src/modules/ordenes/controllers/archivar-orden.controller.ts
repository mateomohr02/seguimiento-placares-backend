import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { setOrdenArchivada } from "../services/archivar-orden.service";
import { toOrdenResponseDTO } from "../mappers/to-orden-response.dto";

export const archivarOrdenController = catchAsync(async (req, res) => {
  const orden = await setOrdenArchivada(parseIdParam(req.params.id), true);
  return sendResponse(res, 200, toOrdenResponseDTO(orden));
});

export const desarchivarOrdenController = catchAsync(async (req, res) => {
  const orden = await setOrdenArchivada(parseIdParam(req.params.id), false);
  return sendResponse(res, 200, toOrdenResponseDTO(orden));
});
