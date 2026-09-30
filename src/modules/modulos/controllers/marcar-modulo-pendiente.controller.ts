import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { marcarModuloPendiente } from "../services/marcar-modulo-pendiente.service";
import { toModuloResponseDTO } from "../mappers/to-modulo-response.dto";

export const marcarModuloPendienteController = catchAsync(async (req, res) => {
  const modulo = await marcarModuloPendiente(parseIdParam(req.params.id));
  return sendResponse(res, 200, toModuloResponseDTO(modulo));
});
