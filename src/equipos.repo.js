import { pool } from './db.js';
import {
  HttpError,
  PG_UNIQUE_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_CHECK_VIOLATION,
  PG_RESTRICT_VIOLATION
} from './http-error.js';

export const TAMANO_PAGINA = 5;

// Lista blanca: el usuario elige una clave, nunca se concatena su valor en el SQL
const ORDENES = {
  codigo: 'e.codigo ASC, e.id ASC',
  nombre: 'e.nombre ASC, e.id ASC',
};
export const ORDENES_PERMITIDOS = Object.keys(ORDENES);

const COLUMNAS = 'id, codigo, nombre, categoria, disponible';

/** Listado con filtros combinados, orden y paginación. Todo valor va parametrizado. */
export async function listarEquipos({ q, categoria, disponibilidad, orden, pagina }) {
  const condiciones = [];
  const valores = [];

  if (q) {
    // Escapa los comodines de LIKE para que el texto se busque literalmente
    valores.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    condiciones.push(`e.nombre ILIKE $${valores.length}`);
  }
  if (categoria) {
    valores.push(categoria);
    condiciones.push(`e.categoria = $${valores.length}`);
  }
  if (disponibilidad === 'disponible' || disponibilidad === 'prestado') {
    valores.push(disponibilidad === 'disponible');
    condiciones.push(`e.disponible = $${valores.length}`);
  }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows: [{ total }] } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM equipos e ${where}`,
    valores,
  );

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const paginaActual = Math.min(Math.max(1, pagina), totalPaginas);
  const offset = (paginaActual - 1) * TAMANO_PAGINA;

  const { rows } = await pool.query(
    `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible
       FROM equipos e
       ${where}
      ORDER BY ${ORDENES[orden] ?? ORDENES.codigo}
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, TAMANO_PAGINA, offset],
  );

  return { equipos: rows, total, totalPaginas, pagina: paginaActual };
}

export async function listarCategorias() {
  const { rows } = await pool.query('SELECT DISTINCT categoria FROM equipos ORDER BY categoria');
  return rows.map((r) => r.categoria);
}

/** Equipo + usuario con préstamo activo (LEFT JOIN: conserva equipos sin préstamo activo). */
export async function obtenerEquipoConPrestamoActual(id) {
  const { rows } = await pool.query(
    `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible,
            p.id AS prestamo_id, p.fecha_prestamo, u.nombre AS usuario_actual
       FROM equipos e
       LEFT JOIN prestamos p ON p.equipo_id = e.id AND p.fecha_devolucion IS NULL
       LEFT JOIN usuarios  u ON u.id = p.usuario_id
      WHERE e.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Historial completo de préstamos del equipo (JOIN con usuarios). */
export async function historialPrestamos(equipoId) {
  const { rows } = await pool.query(
    `SELECT p.id, u.nombre AS usuario, p.fecha_prestamo, p.fecha_devolucion
       FROM prestamos p
       JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.equipo_id = $1
      ORDER BY p.fecha_prestamo DESC, p.id DESC`,
    [equipoId],
  );
  return rows;
}

function traducirError(err) {
  if (err.code === PG_UNIQUE_VIOLATION) return new HttpError(409, 'Ya existe un equipo con ese código');
  if (err.code === PG_CHECK_VIOLATION) return new HttpError(400, 'Los datos no cumplen las restricciones');
  return err;
}

export async function crearEquipo({ codigo, nombre, categoria }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO equipos (codigo, nombre, categoria)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNAS}`,
      [codigo, nombre, categoria],
    );
    return rows[0];
  } catch (err) {
    throw traducirError(err);
  }
}

/** No toca la columna disponible: solo cambia al prestar/devolver. */
export async function actualizarEquipo(id, { codigo, nombre, categoria }) {
  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE equipos
          SET codigo = $1, nombre = $2, categoria = $3
        WHERE id = $4
        RETURNING ${COLUMNAS}`,
      [codigo, nombre, categoria, id],
    );
    if (rowCount === 0) throw new HttpError(404, 'El equipo no existe');
    return rows[0];
  } catch (err) {
    throw traducirError(err);
  }
}

export async function borrarEquipo(id) {
  try {
    const { rowCount } = await pool.query('DELETE FROM equipos WHERE id = $1', [id]);
    if (rowCount === 0) throw new HttpError(404, 'El equipo no existe');
  } catch (err) {
    if (err.code === PG_RESTRICT_VIOLATION || err.code === PG_FOREIGN_KEY_VIOLATION) {
      throw new HttpError(409, 'No se puede borrar un equipo con préstamos registrados');
    }
    throw err;
  }
}
