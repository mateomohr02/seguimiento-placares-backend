import "dotenv/config";
import { z } from "zod";

// Convierte "" (variable presente pero vacía en el .env) en undefined, para
// que .optional() la trate como no seteada en vez de fallar min(1).
const optionalString = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  // Credenciales de TeoWin (SQL Server) — opcionales a nivel de parseo para no
  // bloquear el resto de la app (listado de órdenes propias, frontend) mientras
  // no estén provistas. teowin.ts valida su presencia recién al conectar,
  // con un error explícito, no un crash silencioso al arrancar.
  TEOWIN_DB_SERVER: optionalString(),
  // Instancia con nombre (ej. "TEOWIN" en SRVTEOWIN\TEOWIN) — si se setea, se
  // conecta por SQL Server Browser (UDP 1434) en vez de un puerto TCP fijo.
  TEOWIN_DB_INSTANCE: optionalString(),
  TEOWIN_DB_PORT: z.coerce.number().default(1433),
  TEOWIN_DB_NAME: optionalString(),
  TEOWIN_DB_USER: optionalString(),
  TEOWIN_DB_PASSWORD: optionalString(),
  TEOWIN_DB_ENCRYPT: z.coerce.boolean().default(true),
  TEOWIN_DB_TRUST_SERVER_CERTIFICATE: z.coerce.boolean().default(true),
  // Carpeta de datos 3D de TeoWin (solo lectura): de ahí se copian las texturas de las escenas 3D
  // (diseño.md §13). Por defecto T:/datos/3d/E_50. Si el disco no está, las escenas se ven con
  // colores lisos (o con las texturas ya copiadas a la base).
  TEOWIN_3D_DIR: optionalString(),
  // Autenticación por PIN (diseño.md §12). SESSION_SECRET firma la sesión: cambiarla solo
  // cierra las sesiones abiertas.
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET debe tener al menos 16 caracteres."),
  SESSION_HORAS: z.coerce.number().positive().default(12),
});

export const env = envSchema.parse(process.env);
