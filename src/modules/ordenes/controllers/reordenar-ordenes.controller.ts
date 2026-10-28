import { catchAsync } from "../../../utils/catchAsync";
import { parsearReordenarOrdenes } from "../schemas/reordenar-ordenes.schema";
import { reordenarOrdenes } from "../services/reordenar-ordenes.service";

export const reordenarOrdenesController = catchAsync(async (req, res) => {
  await reordenarOrdenes(parsearReordenarOrdenes(req.body).ids);
  return res.status(204).end();
});
