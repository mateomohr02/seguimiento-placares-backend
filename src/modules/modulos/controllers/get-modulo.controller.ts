import { catchAsync } from "../../../utils/catchAsync";
import { sendResponse } from "../../../utils/ApiResponse";
import { parseIdParam } from "../../../utils/parseIdParam";
import { getModulo } from "../services/get-modulo.service";
import { toModuloResponseDTO } from "../mappers/to-modulo-response.dto";

export const getModuloController = catchAsync(async (req, res) => {
  const modulo = await getModulo(parseIdParam(req.params.id));
  return sendResponse(res, 200, {
    ...toModuloResponseDTO(modulo),
    pedido: {
      id: modulo.pedido.id,
      codigo_pedido: modulo.pedido.codigo_pedido,
      nombreComercial: modulo.pedido.nombreComercial,
    },
    orden: {
      id: modulo.pedido.orden.id,
      numeroOrdenCustom: modulo.pedido.orden.numeroOrdenCustom,
    },
  });
});
