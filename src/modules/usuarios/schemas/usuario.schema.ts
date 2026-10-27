import { z } from "zod";
import { parsearBody } from "../../../utils/parsearBody";
import { PIN_REGEX } from "../../auth/pin";

export const ROLES_USUARIO = ["fabrica", "tecnica", "gerencia", "admin"] as const;
export type RolUsuario = (typeof ROLES_USUARIO)[number];

/** Recorta y colapsa espacios. */
export const textoLimpio = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : v);

// El apellido es obligatorio al crear; solo se admite vacío al editar un usuario que ya lo tenía vacío (los anteriores a la
// feature; lo controla el service). El nombre siempre es obligatorio.
const nombre = z.preprocess(textoLimpio, z.string({ required_error: "es obligatorio" }).min(1, "es obligatorio").max(60, "admite hasta 60 caracteres"));
const apellido = z.preprocess(textoLimpio, z.string({ required_error: "es obligatorio (puede ir vacío)" }).max(60, "admite hasta 60 caracteres"));
const pin = z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string({ required_error: "es obligatorio" }).regex(PIN_REGEX, "debe tener de 4 a 10 dígitos numéricos"));
const rol = z.enum(ROLES_USUARIO, { errorMap: () => ({ message: "debe ser fabrica, tecnica, gerencia o admin" }) });
const estacionesIds = z.array(z.string().uuid("no es un id válido")).max(50);

// Los campos desconocidos se ignoran (Zod los descarta).
const apellidoObligatorio = z.preprocess(textoLimpio, z.string({ required_error: "es obligatorio" }).min(1, "es obligatorio").max(60, "admite hasta 60 caracteres"));
const CrearSchema = z.object({ nombre, apellido: apellidoObligatorio, pin, rol, estaciones_ids: estacionesIds.default([]) });
const EditarSchema = z.object({ nombre, apellido, pin, rol, activo: z.boolean(), estaciones_ids: estacionesIds }).partial();

export type UsuarioCrearInput = z.infer<typeof CrearSchema>;
export type UsuarioEditarInput = z.infer<typeof EditarSchema>;

export const parsearUsuarioCrear = (body: unknown) => parsearBody(CrearSchema, body);
export const parsearUsuarioEditar = (body: unknown) => parsearBody(EditarSchema, body);
