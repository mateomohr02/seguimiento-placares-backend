import ExcelJS from "exceljs";
import JSZip from "jszip";
import { AppError } from "../../../utils/AppError";

// Lectura de `Planificación DD-MM-AA.xlsx` (importador de planificación). Solo LEE valores: no evalúa fórmulas (usa el resultado
// guardado), ignora macros y no usa el nombre del archivo como ruta (todo en memoria). Los encabezados se ubican por NOMBRE.

export const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;
export const MAX_FILAS = 2000;
const MAX_HOJAS = 30;
const MAX_FILAS_RECORRIDAS = 20000; // filas de la hoja a recorrer (incluye vacías); más que eso es un archivo anormal
const MAX_DESCOMPRIMIDO = 100 * 1024 * 1024;
const MAX_ENTRADAS_ZIP = 2000;

/** Mayúsculas, sin tildes, sin signos de «N°» ni puntos y sin espacios de más: para comparar encabezados, títulos y nombres. */
export function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[°º.]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const CAMPOS = {
  cliente: ["CLIENTE"],
  n_tw: ["NUMERO TEOWIN", "NUM TEOWIN", "N TW"],
  modelo: ["MODELO"],
  color: ["COLOR"],
  compromiso: ["COMPROMISO"],
  modulos: ["MODULOS"],
  observaciones: ["OBSERVACIONES"],
} as const;
type Campo = keyof typeof CAMPOS;

const DIAS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];

/** Fila leída de una hoja, ya interpretada (todavía sin mirar la base). `avisos` = problemas de lectura de esa fila. */
export interface FilaLeida {
  fila_excel: number;
  /** 0 = lunes ... 5 = sábado; null en Termolaminado. */
  dia_offset: number | null;
  cliente: string;
  n_tw: string;
  modelo: string | null;
  color: string | null;
  compromiso: string | null; // AAAA-MM-DD
  modulos: number | null;
  observaciones: string | null;
  avisos: string[];
}

export interface HojaLeida {
  nombre: string;
  /** Lee la hoja con el formato de la plantilla de su estación. `error` = problema de formato que impide leerla (se omite). */
  leer(plantilla: "TERMOLAMINADO" | "CALIDAD"): { filas?: FilaLeida[]; error?: string; avisos: string[] };
}

// --- Validación del contenedor ---

/** Suma de los tamaños descomprimidos según el directorio central del zip (defensa contra «bombas» zip), o lanza 400. */
function revisarZip(buf: Buffer): void {
  const ilegible = () => new AppError("No se pudo leer el archivo: no es un .xlsx válido.", 400);
  if (buf.length < 22) throw ilegible();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw ilegible();
  const entradas = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (entradas === 0xffff || pos === 0xffffffff) throw new AppError("El archivo es demasiado complejo para importarlo.", 400);
  if (entradas > MAX_ENTRADAS_ZIP) throw new AppError("El archivo tiene demasiados componentes internos.", 400);
  let total = 0;
  for (let n = 0; n < entradas; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw ilegible();
    const descomprimido = buf.readUInt32LE(pos + 24);
    if (descomprimido === 0xffffffff) throw new AppError("El archivo es demasiado grande una vez descomprimido.", 400);
    total += descomprimido;
    if (total > MAX_DESCOMPRIMIDO) throw new AppError("El archivo es demasiado grande una vez descomprimido.", 400);
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
}

/** Valida nombre, firma y tamaño del archivo subido; devuelve el nombre normalizado a UTF-8 para mostrarlo. */
export function validarArchivo(nombreOriginal: string, buf: Buffer): string {
  // busboy entrega el nombre como latin1: si en realidad venía en UTF-8 (tildes), se recupera.
  let nombre = nombreOriginal;
  const recodificado = Buffer.from(nombreOriginal, "latin1").toString("utf8");
  if (!recodificado.includes("�") && recodificado !== nombreOriginal) nombre = recodificado;
  nombre = nombre.replace(/[\u0000-\u001f]/g, "").slice(-200);
  if (!/\.xlsx$/i.test(nombre)) throw new AppError("El archivo tiene que ser un Excel .xlsx (no se admiten .xls ni .xlsm).", 400);
  if (buf.length === 0) throw new AppError("El archivo está vacío.", 400);
  if (buf.length > MAX_ARCHIVO_BYTES) throw new AppError("El archivo supera el máximo de 5 MB.", 413);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new AppError("El archivo no es un .xlsx válido (firma incorrecta).", 400);
  revisarZip(buf);
  return nombre;
}

/** Lunes de la semana indicada por el nombre del archivo (patrón DD-MM-AA o DD-MM-AAAA, separadores - . _), o lanza 400. */
export function fechaDelNombre(nombre: string): Date {
  const re = /(?<!\d)(\d{1,2})[-._](\d{1,2})[-._](\d{4}|\d{2})(?!\d)/g;
  for (const m of nombre.matchAll(re)) {
    const d = Number(m[1]);
    const mes = Number(m[2]);
    const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const fecha = new Date(Date.UTC(a, mes - 1, d));
    if (fecha.getUTCFullYear() === a && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === d && a >= 2000 && a <= 2100) return fecha;
  }
  throw new AppError("El nombre del archivo debe llevar la fecha DD-MM-AA (por ejemplo «Planificación 26-10-26.xlsx»).", 400);
}

// --- Lectura de celdas (valores, nunca fórmulas) ---

type Valor = ExcelJS.CellValue;

function plano(v: Valor): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "VERDADERO" : "FALSO";
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("error" in o) return null;
    if ("result" in o) return plano(o.result as Valor); // fórmula: solo el resultado guardado
    if ("formula" in o || "sharedFormula" in o) return null; // fórmula sin resultado: no se evalúa
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if ("text" in o) return plano(o.text as Valor); // hipervínculo
  }
  return null;
}

const limpiar = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim();

function texto(v: Valor): string {
  const p = plano(v);
  if (p === null) return "";
  if (p instanceof Date) return p.toISOString().slice(0, 10);
  return limpiar(String(p));
}

const iso = (a: number, m: number, d: number): string | null => {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (a < 2000 || a > 2100 || f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
};

/** Compromiso: fecha de Excel, número de serie de Excel o texto dd/mm/aaaa (también dd-mm-aaaa, dd.mm.aaaa y aaaa-mm-dd). null = inválida. */
function leerFecha(v: Valor): { vacia: boolean; fecha: string | null } {
  const p = plano(v);
  if (p === null || (typeof p === "string" && limpiar(p) === "")) return { vacia: true, fecha: null };
  if (p instanceof Date) return { vacia: false, fecha: Number.isNaN(p.getTime()) ? null : iso(p.getUTCFullYear(), p.getUTCMonth() + 1, p.getUTCDate()) };
  if (typeof p === "number") {
    if (!Number.isFinite(p) || p < 36526 || p > 73415) return { vacia: false, fecha: null };
    const f = new Date(Math.round((Math.floor(p) - 25569) * 86_400_000));
    return { vacia: false, fecha: iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()) };
  }
  const s = limpiar(p);
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/.exec(s);
  if (m) return { vacia: false, fecha: iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1])) };
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { vacia: false, fecha: iso(Number(m[1]), Number(m[2]), Number(m[3])) };
  return { vacia: false, fecha: null };
}

/** N° TW como texto recortado; un número de Excel se pasa sin decimales. */
function leerNTw(v: Valor, avisos: string[]): string {
  const p = plano(v);
  if (typeof p === "number") {
    if (!Number.isInteger(p)) avisos.push("El N° TW es un número con decimales: se tomó la parte entera.");
    return String(Math.trunc(p));
  }
  return texto(v);
}

function leerModulos(v: Valor, avisos: string[]): number | null {
  const p = plano(v);
  if (p === null || (typeof p === "string" && limpiar(p) === "")) return null;
  const n = typeof p === "number" ? p : typeof p === "string" && /^\d+$/.test(limpiar(p)) ? Number(limpiar(p)) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    avisos.push(`Módulos «${texto(v)}» no es un entero mayor o igual a 0: quedó vacío.`);
    return null;
  }
  return n;
}

const opcional = (s: string) => (s === "" ? null : s);

type Columnas = Partial<Record<Campo, number>>;

/** Ubica cada encabezado por nombre en una fila (la primera columna que coincide; las repetidas a la derecha se ignoran). */
function ubicarColumnas(fila: ExcelJS.Row, ancho: number): Columnas {
  const cols: Columnas = {};
  for (let c = 1; c <= ancho; c++) {
    const nombre = normalizar(texto(fila.getCell(c).value));
    if (nombre === "") continue;
    for (const campo of Object.keys(CAMPOS) as Campo[]) {
      if (cols[campo] === undefined && (CAMPOS[campo] as readonly string[]).includes(nombre)) cols[campo] = c;
    }
  }
  return cols;
}

function leerFila(ws: ExcelJS.Worksheet, n: number, cols: Columnas, diaOffset: number | null, calidad: boolean): FilaLeida | null {
  const row = ws.getRow(n);
  const val = (campo: Campo): Valor => (cols[campo] === undefined ? null : row.getCell(cols[campo]!).value);
  const avisos: string[] = [];
  const cliente = texto(val("cliente"));
  const n_tw = leerNTw(val("n_tw"), avisos);
  const modelo = opcional(texto(val("modelo")));
  const observaciones = opcional(texto(val("observaciones")));
  let color: string | null = null;
  let compromiso: string | null = null;
  let modulos: number | null = null;
  let hayDato = cliente !== "" || n_tw !== "" || modelo !== null || observaciones !== null;
  if (calidad) {
    const v = val("modulos");
    hayDato = hayDato || texto(v) !== "";
    modulos = leerModulos(v, avisos);
  } else {
    color = opcional(texto(val("color")));
    const f = leerFecha(val("compromiso"));
    hayDato = hayDato || color !== null || !f.vacia;
    if (!f.vacia && f.fecha === null) avisos.push(`El compromiso «${texto(val("compromiso"))}» no es una fecha válida (dd/mm/aaaa): quedó vacío.`);
    compromiso = f.fecha;
  }
  if (!hayDato) return null; // fila totalmente vacía (las columnas NUM ORD / NUM ORDEN se ignoran)
  return { fila_excel: n, dia_offset: diaOffset, cliente, n_tw, modelo, color, compromiso, modulos, observaciones, avisos };
}

function anchoDe(ws: ExcelJS.Worksheet): number {
  return Math.min(Math.max(ws.columnCount, 1), 60);
}

/** Termolaminado: un encabezado (la primera fila de las 15 primeras que tenga la columna del N° TW) y filas hasta el final. */
function leerTermolaminado(ws: ExcelJS.Worksheet): { filas?: FilaLeida[]; error?: string } {
  const ancho = anchoDe(ws);
  const ultima = ws.rowCount;
  for (let r = 1; r <= Math.min(15, ultima); r++) {
    const cols = ubicarColumnas(ws.getRow(r), ancho);
    if (cols.n_tw === undefined) continue;
    const filas: FilaLeida[] = [];
    for (let n = r + 1; n <= ultima; n++) {
      const f = leerFila(ws, n, cols, null, false);
      if (f) filas.push(f);
    }
    return { filas };
  }
  return { error: "no se encontró la columna del N° TW (NUMERO TEOWIN) en las primeras filas" };
}

/** Calidad: bloques por día (título en la columna A: Lunes ... Sábado) con sus encabezados en la fila siguiente. */
function leerCalidad(ws: ExcelJS.Worksheet, avisos: string[]): { filas?: FilaLeida[]; error?: string } {
  const ancho = anchoDe(ws);
  const ultima = ws.rowCount;
  const titulos: { fila: number; dia: number }[] = [];
  for (let r = 1; r <= ultima; r++) {
    const d = DIAS.indexOf(normalizar(texto(ws.getRow(r).getCell(1).value)));
    if (d >= 0) titulos.push({ fila: r, dia: d });
  }
  if (titulos.length === 0) return { error: "no se encontraron los títulos de los días (Lunes ... Sábado) en la columna A" };
  const filas: FilaLeida[] = [];
  let bloques = 0;
  titulos.forEach((t, i) => {
    const fin = (titulos[i + 1]?.fila ?? ultima + 1) - 1;
    const cols = ubicarColumnas(ws.getRow(t.fila + 1), ancho);
    if (cols.n_tw === undefined) {
      avisos.push(`Hoja «${ws.name}»: el bloque «${texto(ws.getRow(t.fila).getCell(1).value)}» no tiene encabezados en la fila siguiente (con NUM TEOWIN): se omitió.`);
      return;
    }
    bloques++;
    for (let n = t.fila + 2; n <= fin; n++) {
      const f = leerFila(ws, n, cols, t.dia, true);
      if (f) filas.push(f);
    }
  });
  if (bloques === 0) return { error: "ningún día tiene sus encabezados (CLIENTE, NUM TEOWIN...) en la fila siguiente al título" };
  return { filas };
}

/**
 * Las plantillas oficiales traen notas (comentarios) en los encabezados. exceljs falla al leer notas cuyo vínculo interno es una
 * ruta absoluta (como las que escriben algunas librerías), y las notas no aportan datos: se quitan de los vínculos de cada hoja
 * antes de leer. Solo se reescribe el zip si alguna hoja tiene notas.
 */
async function sinNotas(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const rels = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(n));
  let cambio = false;
  for (const nombre of rels) {
    const xml = await zip.file(nombre)!.async("string");
    const limpio = xml.replace(/<Relationship\s[^>]*\/>/g, (r) => (/\/(comments|vmlDrawing)"/.test(r) ? "" : r));
    if (limpio === xml) continue;
    cambio = true;
    zip.file(nombre, limpio);
    const hoja = nombre.replace("_rels/", "").replace(/\.rels$/, "");
    const hojaXml = zip.file(hoja);
    if (hojaXml) zip.file(hoja, (await hojaXml.async("string")).replace(/<legacyDrawing\s[^>]*\/>/g, ""));
  }
  return cambio ? Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })) : buf;
}

/**
 * Abre el libro y devuelve sus hojas (cada una se lee después con el formato de la plantilla de su estación). Lanza 400 si el
 * archivo es ilegible o supera los límites.
 */
export async function leerLibro(buf: Buffer): Promise<HojaLeida[]> {
  const wb = new ExcelJS.Workbook();
  try {
    // El tipo de exceljs espera su propio `Buffer`; el contenido es el mismo.
    await wb.xlsx.load((await sinNotas(buf)) as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError("No se pudo leer el archivo: no es un .xlsx válido o está dañado.", 400);
  }
  const hojasWb = wb.worksheets;
  if (hojasWb.length === 0) throw new AppError("El archivo no tiene hojas.", 400);
  if (hojasWb.length > MAX_HOJAS) throw new AppError(`El archivo tiene demasiadas hojas (máximo ${MAX_HOJAS}).`, 400);
  for (const ws of hojasWb) {
    if (ws.rowCount > MAX_FILAS_RECORRIDAS) throw new AppError(`La hoja «${ws.name}» tiene demasiadas filas (máximo ${MAX_FILAS_RECORRIDAS}).`, 400);
  }
  return hojasWb.map((ws) => ({
    nombre: ws.name,
    leer(plantilla) {
      const avisos: string[] = [];
      const r = plantilla === "CALIDAD" ? leerCalidad(ws, avisos) : leerTermolaminado(ws);
      return { ...r, avisos };
    },
  }));
}
