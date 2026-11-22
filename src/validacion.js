import { HttpError } from './http-error.js';

export const MAX_INT = 2147483647; // límite de INTEGER en PostgreSQL

/** Identificador de la URL (cadena) → número entero positivo o null si está mal formado. */
export function idDeRuta(texto) {
  if (typeof texto !== 'string' || !/^[1-9]\d{0,9}$/.test(texto)) return null;
  const n = Number(texto);
  return n <= MAX_INT ? n : null;
}

/** Identificador del cuerpo JSON (debe ser número entero positivo). */
export function idDeCuerpo(valor) {
  return Number.isInteger(valor) && valor >= 1 && valor <= MAX_INT ? valor : null;
}

export function exigirObjeto(cuerpo) {
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw new HttpError(400, 'El cuerpo debe ser un objeto JSON');
  }
  return cuerpo;
}

function textoObligatorio(valor, campo, max, errores) {
  if (typeof valor !== 'string') {
    errores.push(`${campo} es obligatorio y debe ser texto`);
    return null;
  }
  const limpio = valor.trim();
  if (limpio.length === 0) errores.push(`${campo} no puede estar vacío`);
  else if (limpio.length > max) errores.push(`${campo} no puede superar ${max} caracteres`);
  return limpio;
}

/** Valida { codigo, nombre, categoria }. Ignora cualquier otro campo (p. ej. disponible). */
export function validarEquipo(cuerpo) {
  exigirObjeto(cuerpo);
  const errores = [];
  const codigo = textoObligatorio(cuerpo.codigo, 'codigo', 20, errores);
  const nombre = textoObligatorio(cuerpo.nombre, 'nombre', 100, errores);
  const categoria = textoObligatorio(cuerpo.categoria, 'categoria', 50, errores);
  if (errores.length > 0) throw new HttpError(400, errores.join('; '));
  return { codigo, nombre, categoria };
}
