import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { marcarPiezaCortada } from "../services/marcar-pieza-cortada.service";

// Vista 4 — botón "Marcar finalizado" por pieza: confirma manualmente piezas
// que nunca pasan por Rover (mismo camino que el escaneo, ver §6).
export const confirmarPiezaController = catchAsync(async (req, res) => {
  const resumen = await marcarPiezaCortada({ id: parseIdParam(req.params.id) });
  return sendResponse(res, 200, resumen);
});
