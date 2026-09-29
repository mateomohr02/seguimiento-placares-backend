import { z } from "zod";

export const CreateOrdenSchema = z.object({
  codigoOrdenFabricacion: z.coerce
    .number()
    .int()
    .positive("El número de orden debe ser un entero positivo."),
});

export type CreateOrdenSchemaType = z.infer<typeof CreateOrdenSchema>;
