import { z } from "zod";

// Coordenadas normalizadas: 0..1 sobre el ancho (x) y el alto (y) de la página.
// Los tamaños (grosor, tamano) son fracción del ancho de la página.
const unit = z.number().min(0).max(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido.");

const TextoPaginaSchema = z.object({
  tipo: z.literal("TEXTO"),
  pagina: z.number().int().min(1).max(10000),
  datos: z.object({
    x: unit,
    y: unit,
    texto: z.string().trim().min(1).max(500),
    tamano: z.number().min(0.005).max(0.1),
    color,
  }),
});

// Nota del documento: sin página, sin posición.
const NotaDocumentoSchema = z.object({
  tipo: z.literal("TEXTO"),
  pagina: z.null(),
  datos: z.object({ texto: z.string().trim().min(1).max(500) }),
});

const DibujoSchema = z.object({
  tipo: z.literal("DIBUJO"),
  pagina: z.number().int().min(1).max(10000),
  datos: z.object({
    puntos: z.array(z.tuple([unit, unit])).min(1).max(3000),
    grosor: z.number().min(0.0005).max(0.06),
    color,
    resaltador: z.boolean(),
  }),
});

export const CreateAnotacionSchema = z.union([TextoPaginaSchema, NotaDocumentoSchema, DibujoSchema]);
export type CreateAnotacionInput = z.infer<typeof CreateAnotacionSchema>;
