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
});

export const env = envSchema.parse(process.env);
