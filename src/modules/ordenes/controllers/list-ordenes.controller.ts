import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { listOrdenes } from "../services/list-ordenes.service";
import { toOrdenResponseDTO } from "../mappers/to-orden-response.dto";

export const listOrdenesController = catchAsync(async (req, res) => {
  const ordenes = await listOrdenes({ archivadas: req.query.archivadas === "true" });
  return sendResponse(res, 200, ordenes.map(toOrdenResponseDTO));
});
