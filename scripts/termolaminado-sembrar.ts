// Siembra la base de PRUEBA con partes de producción de ejemplo de Termolaminado (Lijado → Encolado → PVC),
// con el estilo de las planillas de papel (diseño.md §14). Solo corre contra `Neostone_test`.
//   npm run termolaminado:sembrar
// Reemplaza todas las planillas (y sus fotos y versiones) de 2026-10-05 al 2026-10-16. Si la lista de
// operarios del área está vacía, la completa con Fabián y Carlos. Las fotos de PVC son imágenes de relleno.
import { Prisma, type PlanillaEstacion } from "@prisma/client";
import { deflateSync, crc32 } from "node:zlib";
import { prisma } from "../src/config/prisma";

const DESDE = "2026-10-05";
const HASTA = "2026-10-16";
const AREA = "TERMOLAMINADO";
const USUARIO = "termolaminado1";

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

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/Neostone_test(\?|$)/.test(url)) {
    console.error("Este script solo corre contra la base Neostone_test (DATABASE_URL no apunta a ella). No se hizo nada.");
    process.exit(1);
  }

  // Operarios del área.
  if ((await prisma.areaOperario.count({ where: { area: AREA } })) === 0) {
    await prisma.areaOperario.createMany({ data: ["Fabián", "Carlos"].map((nombre, orden) => ({ area: AREA, nombre, orden })) });
  }
  const operarios = (await prisma.areaOperario.findMany({ where: { area: AREA }, orderBy: { orden: "asc" } })).map((o) => o.nombre);

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
      const creada = await prisma.planillaProduccion.create({
        data: {
          area: AREA,
          estacion,
          fecha: new Date(`${fecha}T00:00:00Z`),
          estado: borrador ? "BORRADOR" : "GUARDADA",
          operarios: rnd() < 0.5 ? operarios : [elegir(operarios)],
          creado_por: USUARIO,
          modificado_por: USUARIO,
          creado_en: new Date(`${fecha}T09:10:00Z`),
          actualizado_en: borrador ? new Date(`${fecha}T17:00:00Z`) : cierre,
          guardada_en: borrador ? null : cierre,
        },
      });
      planillas++;

      let reloj = estacion === "PVC" ? 7 * 60 + 40 : 6 * 60 + 10;
      for (const [orden, f] of delDia.entries()) {
        const p = f.pedido;
        const dur = entre(25, 110);
        const inicio = reloj;
        const fin = borrador && orden === delDia.length - 1 ? null : reloj + dur;
        reloj += dur + entre(5, 25);

        // Diferencia de piezas de ejemplo: un pedido pierde una pieza en Encolado.
        const piezas = estacion === "ENCOLADO" && p.nota?.includes("dañada") ? p.piezas - 1 : p.piezas;
        const grandes = estacion === "PVC" ? Math.floor(piezas * rnd() * 0.6) : null;
        const fila = await prisma.planillaFila.create({
          data: {
            planilla_id: creada.id,
            orden,
            hora_inicio: hhmm(inicio),
            hora_fin: fin === null ? null : hhmm(fin),
            pedido_codigo: p.codigo,
            pedido_id: idPorCodigo.get(p.codigo) ?? null,
            cantidad_piezas: piezas,
            observaciones: p.nota && estacion !== "LIJADO" ? p.nota : elegir(OBSERVACIONES) || null,
            colocacion_pvc: estacion === "PVC" ? elegir(COLOCACION) : null,
            perfilado: estacion === "PVC" ? elegir(PERFILADO) || null : null,
            colores: estacion === "PVC" ? p.color : null,
            mesa_chica: estacion === "PVC" ? piezas - (grandes ?? 0) : null,
            mesa_grande: estacion === "PVC" ? grandes : null,
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

  console.log(`Sembrado: ${planillas} planillas, ${registros} registros, ${fotos} fotos (${DESDE} a ${HASTA}). Operarios del área: ${operarios.join(", ")}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
