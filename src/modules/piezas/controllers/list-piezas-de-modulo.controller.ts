import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { getModulo } from "../../modulos/services/get-modulo.service";
import { listPiezasDeModulo } from "../services/list-piezas-de-modulo.service";
import { toPiezaResponseDTO } from "../mappers/to-pieza-response.dto";

export const listPiezasDeModuloController = catchAsync(async (req, res) => {
  const moduloId = parseIdParam(req.params.id);
  await getModulo(moduloId);
  const piezas = await listPiezasDeModulo(moduloId);
  return sendResponse(res, 200, piezas.map(toPiezaResponseDTO));
});
