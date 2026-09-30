import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { marcarOrdenPendiente } from "../services/marcar-orden-pendiente.service";
import { eliminarOrden } from "../services/eliminar-orden.service";
import { toOrdenResponseDTO } from "../mappers/to-orden-response.dto";

export const marcarOrdenPendienteController = catchAsync(async (req, res) => {
  const orden = await marcarOrdenPendiente(parseIdParam(req.params.id));
  return sendResponse(res, 200, toOrdenResponseDTO(orden));
});

export const eliminarOrdenController = catchAsync(async (req, res) => {
  const orden = await eliminarOrden(parseIdParam(req.params.id));
  return sendResponse(res, 200, toOrdenResponseDTO(orden));
});
