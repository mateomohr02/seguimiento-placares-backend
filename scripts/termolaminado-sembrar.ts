// Siembra la base de PRUEBA con partes de producción de ejemplo de Termolaminado (Lijado → Encolado → PVC),
// con el estilo de las planillas de papel (diseño.md §14). Solo corre contra `Neostone_test`.
//   npm run termolaminado:sembrar
// Reemplaza todas las planillas (y sus fotos y versiones) de 2026-10-05 al 2026-10-16. Si la lista de
// estación de trabajo termolaminado1 no existe la crea; la deja con su estado
// "Listo Termolaminado" y las tres planillas (operarios históricos Fabián y Carlos), y siembra la planificación (pedidos y reclamos) de ejemplo.
// En PVC cada fila es una TANDA de mesas (diseño.md §14.12): 1 a 3 pedidos del día, tamaño y cantidad de mesas.
// Las fotos de PVC son imágenes de relleno.
import { Prisma, type PlanillaEstacion } from "@prisma/client";
import { deflateSync, crc32 } from "node:zlib";
import { prisma } from "../src/config/prisma";

const DESDE = "2026-10-05";
const HASTA = "2026-10-16";
const AREA = "TERMOLAMINADO";
const ESTACION_TRABAJO = "termolaminado1";
const USUARIO = "termolaminado1"; // autor que queda en creado_por / modificado_por de lo sembrado

// Generador pseudoaleatorio con semilla fija (la siembra es repetible).
let semilla = 20261019;
const rnd = () => {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
};
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elegir = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

const COLORES = ["MAC", "NM", "BB", "CAJUN", "HG", "GG", "NS"];
const OBSERVACIONES = ["", "", "", "Completo", "Sin novedades", "Falta una pieza, sigue mañana", "Cocina final", "Pieza con golpe, se rehace"];
const COLOCACION = ["Completa", "Solo laterales", "Frentes", "Completa, 2 mm", "Frentes y tapas"];
const PERFILADO = ["Perfilado OK", "Corte a medida", "Perfilado y lijado de canto", ""];

const diasHabiles = (desde: string, hasta: string) => {
  const out: string[] = [];
  for (let d = new Date(`${desde}T00:00:00Z`); d <= new Date(`${hasta}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

// PNG liso de relleno (64×64) para las fotos de ejemplo.
function png(r: number, g: number, b: number): Buffer {
  const w = 64;
  const raw = Buffer.alloc((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (tipo: string, datos: Buffer) => {
    const t = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(t));
    return Buffer.concat([len, t, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

interface Pedido {
  codigo: string;
  piezas: number;
  color: string;
  /** Día (índice en los días hábiles) en que entra a Lijado. */
  inicio: number;
  /** Hasta qué estación llegó: 1 = Lijado, 2 = Encolado, 3 = PVC. */
  llega: number;
  nota?: string;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Planificación de ejemplo, copiada de las planillas de la oficina técnica (semanas 39 a 41 y reclamos).
async function sembrarPlanificacion(listoTermoId: string) {
  type P = [cliente: string, nTw: string, modelo: string, color: string, fabrica: string, limite: string];
  const semanas: { semana: string; filas: P[] }[] = [
    {
      semana: "2026-09-21",
      filas: [
        ["Perchante Luciano - MARMOLES LOPEZ", "JN2-00118", "LONDON", "BLANCO MATE", "2026-09-25", "2026-09-07"],
        ["Valentini Daniela - ACCESANIGA", "RO-01315", "LONDON", "MACADAMIA", "2026-09-25", "2026-09-07"],
        ["Valentini Daniela - ACCESANIGA", "RO-01228", "LONDON", "MACADAMIA", "2026-09-25", "2026-09-07"],
        ["Valentini Daniela - ACCESANIGA", "RO-01226", "LONDON", "MACADAMIA", "2026-09-25", "2026-09-07"],
        ["Garcia Ariana - DI-SEGNO DI NOI", "S1-01017_001", "LONDON + PURA", "BLANCO MATE", "2026-09-25", "2026-09-07"],
        ["Borrego Susana - PAPPALARDO DORELLA", "VGS-00116_001", "LONDON", "MACADAMIA", "2026-09-25", "2026-09-07"],
      ],
    },
    {
      semana: "2026-09-28",
      filas: [
        ["Sobrero Victoria - ALCOBER EMMANUEL", "VLA3-00205_001", "HERENCIA", "BLANCO MATE", "2026-10-02", "2026-10-14"],
        ["Ellemberger Nicolas - NEOSTONE CRESPO", "CR-03990_004", "URBAN TERM", "MACADAMIA", "2026-10-02", "2026-10-14"],
        ["Jurado Gabriel - AMOBLASUR SAS", "TR-01316_001", "URBAN TERM", "MACADAMIA", "2026-10-02", "2026-10-21"],
      ],
    },
    {
      semana: "2026-10-05",
      filas: [
        ["Prada Graciela - NEOSTONE CRESPO", "CR-03913", "LONDON", "GRIS GRAFITO", "2026-10-09", "2026-10-21"],
        ["Orzuza Valeria - NEOSTONE CRESPO", "CR-03821_003", "HERENCIA", "NEGRO MATE", "2026-10-09", "2026-10-21"],
        ["Sochor Estela - SVP GROUP SRL", "MDQ-00630_001", "URBAN TERM", "BLANCO BRILLANTE", "2026-10-09", "2026-10-21"],
        ["Tocallini Francisco - MARMOLES TURCO SRL", "PE-00182_001", "URBAN TERM", "BLANCO MATE", "2026-10-09", "2026-10-21"],
      ],
    },
  ];
  const terminados = new Set(["JN2-00118", "RO-01315", "RO-01228", "RO-01226", "VGS-00116_001", "TR-01316_001"]);
  const semanasSembradas = [...semanas.map((s) => s.semana), "2026-10-12"].map(d);
  await prisma.planificacionItem.deleteMany({ where: { area: AREA, semana_inicio: { in: semanasSembradas } } });

  let items = 0;
  for (const { semana, filas } of semanas) {
    for (const [orden, [cliente, n_tw, modelo, color, fabrica, limite]] of filas.entries()) {
      const item = await prisma.planificacionItem.create({
        data: { area: AREA, tipo: "PEDIDOS", semana_inicio: d(semana), orden, cliente, n_tw, modelo, color, fabrica: d(fabrica), fecha_limite: d(limite) },
      });
      items++;
      if (terminados.has(n_tw)) {
        await prisma.planificacionMarca.create({ data: { item_id: item.id, estado_id: listoTermoId, marcado_por: USUARIO, marcado_en: new Date(`${fabrica}T18:00:00Z`) } });
      }
    }
  }

  type R = [cliente: string, distribuidor: string, ticket: string, nTw: string, tipo: string, color: string, compromiso: string, finalizado: string | null, obs: string | null];
  const reclamos: R[] = [
    ["EDIFICIO VICTORIA", "LOCAL", "HT01405", "", "Relaminado / 182 placas", "GRIS GRAFITO", "2026-10-23", null, "Falta carpeta roja"],
    ["DITTLER ANA CLARA", "LOCAL", "HT01223", "", "Relaminado / 6 placas", "BLANCO MATE", "2026-10-12", null, null],
    ["LEONARDON GONZALO", "LOCAL", "HT01336", "", "Relaminado / 11 placas", "BLANCO MATE", "2026-10-12", null, null],
    ["DITTLER ANA CLARA", "LOCAL", "HT01369", "", "Modificación y relaminado / 1", "BLANCO MATE", "2026-10-12", null, null],
    ["PUSINERI JUAN MANUEL", "LOCAL", "HT01381", "", "Relaminado / 4 puertas", "BLANCO MATE", "2026-10-12", null, null],
    ["SHOWROOM ALCOBER", "ALCOBER", "HT01315", "26-02668", "Carpintería y relaminado", "BLANCO MATE", "2026-10-12", "2026-10-01", null],
    ["ARGILES PABLO", "ALCOBER", "HT01400", "26-02688", "Carpintería y relaminado", "BLANCO MATE", "2026-10-12", "2026-10-01", null],
    ["SCHUNK MIGUEL", "LOCAL", "HT01416", "", "Relaminado / 43 placas", "GRIS GRAFITO/MADERA", "2026-10-16", null, "No está aún"],
    ["DEGRACIA JOSEFINA", "LOCAL", "HT01404", "", "Relaminado / 23 placas", "BLANCO BRILLANTE", "2026-10-16", null, null],
    ["ALONSO JUAN CARLOS", "LOCAL", "HT01414", "", "Relaminado / 23 placas", "BLANCO BRILLANTE", "2026-10-16", null, null],
    ["VIVAS MARIO", "LOCAL", "HT01415", "", "Relaminado / 9 placas", "BLANCO BRILLANTE", "2026-10-16", null, null],
    ["BENTANCOR REGINA", "LOCAL", "HT01417", "", "Relaminado / 10 placas", "BLANCO BRILLANTE", "2026-10-16", null, null],
  ];
  for (const [orden, [cliente, distribuidor, ticket, n_tw, tipo_reclamo, color, compromiso, finalizado, observaciones]] of reclamos.entries()) {
    await prisma.planificacionItem.create({
      data: { area: AREA, tipo: "RECLAMOS", semana_inicio: d("2026-10-12"), orden, cliente, distribuidor, ticket, n_tw, tipo_reclamo, color, compromiso: d(compromiso), finalizado_en: finalizado ? d(finalizado) : null, observaciones },
    });
    items++;
  }
  console.log(`Planificación sembrada: ${items} filas (semanas 21/09, 28/09, 05/10 y reclamos del 12/10).`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/Neostone_test(\?|$)/.test(url)) {
    console.error("Este script solo corre contra la base Neostone_test (DATABASE_URL no apunta a ella). No se hizo nada.");
    process.exit(1);
  }

  // Estación de trabajo termolaminado1 (diseño.md §17): las tres planillas y el estado "Listo Termolaminado". Los
  // operarios de las planillas sembradas son nombres históricos (sin usuario, bloqueados), como los de antes de las estaciones.
  for (const [orden, [nombre, color]] of ([["Listo Termolaminado", "#16a34a"], ["Listo Mecanizado", "#2563eb"]] as const).entries()) {
    await prisma.estadoProduccion.upsert({ where: { nombre }, update: { color }, create: { nombre, color, orden } });
  }
  const listoTermo = await prisma.estadoProduccion.findUniqueOrThrow({ where: { nombre: "Listo Termolaminado" } });
  let estacionTrabajo = await prisma.estacionTrabajo.findFirst({ where: { nombre: { equals: ESTACION_TRABAJO, mode: "insensitive" } } });
  if (!estacionTrabajo) {
    estacionTrabajo = await prisma.estacionTrabajo.create({ data: { nombre: ESTACION_TRABAJO, estado_id: listoTermo.id } });
  }
  for (const planilla of ["LIJADO", "ENCOLADO", "PVC"] as PlanillaEstacion[]) {
    await prisma.estacionTrabajoPlanilla.upsert({
      where: { estacion_trabajo_id_planilla: { estacion_trabajo_id: estacionTrabajo.id, planilla } },
      update: {},
      create: { estacion_trabajo_id: estacionTrabajo.id, planilla },
    });
  }
  const operarios = ["Fabián", "Carlos"];

  const dias = diasHabiles(DESDE, HASTA);
  const reales = await prisma.pedido.findMany({
    where: { estado: { not: "ELIMINADO" }, orden: { estado: { not: "ELIMINADO" } } },
    select: { id: true, codigo_pedido: true },
    take: 6,
  });
  const idPorCodigo = new Map(reales.map((p) => [p.codigo_pedido.toUpperCase(), p.id]));

  const pedidos: Pedido[] = [
    { codigo: "JN2-00118", piezas: 10, color: "BB", inicio: 0, llega: 3 },
    { codigo: "RO-01315", piezas: 24, color: "MAC", inicio: 0, llega: 3 },
    { codigo: "RO-01228", piezas: 18, color: "MAC", inicio: 1, llega: 3 },
    { codigo: "RO-01226", piezas: 16, color: "MAC", inicio: 1, llega: 3 },
    { codigo: "S1-01017_001", piezas: 14, color: "NM", inicio: 2, llega: 3, nota: "Cocina final" },
    { codigo: "VGS-00116_001", piezas: 22, color: "MAC", inicio: 3, llega: 3 },
    { codigo: "VLA3-00205_001", piezas: 12, color: "CAJUN", inicio: 4, llega: 3 },
    { codigo: "CR-03990_004", piezas: 9, color: "NM", inicio: 4, llega: 3 },
    { codigo: "TR-01316_001", piezas: 30, color: "HG", inicio: 5, llega: 3, nota: "1 pieza dañada en encolado" },
    { codigo: "CR-03913", piezas: 20, color: "GG", inicio: 6, llega: 3 },
    { codigo: "CR-03821_003", piezas: 15, color: "NS", inicio: 7, llega: 3 },
    { codigo: "MDQ-00630_001", piezas: 11, color: "BB", inicio: 7, llega: 2 },
    { codigo: "PE-00182_001", piezas: 8, color: "CAJUN", inicio: 8, llega: 2 },
    { codigo: "26-02689", piezas: 8, color: "NM", inicio: 8, llega: 1 },
    { codigo: "26-02694", piezas: 5, color: "GG", inicio: 9, llega: 1 },
    ...reales.slice(0, 3).map((p, i): Pedido => ({ codigo: p.codigo_pedido.toUpperCase(), piezas: entre(6, 20), color: elegir(COLORES), inicio: 3 + i * 2, llega: 3 })),
  ];

  // Una fila por pedido y estación, el día que le toca (Lijado: día d; Encolado: d o d+1; PVC: d+1 o d+2).
  interface Fila {
    estacion: PlanillaEstacion;
    dia: number;
    pedido: Pedido;
  }
  const filas: Fila[] = [];
  for (const p of pedidos) {
    const e = Math.min(dias.length - 1, p.inicio + entre(0, 1));
    const v = Math.min(dias.length - 1, e + entre(1, 2));
    filas.push({ estacion: "LIJADO", dia: p.inicio, pedido: p });
    if (p.llega >= 2) filas.push({ estacion: "ENCOLADO", dia: e, pedido: p });
    if (p.llega >= 3) filas.push({ estacion: "PVC", dia: Math.max(v, e), pedido: p });
  }

  // Se reemplaza lo sembrado antes en el rango.
  const borradas = await prisma.planillaProduccion.deleteMany({
    where: { area: AREA, fecha: { gte: new Date(`${DESDE}T00:00:00Z`), lte: new Date(`${HASTA}T00:00:00Z`) } },
  });
  console.log(`Planillas anteriores del rango borradas: ${borradas.count}`);

  const colores = [[200, 170, 130], [60, 60, 60], [230, 230, 230], [150, 100, 60], [120, 120, 130]];
  let planillas = 0;
  let registros = 0;
  let fotos = 0;
  const ultimoDia = dias.length - 1;

  for (const [d, fecha] of dias.entries()) {
    for (const estacion of ["LIJADO", "ENCOLADO", "PVC"] as PlanillaEstacion[]) {
      const delDia = filas.filter((f) => f.estacion === estacion && f.dia === d);
      if (delDia.length === 0) continue;
      const borrador = d === ultimoDia; // la última planilla de cada estación queda como borrador
      const cierre = new Date(`${fecha}T20:30:00Z`);
      const elegidos = rnd() < 0.5 ? operarios : [elegir(operarios)];
      const creada = await prisma.planillaProduccion.create({
        data: {
          area: AREA,
          estacion,
          estacion_trabajo_id: estacionTrabajo.id,
          fecha: new Date(`${fecha}T00:00:00Z`),
          estado: borrador ? "BORRADOR" : "GUARDADA",
          operarios: elegidos,
          operarios_planilla: { create: elegidos.map((nombre, orden) => ({ nombre, bloqueado: true, orden })) },
          creado_por: USUARIO,
          modificado_por: USUARIO,
          creado_en: new Date(`${fecha}T09:10:00Z`),
          actualizado_en: borrador ? new Date(`${fecha}T17:00:00Z`) : cierre,
          guardada_en: borrador ? null : cierre,
        },
      });
      planillas++;

      let reloj = estacion === "PVC" ? 7 * 60 + 40 : 6 * 60 + 10;
      // Lijado y Encolado: un pedido por fila. PVC: tandas de 1 a 3 pedidos (el primero pone el color).
      const grupos: Pedido[][] = [];
      if (estacion === "PVC") {
        for (let i = 0; i < delDia.length; ) {
          const n = Math.min(delDia.length - i, entre(1, 3));
          grupos.push(delDia.slice(i, i + n).map((x) => x.pedido));
          i += n;
        }
      } else {
        for (const x of delDia) grupos.push([x.pedido]);
      }
      for (const [orden, grupo] of grupos.entries()) {
        const p = grupo[0];
        const dur = entre(25, 110);
        const inicio = reloj;
        const fin = borrador && orden === delDia.length - 1 ? null : reloj + dur;
        reloj += dur + entre(5, 25);

        // Diferencia de piezas de ejemplo: un pedido pierde una pieza en Encolado.
        const piezas = estacion === "ENCOLADO" && p.nota?.includes("dañada") ? p.piezas - 1 : p.piezas;
        const fila = await prisma.planillaFila.create({
          data: {
            planilla_id: creada.id,
            orden,
            hora_inicio: hhmm(inicio),
            hora_fin: fin === null ? null : hhmm(fin),
            pedido_codigo: estacion === "PVC" ? "" : p.codigo,
            pedido_id: estacion === "PVC" ? null : (idPorCodigo.get(p.codigo) ?? null),
            cantidad_piezas: estacion === "PVC" ? grupo.reduce((t, x) => t + x.piezas, 0) : piezas,
            observaciones: p.nota && estacion !== "LIJADO" ? p.nota : elegir(OBSERVACIONES) || null,
            colocacion_pvc: estacion === "PVC" ? elegir(COLOCACION) : null,
            perfilado: estacion === "PVC" ? elegir(PERFILADO) || null : null,
            colores: estacion === "PVC" ? p.color : null,
            mesa_tamano: estacion === "PVC" ? elegir(["CHICA", "GRANDE"] as const) : null,
            mesa_cantidad: estacion === "PVC" ? entre(1, 4) : null,
            pedidos:
              estacion === "PVC"
                ? { create: grupo.map((x, j) => ({ orden: j, pedido_codigo: x.codigo, pedido_id: idPorCodigo.get(x.codigo) ?? null, cantidad_piezas: x.piezas })) }
                : undefined,
          },
        });
        registros++;
        if (estacion === "PVC") {
          for (let k = 0; k < elegir([0, 1, 1, 2]); k++) {
            const [r, g, b] = elegir(colores);
            const contenido = png(r, g, b);
            await prisma.planillaFoto.create({ data: { fila_id: fila.id, mime: "image/png", tamano: contenido.length, contenido } });
            fotos++;
          }
        }
      }
    }
  }

  // Una planilla guardada corregida después, con su versión previa.
  const corregida = await prisma.planillaProduccion.findFirst({
    where: { area: AREA, estacion: "LIJADO", estado: "GUARDADA" },
    orderBy: { fecha: "asc" },
    include: { filas: { orderBy: { orden: "asc" } } },
  });
  if (corregida && corregida.filas[0]) {
    const f = corregida.filas[0];
    await prisma.planillaVersion.create({
      data: {
        planilla_id: corregida.id,
        version: 1,
        datos: { estado: "GUARDADA", operarios: corregida.operarios, filas: corregida.filas.map((x) => ({ ...x, fotos: 0, cantidad_piezas: x.id === f.id ? (x.cantidad_piezas ?? 0) - 2 : x.cantidad_piezas })) } as unknown as Prisma.InputJsonValue,
        guardada_por: USUARIO,
        guardada_en: corregida.guardada_en ?? corregida.actualizado_en,
        reemplazada_por: USUARIO,
        reemplazada_en: new Date(corregida.actualizado_en.getTime() + 20 * 60_000),
      },
    });
    console.log("Planilla corregida de ejemplo:", corregida.estacion, corregida.fecha.toISOString().slice(0, 10));
  }

  await sembrarPlanificacion(listoTermo.id);

  console.log(`Sembrado: ${planillas} planillas, ${registros} registros, ${fotos} fotos (${DESDE} a ${HASTA}). Estación de trabajo: ${ESTACION_TRABAJO}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
