import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { AREA_TERMOLAMINADO, ESTACIONES, type Estacion } from "../schemas/planilla.schema";

export const MAX_FOTO_BYTES = 8 * 1024 * 1024;
export const MAX_FOTOS_POR_FILA = 12;
export const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;

// Tipo real según la firma del archivo (no se confía en lo que declara el cliente).
export function mimePorFirma(b: Buffer): (typeof MIMES_FOTO)[number] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

// Fotos de la pieza antes de termolaminar: solo en filas de la planilla PVC.
export async function agregarFoto(filaId: string, contenido: Buffer, usuario: string) {
  if (contenido.length === 0) throw new AppError("La imagen está vacía.", 400);
  if (contenido.length > MAX_FOTO_BYTES) throw new AppError("La foto supera el tamaño máximo (8 MB).", 413);
  const mime = mimePorFirma(contenido);
  if (!mime) throw new AppError("El archivo no es una imagen válida (JPG, PNG o WEBP).", 415);

  const fila = await prisma.planillaFila.findUnique({
    where: { id: filaId },
    select: { planilla_id: true, planilla: { select: { estacion: true } }, _count: { select: { fotos: { where: { eliminado_en: null } } } } },
  });
  if (!fila) throw new AppError("Fila no encontrada.", 404);
  if (fila.planilla.estacion !== "PVC") throw new AppError("Solo las filas de PVC llevan fotos.", 400);
  if (fila._count.fotos >= MAX_FOTOS_POR_FILA) throw new AppError(`Una fila admite hasta ${MAX_FOTOS_POR_FILA} fotos.`, 400);

  const foto = await prisma.planillaFoto.create({
    data: { fila_id: filaId, mime, tamano: contenido.length, contenido },
    select: { id: true, mime: true, tamano: true, creado_en: true },
  });
  await prisma.planillaProduccion.update({ where: { id: fila.planilla_id }, data: { actualizado_en: new Date(), modificado_por: usuario } });
  return { ...foto, creado_en: foto.creado_en.toISOString() };
}

export async function getFoto(id: string) {
  const f = await prisma.planillaFoto.findUnique({ where: { id }, select: { contenido: true, mime: true, eliminado_en: true } });
  if (!f || f.eliminado_en) throw new AppError("Foto no encontrada.", 404);
  return { contenido: Buffer.from(f.contenido), mime: f.mime };
}

export async function eliminarFoto(id: string) {
  const f = await prisma.planillaFoto.findUnique({ where: { id }, select: { eliminado_en: true } });
  if (!f || f.eliminado_en) throw new AppError("Foto no encontrada.", 404);
  await prisma.planillaFoto.update({ where: { id }, data: { eliminado_en: new Date() } });
}

// ───────────────────────── Operarios del área (los configura técnica) ─────────────────────────

export async function listarOperarios() {
  const o = await prisma.areaOperario.findMany({ where: { area: AREA_TERMOLAMINADO }, orderBy: { orden: "asc" }, select: { nombre: true } });
  return { area: AREA_TERMOLAMINADO, operarios: o.map((x) => x.nombre) };
}

export async function guardarOperarios(nombres: string[]) {
  const limpios = nombres.map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean);
  const vistos = new Set<string>();
  for (const n of limpios) {
    const k = n.toLowerCase();
    if (vistos.has(k)) throw new AppError(`El operario "${n}" está repetido.`, 400);
    vistos.add(k);
  }
  if (limpios.length > 10) throw new AppError("Se admiten hasta 10 operarios.", 400);
  await prisma.$transaction([
    prisma.areaOperario.deleteMany({ where: { area: AREA_TERMOLAMINADO } }),
    prisma.areaOperario.createMany({ data: limpios.map((nombre, orden) => ({ area: AREA_TERMOLAMINADO, nombre, orden })) }),
  ]);
  return listarOperarios();
}

// ───────────────────────── Acceso a las planillas (lo asigna técnica) ─────────────────────────

export async function estacionDeFila(filaId: string) {
  const f = await prisma.planillaFila.findUnique({ where: { id: filaId }, select: { planilla: { select: { estacion: true } } } });
  if (!f) throw new AppError("Fila no encontrada.", 404);
  return f.planilla.estacion;
}

export async function estacionDeFoto(fotoId: string) {
  const f = await prisma.planillaFoto.findUnique({ where: { id: fotoId }, select: { fila: { select: { planilla: { select: { estacion: true } } } } } });
  if (!f) throw new AppError("Foto no encontrada.", 404);
  return f.fila.planilla.estacion;
}

export async function listarAccesos() {
  const usuarios = await prisma.usuario.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, rol: { select: { nombre: true } }, planillas: { select: { estacion: true } } },
  });
  return usuarios.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol.nombre, estaciones: ESTACIONES.filter((e) => u.planillas.some((p) => p.estacion === e)) }));
}

export async function guardarAccesos(usuarioId: string, estaciones: string[]) {
  const validas = [...new Set(estaciones)].filter((e): e is Estacion => (ESTACIONES as readonly string[]).includes(e));
  if (validas.length !== new Set(estaciones).size) throw new AppError("Estación inválida.", 400);
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { activo: true } });
  if (!u || !u.activo) throw new AppError("Usuario no encontrado.", 404);
  await prisma.$transaction([
    prisma.usuarioPlanilla.deleteMany({ where: { usuario_id: usuarioId } }),
    prisma.usuarioPlanilla.createMany({ data: validas.map((estacion) => ({ usuario_id: usuarioId, estacion })) }),
  ]);
}
