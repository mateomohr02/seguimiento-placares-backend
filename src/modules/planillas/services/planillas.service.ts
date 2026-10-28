import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { AppError } from "../../../utils/AppError";
import { PERMISOS } from "../../auth/permisos";
import { nombreCompleto, type UsuarioAutenticado } from "../../auth/auth.middleware";
import {
  AREA_TERMOLAMINADO,
  ESTACIONES,
  fechaISO,
  parseFecha,
  type Estacion,
  type FilaInput,
  type PlanillaBody,
} from "../schemas/planilla.schema";
import { esMiembro, exigirAcceso, exigirVisible, puedeConfigurar, tiposVisibles, whereVisible } from "./acceso-planillas";

// Planillas de producción de Termolaminado (diseño.md §14 y §17): una por estación de trabajo, tipo y día.

const pedidoTandaSelect = { id: true, orden: true, pedido_codigo: true, pedido_id: true, cantidad_piezas: true } satisfies Prisma.PlanillaFilaPedidoSelect;

const filaSelect = {
  id: true,
  orden: true,
  hora_inicio: true,
  hora_fin: true,
  pedido_codigo: true,
  pedido_id: true,
  cantidad_piezas: true,
  observaciones: true,
  colocacion_pvc: true,
  perfilado: true,
  colores: true,
  mesa_tamano: true,
  mesa_cantidad: true,
  // Solo PVC (tandas): los pedidos con las piezas de cada uno. En Lijado y Encolado queda vacío.
  pedidos: { select: pedidoTandaSelect, orderBy: { orden: "asc" } },
  fotos: {
    where: { eliminado_en: null },
    select: { id: true, mime: true, tamano: true, creado_en: true },
    orderBy: { creado_en: "asc" },
  },
} satisfies Prisma.PlanillaFilaSelect;

type FilaDB = Prisma.PlanillaFilaGetPayload<{ select: typeof filaSelect }>;

function filaDTO(f: FilaDB) {
  return { ...f, fotos: f.fotos.map((x) => ({ ...x, creado_en: x.creado_en.toISOString() })) };
}

const detalleInclude = {
  estacion_trabajo: { select: { id: true, nombre: true, activa: true } },
  operarios_planilla: { select: { usuario_id: true, nombre: true, bloqueado: true, orden: true }, orderBy: { orden: "asc" } },
  filas: { where: { eliminado_en: null }, select: filaSelect, orderBy: { orden: "asc" } },
  versiones: {
    select: { id: true, version: true, guardada_por: true, guardada_en: true, reemplazada_por: true, reemplazada_en: true },
    orderBy: { version: "desc" },
  },
} satisfies Prisma.PlanillaProduccionInclude;

type PlanillaDB = Prisma.PlanillaProduccionGetPayload<{ include: typeof detalleInclude }>;

// ───────────────────────── Operarios de la planilla ─────────────────────────

interface OperarioFila {
  usuario_id: string | null;
  nombre: string;
  bloqueado: boolean;
}

interface Ubicacion {
  estacion_trabajo_id: string;
  estacion: Estacion;
}

/** Personas activas que son miembros de la estación (las que salen como opciones al completar la planilla). */
async function miembrosActivos(estacionTrabajoId: string) {
  const m = await prisma.usuarioEstacionTrabajo.findMany({
    where: { estacion_trabajo_id: estacionTrabajoId, usuario: { activo: true } },
    select: { usuario: { select: { id: true, nombre: true, apellido: true } } },
  });
  return m.map(({ usuario: x }) => ({ usuario_id: x.id, nombre: nombreCompleto(x) }));
}

/**
 * Preselección de una planilla NUEVA: los operarios de la última planilla del mismo tipo (guardada o borrador) de esa
 * estación en la que figuró el usuario de la sesión. Se descartan los dados de baja y los que ya no están en la estación.
 */
async function preseleccion(u: UsuarioAutenticado, ub: Ubicacion): Promise<OperarioFila[]> {
  const ultima = await prisma.planillaProduccion.findFirst({
    where: { estacion_trabajo_id: ub.estacion_trabajo_id, estacion: ub.estacion, operarios_planilla: { some: { usuario_id: u.id } } },
    orderBy: [{ fecha: "desc" }, { actualizado_en: "desc" }],
    select: { operarios_planilla: { where: { usuario_id: { not: null } }, orderBy: { orden: "asc" }, select: { usuario_id: true } } },
  });
  if (!ultima) return [];
  const activos = new Map((await miembrosActivos(ub.estacion_trabajo_id)).map((m) => [m.usuario_id, m.nombre]));
  return ultima.operarios_planilla.flatMap((o) => {
    const nombre = o.usuario_id ? activos.get(o.usuario_id) : undefined;
    return o.usuario_id && nombre ? [{ usuario_id: o.usuario_id, nombre, bloqueado: false }] : [];
  });
}

/**
 * Los operarios tal como los ve (y los puede cambiar) el usuario de la sesión. Si es miembro de la estación y puede
 * completar planillas, aparece incluido y bloqueado (quien entra a una planilla se suma solo); los demás conservan el
 * bloqueo guardado. Las opciones son las personas activas de la estación más las que ya están en la planilla.
 * `estado` null = planilla que todavía no existe. `soloLectura` (ver una planilla guardada por id, no abrirla para
 * completarla) NO suma ni bloquea al usuario: muestra exactamente lo guardado, para no falsear el historial.
 */
async function vistaOperarios(u: UsuarioAutenticado, ub: Ubicacion, estado: string | null, guardados: OperarioFila[], soloLectura = false) {
  const puedeCambiar = puedeConfigurar(u);
  const operarios = guardados.map((o) => ({ ...o }));
  // Corrigiendo una GUARDADA, técnica/admin ven exactamente lo guardado (pueden cambiar todo, incluso quitarse).
  const sumarme = !soloLectura && esMiembro(u, ub) && u.permisos.includes(PERMISOS.PLANILLAS_COMPLETAR) && !(estado === "GUARDADA" && puedeCambiar);
  if (sumarme) {
    const yo = operarios.find((o) => o.usuario_id === u.id);
    if (yo) yo.bloqueado = true;
    else operarios.push({ usuario_id: u.id, nombre: u.nombre_completo, bloqueado: true });
  }
  const disponibles = new Map<string, string>();
  for (const m of await miembrosActivos(ub.estacion_trabajo_id)) disponibles.set(m.usuario_id, m.nombre);
  for (const o of operarios) if (o.usuario_id && !disponibles.has(o.usuario_id)) disponibles.set(o.usuario_id, o.nombre);
  return {
    operarios,
    operarios_disponibles: [...disponibles.entries()].map(([usuario_id, nombre]) => ({ usuario_id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    puede_cambiar_bloqueados: puedeCambiar,
  };
}

async function planillaDTO(p: PlanillaDB, u: UsuarioAutenticado, soloLectura = false) {
  const guardados = p.operarios_planilla.map((o) => ({ usuario_id: o.usuario_id, nombre: o.nombre, bloqueado: o.bloqueado }));
  const vista = await vistaOperarios(u, { estacion_trabajo_id: p.estacion_trabajo_id, estacion: p.estacion }, p.estado, guardados, soloLectura);
  return {
    id: p.id as string | null,
    estacion: p.estacion,
    estacion_trabajo: { id: p.estacion_trabajo.id, nombre: p.estacion_trabajo.nombre },
    fecha: fechaISO(p.fecha),
    estado: p.estado,
    ...vista,
    creado_por: p.creado_por as string | null,
    modificado_por: p.modificado_por as string | null,
    creado_en: p.creado_en.toISOString() as string | null,
    actualizado_en: p.actualizado_en.toISOString() as string | null,
    guardada_en: p.guardada_en?.toISOString() ?? null,
    filas: p.filas.map(filaDTO),
    versiones: p.versiones.map((v) => ({
      id: v.id,
      version: v.version,
      guardada_por: v.guardada_por,
      guardada_en: v.guardada_en.toISOString(),
      reemplazada_por: v.reemplazada_por,
      reemplazada_en: v.reemplazada_en.toISOString(),
    })),
  };
}

async function cargarDetalle(where: Prisma.PlanillaProduccionWhereUniqueInput) {
  return prisma.planillaProduccion.findUnique({ where, include: detalleInclude });
}

async function cargarEstacion(id: string) {
  const e = await prisma.estacionTrabajo.findUnique({ where: { id }, select: { id: true, nombre: true, activa: true, planillas: { select: { planilla: true } } } });
  if (!e) throw new AppError("Estación de trabajo no encontrada.", 404);
  return e;
}

function exigirTipo(e: { nombre: string; planillas: { planilla: string }[] }, estacion: Estacion) {
  if (!e.planillas.some((p) => p.planilla === estacion)) throw new AppError(`La estación de trabajo ${e.nombre} no tiene la planilla ${estacion}.`, 400);
}

/**
 * La planilla de una estación de trabajo, tipo y día. Si todavía no existe devuelve la planilla «virtual» (id null,
 * BORRADOR, sin filas) con la preselección de operarios.
 */
export async function getPlanillaDelDia(u: UsuarioAutenticado, estacionTrabajoId: string, estacion: Estacion, fechaStr: string) {
  const fecha = parseFecha(fechaStr);
  const et = await cargarEstacion(estacionTrabajoId);
  const ub = { estacion_trabajo_id: et.id, estacion };
  exigirAcceso(u, ub);
  const p = await cargarDetalle({ estacion_trabajo_id_estacion_fecha: { estacion_trabajo_id: et.id, estacion, fecha } });
  if (p) return planillaDTO(p, u);
  exigirTipo(et, estacion);
  const vista = await vistaOperarios(u, ub, null, await preseleccion(u, ub));
  return {
    id: null as string | null,
    estacion,
    estacion_trabajo: { id: et.id, nombre: et.nombre },
    fecha: fechaISO(fecha),
    estado: "BORRADOR" as const,
    ...vista,
    creado_por: null as string | null,
    modificado_por: null as string | null,
    creado_en: null as string | null,
    actualizado_en: null as string | null,
    guardada_en: null as string | null,
    filas: [] as ReturnType<typeof filaDTO>[],
    versiones: [] as Awaited<ReturnType<typeof planillaDTO>>["versiones"],
  };
}

async function cargarPorId(id: string) {
  const p = await cargarDetalle({ id });
  if (!p) throw new AppError("Planilla no encontrada.", 404);
  return p;
}

/** Una planilla por id; 403 si el usuario no puede ver las de esa estación y tipo. */
export async function getPlanilla(u: UsuarioAutenticado, id: string) {
  const p = await cargarPorId(id);
  exigirVisible(u, { estacion_trabajo_id: p.estacion_trabajo_id, estacion: p.estacion });
  return planillaDTO(p, u, true);
}

export async function getVersion(u: UsuarioAutenticado, id: string) {
  const v = await prisma.planillaVersion.findUnique({
    where: { id },
    include: { planilla: { select: { estacion: true, estacion_trabajo_id: true, estacion_trabajo: { select: { id: true, nombre: true } } } } },
  });
  if (!v) throw new AppError("Versión no encontrada.", 404);
  exigirVisible(u, v.planilla);
  return {
    id: v.id,
    planilla_id: v.planilla_id,
    estacion: v.planilla.estacion,
    estacion_trabajo: v.planilla.estacion_trabajo,
    version: v.version,
    guardada_por: v.guardada_por,
    guardada_en: v.guardada_en.toISOString(),
    reemplazada_por: v.reemplazada_por,
    reemplazada_en: v.reemplazada_en.toISOString(),
    datos: v.datos,
  };
}

// PVC: una fila es una tanda (mesas + pedidos). Lijado y Encolado: un pedido.
const filaVacia = (estacion: Estacion, f: FilaInput) =>
  !f.hora_inicio && !f.hora_fin && !f.observaciones &&
  (estacion === "PVC"
    ? !f.colocacion_pvc && !f.perfilado && !f.colores && !f.mesa_tamano && f.mesa_cantidad === null && f.pedidos.length === 0
    : !f.pedido_codigo && f.cantidad_piezas === null && !f.colocacion_pvc && !f.perfilado && !f.colores);

/** Descarta en silencio los pedidos de tanda totalmente vacíos (sin código y sin piezas); en Lijado/Encolado no hay pedidos. */
function limpiarFilas(estacion: Estacion, filas: FilaInput[]): FilaInput[] {
  return filas.map((f) => ({
    ...f,
    pedidos: estacion === "PVC" ? f.pedidos.filter((p) => p.pedido_codigo || (p.cantidad_piezas ?? 0) > 0) : [],
  }));
}

const aMinutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

// Reglas al cerrar la planilla (BORRADOR acepta filas incompletas).
function validarGuardada(estacion: Estacion, filas: FilaInput[]) {
  const pvc = estacion === "PVC";
  if (filas.length === 0) throw new AppError(pvc ? "La planilla no tiene tandas: cargá al menos una." : "La planilla no tiene filas: cargá al menos un pedido.", 400);
  filas.forEach((f, i) => {
    const n = `Fila ${i + 1}: `;
    if (filaVacia(estacion, f)) throw new AppError(`${n}está vacía; completala o quitala.`, 400);
    if (!pvc && !f.pedido_codigo) throw new AppError(`${n}falta el N° de pedido.`, 400);
    if (!f.hora_inicio) throw new AppError(`${n}falta la hora de inicio.`, 400);
    if (!pvc) {
      if (f.cantidad_piezas === null) throw new AppError(`${n}falta la cantidad de piezas.`, 400);
      return;
    }
    if (!f.mesa_tamano) throw new AppError(`${n}falta el tamaño de las mesas (chica o grande).`, 400);
    if (f.mesa_cantidad === null || f.mesa_cantidad < 1) throw new AppError(`${n}la cantidad de mesas tiene que ser al menos 1.`, 400);
    if (f.pedidos.length === 0) throw new AppError(`${n}cargá al menos un pedido con sus piezas.`, 400);
    const vistos = new Set<string>();
    f.pedidos.forEach((p, j) => {
      if (!p.pedido_codigo) throw new AppError(`${n}al pedido ${j + 1} le falta el N° de pedido.`, 400);
      if (p.cantidad_piezas === null || p.cantidad_piezas < 1) {
        throw new AppError(`${n}el pedido ${p.pedido_codigo} tiene que llevar al menos 1 pieza.`, 400);
      }
      if (vistos.has(p.pedido_codigo)) {
        throw new AppError(`${n}el pedido ${p.pedido_codigo} está repetido en la tanda; cargalo una sola vez con el total de piezas.`, 400);
      }
      vistos.add(p.pedido_codigo);
    });
  });
}

function validarHoras(filas: FilaInput[]) {
  filas.forEach((f, i) => {
    if (f.hora_inicio && f.hora_fin && aMinutos(f.hora_fin) < aMinutos(f.hora_inicio)) {
      throw new AppError(`Fila ${i + 1}: la hora de fin es anterior a la de inicio.`, 400);
    }
  });
}

// Deja en cada fila solo los campos de su estación. En PVC la fila es una tanda: pedido_codigo '' y cantidad_piezas = suma
// de las piezas de sus pedidos (mesa_chica / mesa_grande quedaron sin uso).
function normalizarFila(estacion: Estacion, f: FilaInput) {
  const pvc = estacion === "PVC";
  const piezasPvc = f.pedidos.length === 0 ? null : f.pedidos.reduce((s, p) => s + (p.cantidad_piezas ?? 0), 0);
  return {
    hora_inicio: f.hora_inicio,
    hora_fin: f.hora_fin,
    pedido_codigo: pvc ? "" : f.pedido_codigo,
    cantidad_piezas: pvc ? piezasPvc : f.cantidad_piezas,
    observaciones: f.observaciones,
    colocacion_pvc: pvc ? f.colocacion_pvc : null,
    perfilado: pvc ? f.perfilado : null,
    colores: pvc ? f.colores : null,
    mesa_tamano: pvc ? f.mesa_tamano : null,
    mesa_cantidad: pvc ? f.mesa_cantidad : null,
  };
}

// Pedidos sincronizados a los que coincide exactamente el código cargado (mayúsculas).
async function pedidosPorCodigo(codigos: string[]) {
  const unicos = [...new Set(codigos.filter(Boolean))];
  if (unicos.length === 0) return new Map<string, string>();
  const pedidos = await prisma.pedido.findMany({
    where: { codigo_pedido: { in: unicos, mode: "insensitive" }, estado: { not: "ELIMINADO" }, orden: { estado: { not: "ELIMINADO" } } },
    select: { id: true, codigo_pedido: true },
    orderBy: { creado_en: "desc" },
  });
  const m = new Map<string, string>();
  for (const p of pedidos) if (!m.has(p.codigo_pedido.toUpperCase())) m.set(p.codigo_pedido.toUpperCase(), p.id);
  return m;
}

/**
 * Operarios que quedan en la planilla al guardarla. `body.operarios` son `usuario_id`. Reglas:
 * - los nuevos tienen que ser miembros activos de la estación (los que ya estaban pueden seguir aunque ya no lo sean);
 * - el usuario de la sesión, si es miembro, se suma solo y queda bloqueado;
 * - los bloqueados no se pueden quitar (se conservan aunque falten en el pedido), salvo con `planillas.configurar`;
 * - los nombres históricos (sin usuario) son historia: siempre se conservan.
 */
async function resolverOperarios(
  tx: Prisma.TransactionClient,
  u: UsuarioAutenticado,
  ub: Ubicacion,
  estadoPrevio: "BORRADOR" | "GUARDADA" | null,
  previos: { usuario_id: string | null; nombre: string; bloqueado: boolean }[],
  pedidos: string[],
): Promise<OperarioFila[]> {
  const puedeCambiar = puedeConfigurar(u);
  const ids = [...new Set(pedidos)];
  const previosPorId = new Map(previos.filter((p) => p.usuario_id).map((p) => [p.usuario_id as string, p]));

  const nuevosIds = ids.filter((id) => !previosPorId.has(id));
  const personas = nuevosIds.length
    ? await tx.usuario.findMany({
        where: { id: { in: nuevosIds } },
        select: { id: true, nombre: true, apellido: true, activo: true, estaciones: { where: { estacion_trabajo_id: ub.estacion_trabajo_id }, select: { usuario_id: true } } },
      })
    : [];
  const nuevos: OperarioFila[] = nuevosIds.map((id) => {
    const p = personas.find((x) => x.id === id);
    if (!p) throw new AppError("Un operario elegido no existe.", 400);
    if (!p.activo || p.estaciones.length === 0) {
      throw new AppError(`${nombreCompleto(p)} no es un miembro activo de esta estación de trabajo.`, 400);
    }
    return { usuario_id: id, nombre: nombreCompleto(p), bloqueado: false };
  });

  const resultado: OperarioFila[] = [
    ...previos.filter((p) => !p.usuario_id),
    ...previos.filter((p) => p.usuario_id && (ids.includes(p.usuario_id) || (p.bloqueado && !puedeCambiar))),
    ...nuevos,
  ].map((o) => ({ usuario_id: o.usuario_id, nombre: o.nombre, bloqueado: o.bloqueado }));

  if (esMiembro(u, ub) && !(estadoPrevio === "GUARDADA" && puedeCambiar)) {
    const yo = resultado.find((o) => o.usuario_id === u.id);
    if (yo) yo.bloqueado = true;
    else resultado.push({ usuario_id: u.id, nombre: u.nombre_completo, bloqueado: true });
  }
  if (resultado.length > 40) throw new AppError("Demasiados operarios en la planilla (máximo 40).", 400);
  return resultado;
}

/**
 * Crea o actualiza la planilla de una estación de trabajo, tipo y día con el estado completo que manda
 * el formulario (se usa tanto para el guardado automático del borrador como para cerrarla
 * o corregirla). Corregir una planilla GUARDADA guarda antes la versión previa.
 */
export async function guardarPlanilla(u: UsuarioAutenticado, estacionTrabajoId: string, estacion: Estacion, fechaStr: string, body: PlanillaBody) {
  const fecha = parseFecha(fechaStr);
  const et = await cargarEstacion(estacionTrabajoId);
  const ub: Ubicacion = { estacion_trabajo_id: et.id, estacion };
  exigirAcceso(u, ub);
  exigirTipo(et, estacion);
  const filas = limpiarFilas(estacion, body.filas);
  validarHoras(filas);
  if (body.estado === "GUARDADA") validarGuardada(estacion, filas);

  const usuario = u.nombre_completo;
  const pedidos = await pedidosPorCodigo(estacion === "PVC" ? filas.flatMap((f) => f.pedidos.map((p) => p.pedido_codigo)) : filas.map((f) => f.pedido_codigo));

  let creando = false;
  const id = await prisma
    .$transaction(async (tx) => {
      const where = { estacion_trabajo_id: et.id, estacion, fecha };
      // Dos PUT simultáneos sobre la misma planilla se serializan: se bloquea la fila hasta terminar la transacción.
      const previa = await tx.planillaProduccion.findUnique({ where: { estacion_trabajo_id_estacion_fecha: where }, select: { id: true } });
      if (previa) await tx.$queryRaw`SELECT "id" FROM "planilla_produccion" WHERE "id" = ${previa.id}::uuid FOR UPDATE`;
      else creando = true;
      let existente = await tx.planillaProduccion.findUnique({
        where: { estacion_trabajo_id_estacion_fecha: where },
        include: { filas: { where: { eliminado_en: null }, select: filaSelect, orderBy: { orden: "asc" } }, operarios_planilla: { orderBy: { orden: "asc" } } },
      });

      if (existente?.estado === "GUARDADA" && body.estado === "BORRADOR") {
        throw new AppError("La planilla ya está guardada: guardá los cambios para corregirla.", 409);
      }
      if (!existente && !et.activa) throw new AppError(`La estación de trabajo ${et.nombre} está inactiva: no se pueden crear planillas nuevas.`, 409);

      const operarios = await resolverOperarios(tx, u, ub, existente?.estado ?? null, existente?.operarios_planilla ?? [], body.operarios);
      if (body.estado === "GUARDADA" && operarios.length === 0) throw new AppError("Para cerrar la planilla tiene que figurar al menos un operario.", 400);
      const nombres = operarios.map((o) => o.nombre);

      if (!existente) {
        const creada = await tx.planillaProduccion.create({
          data: { ...where, area: AREA_TERMOLAMINADO, estado: "BORRADOR", operarios: [], creado_por: usuario, modificado_por: usuario },
        });
        existente = { ...creada, filas: [], operarios_planilla: [] };
      } else if (existente.estado === "GUARDADA") {
        // Versión previa antes de aplicar la corrección.
        const version = (await tx.planillaVersion.count({ where: { planilla_id: existente.id } })) + 1;
        await tx.planillaVersion.create({
          data: {
            planilla_id: existente.id,
            version,
            datos: {
              estado: existente.estado,
              operarios: existente.operarios,
              // Las fotos quedan en la base aunque se quite el ítem (borrado lógico): se guardan sus datos para verlas en el historial.
              filas: existente.filas.map((f) => ({ ...f, fotos: f.fotos.length, fotos_lista: f.fotos })),
            } as unknown as Prisma.InputJsonValue,
            guardada_por: existente.modificado_por,
            guardada_en: existente.actualizado_en,
            reemplazada_por: usuario,
          },
        });
      }

      const planillaId = existente.id;
      await tx.planillaOperario.deleteMany({ where: { planilla_id: planillaId } });
      await tx.planillaOperario.createMany({ data: operarios.map((o, orden) => ({ planilla_id: planillaId, usuario_id: o.usuario_id, nombre: o.nombre, bloqueado: o.bloqueado, orden })) });

      const idsExistentes = new Set(existente.filas.map((f) => f.id));
      const idsEnviados = filas.map((f) => f.id).filter((x): x is string => !!x);
      if (idsEnviados.some((x) => !idsExistentes.has(x))) throw new AppError("Una fila no pertenece a esta planilla.", 400);

      // Los ítems que ya no vienen se quitan con borrado lógico: conservan sus datos y sus fotos.
      await tx.planillaFila.updateMany({ where: { planilla_id: planillaId, eliminado_en: null, id: { notIn: idsEnviados } }, data: { eliminado_en: new Date() } });

      // Ids de pedidos-de-tanda que ya pertenecen a cada fila: solo esos se conservan; cualquier otro id se ignora.
      const pedidosPrevios = new Map(existente.filas.map((x) => [x.id, new Set(x.pedidos.map((p) => p.id))]));
      for (const [orden, f] of filas.entries()) {
        const datos = { ...normalizarFila(estacion, f), orden, pedido_id: estacion === "PVC" ? null : (pedidos.get(f.pedido_codigo) ?? null) };
        const filaId = f.id
          ? (await tx.planillaFila.update({ where: { id: f.id }, data: datos, select: { id: true } })).id
          : (await tx.planillaFila.create({ data: { ...datos, planilla_id: planillaId }, select: { id: true } })).id;
        if (estacion !== "PVC") continue;
        // Los pedidos de la tanda se reemplazan completos, dentro de la misma transacción.
        await tx.planillaFilaPedido.deleteMany({ where: { fila_id: filaId } });
        const propios = pedidosPrevios.get(filaId) ?? new Set<string>();
        const usados = new Set<string>();
        await tx.planillaFilaPedido.createMany({
          data: f.pedidos.map((p, j) => {
            const conservar = !!p.id && propios.has(p.id) && !usados.has(p.id);
            if (conservar) usados.add(p.id as string);
            return {
              ...(conservar ? { id: p.id } : {}),
              fila_id: filaId,
              orden: j,
              pedido_codigo: p.pedido_codigo,
              pedido_id: pedidos.get(p.pedido_codigo) ?? null,
              cantidad_piezas: p.cantidad_piezas ?? 0,
            };
          }),
        });
      }

      await tx.planillaProduccion.update({
        where: { id: planillaId },
        data: {
          estado: body.estado,
          // Copia «Nombre Apellido» de los operarios para registros e indicadores.
          operarios: nombres,
          modificado_por: usuario,
          actualizado_en: new Date(),
          ...(body.estado === "GUARDADA" && !existente.guardada_en ? { guardada_en: new Date() } : {}),
        },
      });
      return planillaId;
    })
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new AppError(
          creando
            ? "Esa planilla se estaba creando al mismo tiempo desde otro dispositivo: volvé a abrirla."
            : "Esa planilla se estaba editando al mismo tiempo desde otro dispositivo: volvé a abrirla y reintentá.",
          409,
        );
      }
      throw e;
    });

  const p = await cargarPorId(id);
  return planillaDTO(p, u);
}

// ───────────────────────── Consultas (tabla, indicadores, trazabilidad) ─────────────────────────

const DIA_MS = 86_400_000;

function rango(desdeRaw?: string, hastaRaw?: string) {
  const hoy = new Date();
  const hasta = hastaRaw ? parseFecha(hastaRaw, "La fecha 'hasta'") : parseFecha(fechaISO(hoy));
  const desde = desdeRaw ? parseFecha(desdeRaw, "La fecha 'desde'") : new Date(hasta.getTime() - 29 * DIA_MS);
  if (desde > hasta) throw new AppError("La fecha 'desde' es posterior a 'hasta'.", 400);
  if ((hasta.getTime() - desde.getTime()) / DIA_MS > 400) throw new AppError("El rango no puede superar los 400 días.", 400);
  return { desde, hasta };
}

export interface FiltrosRegistros {
  desde?: string;
  hasta?: string;
  /** Tipo de planilla (LIJADO, ENCOLADO, PVC). */
  estacion?: Estacion;
  /** Estación de trabajo. */
  estacion_trabajo_id?: string;
  estado?: "BORRADOR" | "GUARDADA";
  pedido?: string;
}

export async function listarRegistros(u: UsuarioAutenticado, f: FiltrosRegistros) {
  const { desde, hasta } = rango(f.desde, f.hasta);
  const buscado = f.pedido?.trim().toUpperCase();
  const filas = await prisma.planillaFila.findMany({
    where: {
      eliminado_en: null,
      planilla: {
        AND: [whereVisible(u)],
        area: AREA_TERMOLAMINADO,
        fecha: { gte: desde, lte: hasta },
        ...(f.estacion ? { estacion: f.estacion } : {}),
        ...(f.estacion_trabajo_id ? { estacion_trabajo_id: f.estacion_trabajo_id } : {}),
        ...(f.estado ? { estado: f.estado } : {}),
      },
      // En PVC el pedido está en los pedidos de la tanda.
      ...(buscado ? { OR: [{ pedido_codigo: { contains: buscado } }, { pedidos: { some: { pedido_codigo: { contains: buscado } } } }] } : {}),
    },
    select: {
      id: true,
      orden: true,
      hora_inicio: true,
      hora_fin: true,
      pedido_codigo: true,
      pedido_id: true,
      cantidad_piezas: true,
      observaciones: true,
      colocacion_pvc: true,
      perfilado: true,
      colores: true,
      mesa_tamano: true,
      mesa_cantidad: true,
      pedidos: { select: pedidoTandaSelect, orderBy: { orden: "asc" } },
      _count: { select: { fotos: { where: { eliminado_en: null } } } },
      planilla: { select: { id: true, estacion: true, estacion_trabajo: { select: { id: true, nombre: true } }, fecha: true, estado: true, operarios: true, _count: { select: { versiones: true } } } },
    },
    orderBy: [{ planilla: { fecha: "desc" } }, { planilla: { estacion_trabajo: { nombre: "asc" } } }, { planilla: { estacion: "asc" } }, { orden: "asc" }],
    take: 3000,
  });
  return filas.flatMap(({ _count, planilla, pedidos, ...fila }) => {
    const comun = {
      fotos: _count.fotos,
      planilla_id: planilla.id,
      estacion: planilla.estacion,
      estacion_trabajo: planilla.estacion_trabajo,
      fecha: fechaISO(planilla.fecha),
      estado: planilla.estado,
      operarios: planilla.operarios,
      versiones: planilla._count.versiones,
    };
    if (planilla.estacion !== "PVC") {
      return [{ ...fila, ...comun, fila_id: fila.id, piezas_tanda: null as number | null }];
    }
    // PVC: una fila por (tanda, pedido). Una tanda de borrador sin pedidos sale igual, con una sola fila sin pedido.
    const elegidos = buscado ? pedidos.filter((p) => p.pedido_codigo.includes(buscado)) : pedidos;
    const base = { ...fila, ...comun, fila_id: fila.id, piezas_tanda: fila.cantidad_piezas };
    if (pedidos.length === 0) return [{ ...base, cantidad_piezas: null as number | null }];
    return elegidos.map((p) => ({ ...base, id: p.id, pedido_codigo: p.pedido_codigo, pedido_id: p.pedido_id, cantidad_piezas: p.cantidad_piezas as number | null }));
  });
}

const minutos = (ini: string | null, fin: string | null) => (ini && fin && aMinutos(fin) >= aMinutos(ini) ? aMinutos(fin) - aMinutos(ini) : 0);

interface FilaTraza {
  pedido_codigo: string;
  estacion: Estacion;
  estacion_trabajo: { id: string; nombre: string };
  fecha: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  /** Lijado/Encolado: las del registro. PVC: las piezas de ESE pedido en la tanda. */
  cantidad_piezas: number | null;
  /** Solo PVC: la tanda (el tiempo y las fotos son los de la tanda completa, no se prorratean). */
  mesa_tamano: "CHICA" | "GRANDE" | null;
  mesa_cantidad: number | null;
  fotos: number;
  estado: "BORRADOR" | "GUARDADA";
  observaciones: string | null;
  planilla_id: string;
}

const filaTrazaSelect = {
  hora_inicio: true,
  hora_fin: true,
  observaciones: true,
  mesa_tamano: true,
  mesa_cantidad: true,
  _count: { select: { fotos: { where: { eliminado_en: null } } } },
  planilla: { select: { id: true, estacion: true, estacion_trabajo: { select: { id: true, nombre: true } }, fecha: true, estado: true } },
} satisfies Prisma.PlanillaFilaSelect;

type FilaTrazaDB = Prisma.PlanillaFilaGetPayload<{ select: typeof filaTrazaSelect }>;

function aTraza(f: FilaTrazaDB, pedido_codigo: string, cantidad_piezas: number | null): FilaTraza {
  return {
    pedido_codigo,
    estacion: f.planilla.estacion,
    estacion_trabajo: f.planilla.estacion_trabajo,
    fecha: fechaISO(f.planilla.fecha),
    hora_inicio: f.hora_inicio,
    hora_fin: f.hora_fin,
    cantidad_piezas,
    mesa_tamano: f.mesa_tamano,
    mesa_cantidad: f.mesa_cantidad,
    fotos: f._count.fotos,
    estado: f.planilla.estado,
    observaciones: f.observaciones,
    planilla_id: f.planilla.id,
  };
}

/** Registros de los pedidos: Lijado/Encolado por fila; PVC por (tanda, pedido), con el tiempo y las fotos de la tanda completa. */
async function filasPorCodigos(codigos: string[], visible: Prisma.PlanillaProduccionWhereInput = {}): Promise<FilaTraza[]> {
  if (codigos.length === 0) return [];
  const planilla = { AND: [visible], area: AREA_TERMOLAMINADO };
  const [filas, enTandas] = await Promise.all([
    prisma.planillaFila.findMany({
      where: { eliminado_en: null, pedido_codigo: { in: codigos }, planilla },
      select: { ...filaTrazaSelect, pedido_codigo: true, cantidad_piezas: true },
    }),
    prisma.planillaFilaPedido.findMany({
      where: { pedido_codigo: { in: codigos }, fila: { eliminado_en: null, planilla } },
      select: { pedido_codigo: true, cantidad_piezas: true, orden: true, fila: { select: { id: true, ...filaTrazaSelect } } },
      orderBy: { orden: "asc" },
    }),
  ]);
  const out = filas.map((f) => aTraza(f, f.pedido_codigo, f.cantidad_piezas));
  // Un pedido repetido dentro de una misma tanda (solo posible en borrador) cuenta una vez, con las piezas sumadas.
  const porTanda = new Map<string, FilaTraza>();
  for (const p of enTandas) {
    const k = `${p.fila.id}|${p.pedido_codigo}`;
    const previo = porTanda.get(k);
    if (previo) previo.cantidad_piezas = (previo.cantidad_piezas ?? 0) + p.cantidad_piezas;
    else porTanda.set(k, aTraza(p.fila, p.pedido_codigo, p.cantidad_piezas));
  }
  out.push(...porTanda.values());
  // Por fecha y hora de inicio (las filas sin hora, al final).
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora_inicio ?? "99:99").localeCompare(b.hora_inicio ?? "99:99"));
}

function resumenPedido(codigo: string, filas: FilaTraza[], estaciones: readonly Estacion[] = ESTACIONES) {
  const porEstacion = Object.fromEntries(
    estaciones.map((e) => {
      const fs = filas.filter((f) => f.estacion === e);
      return [
        e,
        {
          registros: fs.length,
          piezas: fs.reduce((s, f) => s + (f.cantidad_piezas ?? 0), 0),
          // En PVC cada registro trae el minuto completo de su tanda (decisión de negocio: no se prorratea).
          minutos: fs.reduce((s, f) => s + minutos(f.hora_inicio, f.hora_fin), 0),
          primera: fs[0]?.fecha ?? null,
          ultima: fs.at(-1)?.fecha ?? null,
        },
      ];
    }),
  ) as Partial<Record<Estacion, { registros: number; piezas: number; minutos: number; primera: string | null; ultima: string | null }>>;
  const pasadas = estaciones.filter((e) => porEstacion[e]!.registros > 0);
  const piezas = pasadas.map((e) => porEstacion[e]!.piezas);
  return {
    pedido: codigo,
    estaciones: porEstacion,
    completo: pasadas.length === estaciones.length,
    // La estación siguiente a la última por la que pasó, si falta.
    siguiente: pasadas.length === estaciones.length ? null : (estaciones.find((e) => porEstacion[e]!.registros === 0) ?? null),
    diferencia: pasadas.length > 1 && new Set(piezas).size > 1,
  };
}

export async function trazabilidadDePedido(u: UsuarioAutenticado, codigo: string) {
  const estaciones = tiposVisibles(u);
  const c = codigo.trim().toUpperCase();
  if (!c) throw new AppError("Indicá el N° de pedido.", 400);
  const filas = await filasPorCodigos([c], whereVisible(u));
  const pedido = await prisma.pedido.findFirst({
    where: { codigo_pedido: { equals: c, mode: "insensitive" }, estado: { not: "ELIMINADO" } },
    select: { id: true, referencia: true },
  });
  return { ...resumenPedido(c, filas, estaciones), pedido_id: pedido?.id ?? null, referencia: pedido?.referencia ?? null, registros: filas };
}

export async function indicadores(desdeRaw?: string, hastaRaw?: string) {
  const { desde, hasta } = rango(desdeRaw, hastaRaw);
  const enRango = await prisma.planillaFila.findMany({
    where: { eliminado_en: null, planilla: { area: AREA_TERMOLAMINADO, fecha: { gte: desde, lte: hasta } } },
    select: {
      pedido_codigo: true,
      hora_inicio: true,
      hora_fin: true,
      cantidad_piezas: true,
      mesa_tamano: true,
      mesa_cantidad: true,
      pedidos: { select: { pedido_codigo: true, cantidad_piezas: true } },
      planilla: { select: { estacion: true, fecha: true } },
    },
  });

  // Piezas de una fila: en PVC, la suma de las de sus pedidos.
  const piezasDe = (f: (typeof enRango)[number]) => (f.planilla.estacion === "PVC" ? f.pedidos.reduce((s, p) => s + p.cantidad_piezas, 0) : (f.cantidad_piezas ?? 0));
  const codigosDe = (f: (typeof enRango)[number]) => (f.planilla.estacion === "PVC" ? f.pedidos.map((p) => p.pedido_codigo) : [f.pedido_codigo]).filter(Boolean);
  const mesasDe = (fs: typeof enRango, tamano: "CHICA" | "GRANDE") => fs.filter((f) => f.mesa_tamano === tamano).reduce((s, f) => s + (f.mesa_cantidad ?? 0), 0);

  const porEstacion = ESTACIONES.map((e) => {
    const fs = enRango.filter((f) => f.planilla.estacion === e);
    // El tiempo se suma una vez por fila (en PVC, una vez por tanda aunque tenga varios pedidos).
    const min = fs.reduce((s, f) => s + minutos(f.hora_inicio, f.hora_fin), 0);
    const piezas = fs.reduce((s, f) => s + piezasDe(f), 0);
    const pvc = e === "PVC";
    const chicas = pvc ? mesasDe(fs, "CHICA") : null;
    const grandes = pvc ? mesasDe(fs, "GRANDE") : null;
    return {
      estacion: e,
      dias: new Set(fs.map((f) => fechaISO(f.planilla.fecha))).size,
      registros: fs.length,
      pedidos: new Set(fs.flatMap(codigosDe)).size,
      piezas,
      minutos: min,
      piezasPorHora: min > 0 ? Math.round((piezas / (min / 60)) * 10) / 10 : null,
      mesas_chicas: chicas,
      mesas_grandes: grandes,
      mesas_por_hora: pvc ? (min > 0 ? Math.round((((chicas ?? 0) + (grandes ?? 0)) / (min / 60)) * 10) / 10 : null) : null,
    };
  });

  const dias = new Map<string, Record<Estacion, number>>();
  const mesas = new Map<string, { chicas: number; grandes: number }>();
  for (const f of enRango) {
    const d = fechaISO(f.planilla.fecha);
    const reg = dias.get(d) ?? { LIJADO: 0, ENCOLADO: 0, PVC: 0 };
    reg[f.planilla.estacion] += piezasDe(f);
    dias.set(d, reg);
    if (f.planilla.estacion === "PVC" && f.mesa_tamano && f.mesa_cantidad) {
      const m = mesas.get(d) ?? { chicas: 0, grandes: 0 };
      if (f.mesa_tamano === "CHICA") m.chicas += f.mesa_cantidad;
      else m.grandes += f.mesa_cantidad;
      mesas.set(d, m);
    }
  }
  const porDia = [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, piezas]) => ({ fecha, piezas }));
  const mesasPorDia = [...mesas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, m]) => ({ fecha, ...m }));

  // Trazabilidad de los pedidos que aparecen en el rango, con todo su historial.
  const codigos = [...new Set(enRango.flatMap(codigosDe))];
  const todas = await filasPorCodigos(codigos);
  const porPedido = new Map<string, FilaTraza[]>();
  for (const f of todas) porPedido.set(f.pedido_codigo, [...(porPedido.get(f.pedido_codigo) ?? []), f]);
  const pedidos = codigos.map((c) => resumenPedido(c, porPedido.get(c) ?? []));

  return {
    desde: fechaISO(desde),
    hasta: fechaISO(hasta),
    porEstacion,
    porDia,
    mesasPorDia,
    pedidos: {
      total: pedidos.length,
      completos: pedidos.filter((p) => p.completo).length,
      enProceso: pedidos.filter((p) => !p.completo).length,
      conDiferencia: pedidos.filter((p) => p.diferencia).length,
      detalle: pedidos.sort((a, b) => Number(a.completo) - Number(b.completo) || a.pedido.localeCompare(b.pedido)),
    },
  };
}

export async function sugerirPedidos(u: UsuarioAutenticado, q: string) {
  const t = q.trim().toUpperCase();
  if (t.length < 2) return [];
  const [sync, usados, usadosTanda] = await Promise.all([
    prisma.pedido.findMany({
      where: { codigo_pedido: { contains: t, mode: "insensitive" }, estado: { not: "ELIMINADO" }, orden: { estado: { not: "ELIMINADO" } } },
      select: { codigo_pedido: true, referencia: true },
      distinct: ["codigo_pedido"],
      take: 8,
    }),
    prisma.planillaFila.findMany({ where: { eliminado_en: null, pedido_codigo: { contains: t }, planilla: whereVisible(u) }, select: { pedido_codigo: true }, distinct: ["pedido_codigo"], take: 8 }),
    // PVC: los pedidos de las tandas.
    prisma.planillaFilaPedido.findMany({ where: { pedido_codigo: { contains: t }, fila: { eliminado_en: null, planilla: whereVisible(u) } }, select: { pedido_codigo: true }, distinct: ["pedido_codigo"], take: 8 }),
  ]);
  const out = new Map<string, { codigo: string; referencia: string | null }>();
  for (const p of sync) out.set(p.codigo_pedido.toUpperCase(), { codigo: p.codigo_pedido.toUpperCase(), referencia: p.referencia });
  for (const x of [...usados, ...usadosTanda]) if (!out.has(x.pedido_codigo)) out.set(x.pedido_codigo, { codigo: x.pedido_codigo, referencia: null });
  return [...out.values()].slice(0, 10);
}

// Códigos de color ya usados, del más al menos frecuente (autocompletado). En PVC el color es de la tanda.
export async function coloresUsados(u: UsuarioAutenticado) {
  const g = await prisma.planillaFila.groupBy({
    by: ["colores"],
    where: { eliminado_en: null, colores: { not: null }, planilla: whereVisible(u) },
    _count: { _all: true },
    orderBy: { _count: { colores: "desc" } },
    take: 200,
  });
  return g.map((x) => x.colores as string);
}
