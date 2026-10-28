import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { AppError } from "../../../utils/AppError";
import { listOrdenes } from "../services/list-ordenes.service";
import { toOrdenResponseDTO } from "../mappers/to-orden-response.dto";
import { esLineaProducto } from "../../sync/linea-producto";

export const listOrdenesController = catchAsync(async (req, res) => {
  // ?linea=PLACARES|COCINAS filtra por línea de producto; sin el parámetro, todas.
  const lineaParam = typeof req.query.linea === "string" ? req.query.linea.toUpperCase() : undefined;
  if (lineaParam !== undefined && lineaParam !== "" && !esLineaProducto(lineaParam)) {
    throw new AppError("El filtro linea debe ser PLACARES o COCINAS.", 400);
  }
  const ordenes = await listOrdenes({
    archivadas: req.query.archivadas === "true",
    linea: lineaParam && esLineaProducto(lineaParam) ? lineaParam : undefined,
  });
  return sendResponse(res, 200, ordenes.map(toOrdenResponseDTO));
});
