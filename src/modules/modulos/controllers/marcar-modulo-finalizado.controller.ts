import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { marcarModuloFinalizado } from "../services/marcar-modulo-finalizado.service";
import { toModuloResponseDTO } from "../mappers/to-modulo-response.dto";

export const marcarModuloFinalizadoController = catchAsync(async (req, res) => {
  const modulo = await marcarModuloFinalizado(parseIdParam(req.params.id));
  return sendResponse(res, 200, toModuloResponseDTO(modulo));
});
