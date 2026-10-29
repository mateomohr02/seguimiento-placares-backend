import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { fechaISO, parseFecha } from "../../planillas/schemas/planilla.schema";
import { PLANIFICACIONES, planificacionDe, type Plantilla } from "../planificacion.catalogo";
import { DIA_MS, datosDe, lunesDe, pedidosPorNTw } from "../planificacion.service";
import { ItemSchema, type ItemInput } from "../schemas/planificacion.schema";
import { MAX_FILAS, fechaDelNombre, leerLibro, normalizar, validarArchivo, type FilaLeida } from "./importar.parser";
import type { ConfirmarInput } from "./importar.schema";

// Importador de planificación desde `Planificación DD-MM-AA.xlsx`. Dos llamadas sin estado: `previsualizar` interpreta el archivo
// (no escribe nada) y `confirmar` recibe las filas (con las correcciones del usuario), las revalida y las carga en UNA transacción.
// Cada hoja se asocia a una PLANIFICACIÓN del catálogo por el nombre de la planificación (sin mayúsculas, tildes ni espacios de
// más): hoja «Termolaminado» -> TERMOLAMINADO, hoja «Calidad» -> CALIDAD. Las estaciones de trabajo no intervienen.

const ETIQUETA: Record<string, string> = { n_tw: "N° TW", cliente: "Cliente", modelo: "Modelo", color: "Color", compromiso: "Compromiso", modulos: "Módulos", observaciones: "Observaciones", dia: "Día", semana: "Semana" };

export type EstadoFila = "OK" | "SIN_PEDIDO" | "DUPLICADA" | "INVALIDA";

/** Problemas de una fila según las reglas de `POST /planificacion/items` (ItemSchema), con mensajes para el usuario. */
function problemasDeFila(plantilla: Plantilla, f: { dia: string | null; cliente: string; n_tw: string; modelo: unknown; color: unknown; compromiso: unknown; modulos: unknown; observaciones: unknown }, semana: string): { datos?: ItemInput; mensajes: string[] } {
  const r = ItemSchema.safeParse({ plantilla, semana, dia: f.dia, n_tw: f.n_tw, pedido_id: null, cliente: f.cliente, modelo: f.modelo, color: f.color, compromiso: f.compromiso, modulos: f.modulos, observaciones: f.observaciones });
  if (r.success) return { datos: r.data, mensajes: [] };
  return {
    mensajes: r.error.issues.map((i) => {
      const campo = String(i.path[0] ?? "");
      if (campo === "n_tw" && i.message === "es obligatorio") return "N° TW vacío: la fila queda excluida.";
      return `${ETIQUETA[campo] ?? campo}: ${i.message}.`;
    }),
  };
}

const clave = (plantilla: Plantilla, nTw: string, dia: string | null) => (plantilla === "CALIDAD" ? `${dia}|${nTw}` : nTw);

/** Filas vigentes de una planificación en una semana, con cuántas marcas de estado y observaciones de usuarios tienen. */
async function vigentesDe(db: Prisma.TransactionClient | typeof prisma, plantilla: Plantilla, semana: Date) {
  const items = await db.planificacionItem.findMany({
    where: { plantilla, semana_inicio: semana, eliminado_en: null },
    select: { n_tw: true, dia: true, _count: { select: { marcas: true, comentarios: { where: { eliminado_en: null } } } } },
  });
  return items;
}

// --- Previsualizar ---

export async function previsualizar(nombreOriginal: string, buf: Buffer) {
  const archivo = validarArchivo(nombreOriginal, buf);
  const semana = lunesDe(fechaDelNombre(archivo));
  const semanaISO = fechaISO(semana);
  const libro = await leerLibro(buf);

  // 1) Asociar cada hoja a una planificación por su nombre y leerla con el formato de esa planificación.
  interface HojaArmada {
    nombre: string;
    planificacion: { clave: Plantilla; nombre: string } | null;
    motivo?: string;
    leidas: FilaLeida[];
    avisos: string[];
  }
  const porNombre = new Map(PLANIFICACIONES.map((p) => [normalizar(p.nombre), p]));
  const armadas: HojaArmada[] = [];
  const usadas = new Set<Plantilla>();
  for (const h of libro) {
    const base: HojaArmada = { nombre: h.nombre, planificacion: null, leidas: [], avisos: [] };
    const p = porNombre.get(normalizar(h.nombre));
    if (!p) {
      armadas.push({ ...base, motivo: "No hay una planificación con ese nombre." });
      continue;
    }
    const planificacion = { clave: p.clave, nombre: p.nombre };
    if (usadas.has(p.clave)) {
      armadas.push({ ...base, planificacion, motivo: `Otra hoja del archivo ya corresponde a la planificación «${p.nombre}».` });
      continue;
    }
    const r = h.leer(p.clave);
    if (r.error || !r.filas) {
      armadas.push({ ...base, planificacion, motivo: `Formato no reconocido para la planificación ${p.nombre}: ${r.error ?? "hoja sin datos"}.` });
      continue;
    }
    usadas.add(p.clave);
    armadas.push({ ...base, planificacion, leidas: r.filas, avisos: r.avisos });
  }

  const total = armadas.reduce((s, h) => s + h.leidas.length, 0);
  if (total > MAX_FILAS) throw new AppError(`El archivo tiene ${total} filas con datos y el máximo es ${MAX_FILAS}.`, 400);

  // 2) Pedidos (una sola consulta) y filas ya vigentes en esa semana.
  const pedidos = await pedidosPorNTw(armadas.flatMap((h) => h.leidas.map((f) => f.n_tw)).filter((t) => t !== "" && !/\s/.test(t) && t.length <= 40));

  const hojas = [];
  for (let hi = 0; hi < armadas.length; hi++) {
    const h = armadas[hi];
    if (!h.planificacion || h.motivo) {
      hojas.push({ nombre_hoja: h.nombre, planificacion: h.planificacion, omitida: true, motivo: h.motivo, existente: { filas: 0, marcas: 0, observaciones: 0 }, filas: [] as unknown[] });
      continue;
    }
    const plantilla = h.planificacion.clave;
    const vigentes = await vigentesDe(prisma, plantilla, semana);
    const existente = {
      filas: vigentes.length,
      marcas: vigentes.reduce((s, i) => s + i._count.marcas, 0),
      observaciones: vigentes.reduce((s, i) => s + i._count.comentarios, 0),
    };
    const yaVigentes = new Set(vigentes.map((i) => clave(plantilla, i.n_tw, i.dia ? fechaISO(i.dia) : null)));
    const vistas = new Map<string, number>(); // clave -> fila de Excel de la primera ocurrencia
    const filas = h.leidas.map((f) => {
      const dia = f.dia_offset === null ? null : fechaISO(new Date(semana.getTime() + f.dia_offset * DIA_MS));
      const avisos = [...f.avisos];
      const { mensajes } = problemasDeFila(plantilla, { dia, cliente: f.cliente, n_tw: f.n_tw, modelo: f.modelo, color: f.color, compromiso: f.compromiso, modulos: f.modulos, observaciones: f.observaciones }, semanaISO);
      let estado: EstadoFila;
      const k = clave(plantilla, f.n_tw, dia);
      const pedido = mensajes.length === 0 ? pedidos.get(f.n_tw) : undefined;
      if (mensajes.length > 0) {
        estado = "INVALIDA";
        avisos.push(...mensajes);
      } else if (vistas.has(k)) {
        estado = "DUPLICADA";
        avisos.push(`N° TW repetido${plantilla === "CALIDAD" ? " en el mismo día" : ""}: ya figura en la fila ${vistas.get(k)} y se carga una sola vez (la primera).`);
      } else {
        vistas.set(k, f.fila_excel);
        if (pedido) estado = "OK";
        else {
          estado = "SIN_PEDIDO";
          avisos.push("No se encontró un pedido con ese N° TW.");
        }
      }
      return {
        clave: `h${hi}-f${f.fila_excel}`,
        fila_excel: f.fila_excel,
        dia,
        cliente: f.cliente,
        n_tw: f.n_tw,
        modelo: f.modelo,
        color: f.color,
        compromiso: f.compromiso,
        modulos: f.modulos,
        observaciones: f.observaciones,
        pedido: pedido ? { pedido_id: pedido.id, n_orden: pedido.orden.numeroOrdenCustom } : null,
        estado,
        avisos,
        ya_existe: mensajes.length === 0 && yaVigentes.has(k),
      };
    });
    hojas.push({ nombre_hoja: h.nombre, planificacion: h.planificacion, omitida: false, existente, filas, ...(h.avisos.length ? { avisos: h.avisos } : {}) });
  }

  const avisos: string[] = [];
  for (const h of armadas) {
    if (h.motivo) avisos.push(`La hoja «${h.nombre}» se omitió: ${h.motivo}`);
    avisos.push(...h.avisos);
  }
  if (!armadas.some((h) => !h.motivo)) avisos.push(`Ninguna hoja del archivo tiene el nombre de una planificación (${PLANIFICACIONES.map((p) => p.nombre).join(", ")}): no hay nada para cargar.`);
  else if (total === 0) avisos.push("El archivo no tiene filas con datos.");
  return { archivo, semana_inicio: semanaISO, hojas, avisos };
}

// --- Confirmar ---

export async function confirmar(input: ConfirmarInput) {
  const semana = lunesDe(parseFecha(input.semana, "La semana"));
  const semanaISO = fechaISO(semana);

  const claves = input.hojas.map((h) => h.plantilla);
  if (new Set(claves).size !== claves.length) throw new AppError("hojas: hay dos hojas para la misma planificación.", 400);
  const total = input.hojas.reduce((s, h) => s + h.filas.length, 0);
  if (total > MAX_FILAS) throw new AppError(`hojas: se pueden cargar hasta ${MAX_FILAS} filas por vez (llegaron ${total}).`, 400);

  // Revalidación de cada fila con las reglas de POST /planificacion/items.
  interface Validada { input: ItemInput; fila: number }
  const validadas: Validada[][] = input.hojas.map((h) => {
    const plantilla = h.plantilla;
    const nombrePlanificacion = planificacionDe(plantilla).nombre;
    return h.filas.map((crudo, fi) => {
      const ctx = `Planificación «${nombrePlanificacion}», fila ${fi + 1} de la lista`;
      if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) throw new AppError(`${ctx}: debe ser un objeto.`, 400);
      const c = crudo as Record<string, unknown>;
      const r = ItemSchema.safeParse({
        plantilla, semana: semanaISO, dia: c.dia ?? null, n_tw: c.n_tw, pedido_id: null, cliente: c.cliente ?? "",
        modelo: c.modelo ?? null, color: c.color ?? null, compromiso: c.compromiso ?? null, modulos: c.modulos ?? null, observaciones: c.observaciones ?? null,
      });
      if (!r.success) {
        const i = r.error.issues[0];
        const campo = String(i.path[0] ?? "");
        throw new AppError(`${ctx} (N° TW «${typeof c.n_tw === "string" ? c.n_tw : ""}»): ${ETIQUETA[campo] ?? campo}: ${i.message}.`, 400);
      }
      if (plantilla === "CALIDAD") {
        // dia: obligatorio y de lunes a sábado de la semana (misma regla que el alta de una fila).
        if (!r.data.dia) throw new AppError(`${ctx}: Día: es obligatorio en la planificación de Calidad (de lunes a sábado).`, 400);
        const d = Math.round((parseFecha(r.data.dia, "El día").getTime() - semana.getTime()) / DIA_MS);
        if (d < 0 || d > 5) throw new AppError(`${ctx}: Día: tiene que ser un día de lunes a sábado de la semana del ${semanaISO}.`, 400);
      }
      return { input: r.data, fila: fi + 1 };
    });
  });

  const pedidos = await pedidosPorNTw(validadas.flat().map((v) => v.input.n_tw));

  try {
    return await prisma.$transaction(
      async (tx) => {
        const planificacionesOut = [];
        // Bloqueo por planificación (no hay una fila que bloquear: se usa un bloqueo asesor de la transacción), en orden fijo
        // para que dos importaciones simultáneas no se traben entre sí. Las importaciones de la misma planificación se serializan.
        for (const cl of [...claves].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"planificacion_importar:" + cl}))`;

        for (let hi = 0; hi < input.hojas.length; hi++) {
          const h = input.hojas[hi];
          const plantilla = h.plantilla;
          const avisos: string[] = [];
          let quitadas = 0;
          let siguientes = new Map<string, number>(); // día (o "") -> próximo `orden`
          let yaVigentes = new Set<string>();

          if (h.modo === "pisar") {
            const r = await tx.planificacionItem.updateMany({ where: { plantilla, semana_inicio: semana, eliminado_en: null }, data: { eliminado_en: new Date() } });
            quitadas = r.count;
          } else {
            const vigentes = await vigentesDe(tx, plantilla, semana);
            yaVigentes = new Set(vigentes.map((i) => clave(plantilla, i.n_tw, i.dia ? fechaISO(i.dia) : null)));
            const maximos = await tx.planificacionItem.groupBy({ by: ["dia"], where: { plantilla, semana_inicio: semana, eliminado_en: null }, _max: { orden: true } });
            siguientes = new Map(maximos.map((m) => [m.dia ? fechaISO(m.dia) : "", (m._max.orden ?? -1) + 1]));
          }

          // Calidad: por día y, dentro del día, en el orden recibido (el orden del archivo).
          const filas = validadas[hi].map((v, idx) => ({ ...v, idx }));
          if (plantilla === "CALIDAD") filas.sort((a, b) => (a.input.dia! < b.input.dia! ? -1 : a.input.dia! > b.input.dia! ? 1 : a.idx - b.idx));

          const vistas = new Set<string>();
          const aInsertar: ReturnType<typeof datosDe>[] = [];
          let sinPedido = 0;
          let excluidas = 0;
          let omitidas = 0;
          for (const v of filas) {
            const k = clave(plantilla, v.input.n_tw, v.input.dia);
            if (vistas.has(k)) {
              excluidas++;
              avisos.push(`Fila ${v.fila}: N° TW «${v.input.n_tw}» repetido${plantilla === "CALIDAD" ? " en el mismo día" : ""}; se cargó solo la primera.`);
              continue;
            }
            vistas.add(k);
            if (h.modo === "agregar" && yaVigentes.has(k)) {
              omitidas++;
              continue;
            }
            const pedido = pedidos.get(v.input.n_tw);
            if (!pedido && input.sin_pedido === "excluir") {
              excluidas++;
              avisos.push(`Fila ${v.fila}: N° TW «${v.input.n_tw}» sin pedido; se excluyó.`);
              continue;
            }
            if (!pedido) sinPedido++;
            aInsertar.push(datosDe(v.input, { pedido_id: pedido?.id ?? null, n_tw: v.input.n_tw }));
          }

          const filasDB = aInsertar.map((d) => {
            const dk = d.dia ? fechaISO(d.dia) : "";
            const orden = siguientes.get(dk) ?? 0;
            siguientes.set(dk, orden + 1);
            return { ...d, orden };
          });
          if (filasDB.length > 0) await tx.planificacionItem.createMany({ data: filasDB });
          planificacionesOut.push({ clave: plantilla, nombre: planificacionDe(plantilla).nombre, cargadas: filasDB.length, sin_pedido: sinPedido, excluidas, ya_existentes_omitidas: omitidas, quitadas, avisos });
        }
        return { semana_inicio: semanaISO, planificaciones: planificacionesOut };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("Importar planificación: la carga falló y se deshizo", err);
    throw new AppError("No se pudo cargar la planificación: ocurrió un error al guardar y no se guardó nada. Revisá los datos (por ejemplo caracteres inválidos) y probá de nuevo.", 409);
  }
}
