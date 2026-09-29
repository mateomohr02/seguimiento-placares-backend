import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { marcarPiezaCortada } from "../services/marcar-pieza-cortada.service";
import type { EscanearPiezaSchemaType } from "../schemas/escanear-pieza.schema";

export const escanearPiezaController = catchAsync(async (req, res) => {
  const { idUnico } = req.body as EscanearPiezaSchemaType;
  const resumen = await marcarPiezaCortada({ idUnico });
  return sendResponse(res, 200, resumen);
});
