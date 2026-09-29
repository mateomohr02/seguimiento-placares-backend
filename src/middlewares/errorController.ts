import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError";

export function errorController(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ status: err.status, message: err.message, data: null });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      status: "fail",
      message: "Datos inválidos.",
      data: { errors: err.flatten().fieldErrors },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      status: "fail",
      message: "Ya existe un registro activo con esa clave de negocio.",
      data: null,
    });
    return;
  }

  console.error(err);
  res.status(500).json({ status: "error", message: "Error interno del servidor.", data: null });
}
