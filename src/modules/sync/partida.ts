import type { Prisma } from "@prisma/client";
import { fetchPartidasDeOrden } from "./teowin-orden.queries";
import type { TeowinPartidaRow } from "./teowin-orden.types";

// Normaliza el texto de TeoWin: separadores CR+LF -> \n, sin saltos ni espacios al inicio/fin.
export function normalizarTexto(t: string | null | undefined): string {
  return (t ?? "").replace(/\r\n?/g, "\n").trim();
}

const nulo = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

// Fila de TeoWin -> datos de ModuloPartida (sin modulo_id).
export function partidaDesdeRow(r: TeowinPartidaRow): Omit<Prisma.ModuloPartidaUncheckedCreateInput, "modulo_id"> {
  const descripcion = normalizarTexto(r.descripcion_partida);
  const titulo = normalizarTexto(r.titulo_partida).split("\n")[0].trim() || descripcion.split("\n")[0].trim() || null;
  return {
    unidades: nulo(r.uds) ?? 1,
    referencia: (r.referencia ?? "").trim(),
    titulo,
    descripcion,
    largo: nulo(r.L),
    alto: nulo(r.H),
    profundidad: nulo(r.P),
    capitulo: normalizarTexto(r.capitulo) || null,
    variantes: nulo(r.variantes),
    precio_unitario: nulo(r.precio_unitario),
    total: nulo(r.total),
  };
}

// Partidas de una orden indexadas por "pedido|modulo_id". Nunca lanza: si TeoWin falla o la consulta
// no devuelve nada, el módulo queda sin partida (null) y se completa después con `npm run partidas:completar`.
export async function cargarPartidasDeOrden(orden: number): Promise<Map<string, TeowinPartidaRow>> {
  const mapa = new Map<string, TeowinPartidaRow>();
  try {
    for (const r of await fetchPartidasDeOrden(orden)) mapa.set(`${r.pedido}|${r.modulo_id}`, r);
  } catch (err) {
    console.error(`[partidas] no se pudieron leer las partidas de la orden ${orden}:`, err instanceof Error ? err.message : err);
  }
  return mapa;
}
