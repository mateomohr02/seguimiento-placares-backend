import type { Response } from "express";

export interface ApiResponse<T> {
  status: "success";
  message?: string;
  data: T | null;
}

export function sendResponse<T>(
  res: Response,
  statusCode: number,
  data: T | null,
  message?: string,
): Response {
  const body: ApiResponse<T> = { status: "success", data };
  if (message) body.message = message;
  return res.status(statusCode).json(body);
}
