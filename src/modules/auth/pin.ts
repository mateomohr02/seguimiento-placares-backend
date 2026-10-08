// El PIN se guarda en texto plano en `usuario.pin` (único) y se busca por igualdad:
// decisión del usuario, app interna (diseño.md §12). Numérico, 4 a 10 dígitos.
export const PIN_REGEX = /^\d{4,10}$/;
