import { z } from "zod";

export const TIPOS_DOCUMENTO = [
  "NOTA_PEDIDO",
  "DETALLE_REMISION",
  "ESCANDALLO_PLACARES",
  "HERRAJES_PLACARES",
  "ACCESORIOS_PLACARES",
  "HERRAJES_COCINAS",
  "ACCESORIOS_COCINAS",
] as const;

export const ETIQUETA_TIPO: Record<(typeof TIPOS_DOCUMENTO)[number], string> = {
  NOTA_PEDIDO: "Nota de Pedido",
  DETALLE_REMISION: "Detalle de Remisión",
  ESCANDALLO_PLACARES: "Listado de Escandallo de Placares",
  HERRAJES_PLACARES: "Listado de Herrajes de Producción (Placares)",
  ACCESORIOS_PLACARES: "Listado de Accesorios de Instalación (Placares)",
  HERRAJES_COCINAS: "Listado de Herrajes de Producción (Cocinas)",
  ACCESORIOS_COCINAS: "Listado de Accesorios de Instalación (Cocinas)",
};

// El PDF viaja como body binario crudo (application/pdf); el resto por query.
export const UploadDocumentoQuerySchema = z.object({
  tipo: z.enum(TIPOS_DOCUMENTO),
  nombre: z.string().trim().max(80).optional(),
  archivo: z.string().trim().min(1).max(255),
});
