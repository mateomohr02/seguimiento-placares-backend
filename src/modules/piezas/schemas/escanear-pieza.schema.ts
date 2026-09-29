import { z } from "zod";

// diseño.md Vista 5 — formato esperado del código: siempre 7 dígitos
// numéricos (idUnico en Code39). Se valida el formato antes de buscar en base.
export const EscanearPiezaSchema = z.object({
  idUnico: z
    .string()
    .regex(/^\d{7}$/, "El código escaneado debe ser un número de 7 dígitos.")
    .transform(Number),
});

export type EscanearPiezaSchemaType = z.infer<typeof EscanearPiezaSchema>;
