import type { ZodType } from "zod";
import { catchAsync } from "../utils/catchAsync";

export const validateBody = (schema: ZodType) =>
  catchAsync(async (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  });
