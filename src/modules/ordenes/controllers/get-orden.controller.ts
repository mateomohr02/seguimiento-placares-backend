import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { getOrden } from "../services/get-orden.service";
import { toOrdenResponseDTO } from "../mappers/to-orden-response.dto";

export const getOrdenController = catchAsync(async (req, res) => {
  const orden = await getOrden(parseIdParam(req.params.id));
  return sendResponse(res, 200, toOrdenResponseDTO(orden));
});
