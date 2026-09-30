import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { marcarPiezaPendiente } from "../services/marcar-pieza-pendiente.service";

export const marcarPiezaPendienteController = catchAsync(async (req, res) => {
  const pieza = await marcarPiezaPendiente(parseIdParam(req.params.id));
  return sendResponse(res, 200, pieza);
});
