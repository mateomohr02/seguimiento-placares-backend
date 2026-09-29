import sql from "mssql";
import { env } from "./env";
import { AppError } from "../utils/AppError";

let pool: sql.ConnectionPool | null = null;

function buildConfig(): sql.config {
  if (!env.TEOWIN_DB_SERVER || !env.TEOWIN_DB_NAME || !env.TEOWIN_DB_USER || !env.TEOWIN_DB_PASSWORD) {
    throw new AppError(
      "Faltan credenciales de TeoWin en el .env (TEOWIN_DB_SERVER / TEOWIN_DB_NAME / TEOWIN_DB_USER / TEOWIN_DB_PASSWORD).",
      500,
    );
  }
  return {
    server: env.TEOWIN_DB_SERVER,
    // Instancia con nombre (ej. SRVTEOWIN\TEOWIN): se resuelve por SQL Server
    // Browser, sin puerto fijo. Si no hay instancia, se usa el puerto TCP.
    ...(env.TEOWIN_DB_INSTANCE ? {} : { port: env.TEOWIN_DB_PORT }),
    database: env.TEOWIN_DB_NAME,
    user: env.TEOWIN_DB_USER,
    password: env.TEOWIN_DB_PASSWORD,
    options: {
      encrypt: env.TEOWIN_DB_ENCRYPT,
      trustServerCertificate: env.TEOWIN_DB_TRUST_SERVER_CERTIFICATE,
      ...(env.TEOWIN_DB_INSTANCE ? { instanceName: env.TEOWIN_DB_INSTANCE } : {}),
    },
  };
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool(buildConfig()).connect();
  return pool;
}

// diseño.md §5.1: TeoWin es solo lectura, siempre. La garantía real tiene que
// venir del login de SQL Server (permisos acotados a SELECT, sin
// db_datawriter) — eso es responsabilidad de infraestructura, no de esta app.
// Este guard es una segunda barrera a nivel de código: rechaza cualquier
// texto de query que no sea un único SELECT, antes de mandarlo al driver.
const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|CREATE)\b/i;

function assertReadOnlySelect(queryText: string): void {
  const trimmed = queryText.trim();
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error("Solo se permiten queries SELECT contra TeoWin.");
  }
  if (trimmed.includes(";") && trimmed.indexOf(";") !== trimmed.length - 1) {
    throw new Error("No se permiten múltiples statements en una query a TeoWin.");
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    throw new Error("Query a TeoWin contiene una palabra clave de escritura prohibida.");
  }
}

export type TeowinParams = Record<string, string | number>;

export async function teowinQuery<T = Record<string, unknown>>(
  queryText: string,
  params: TeowinParams = {},
): Promise<T[]> {
  assertReadOnlySelect(queryText);
  const conn = await getPool();
  const request = conn.request();
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  const result = await request.query<T>(queryText);
  return result.recordset;
}
