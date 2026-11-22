import { pool } from './db.js';
import {
  HttpError,
  PG_UNIQUE_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
} from './http-error.js';

/**
 * Préstamo atómico: un único cliente, una transacción.
 *  1. UPDATE condicional del equipo (solo si disponible = true)
 *  2. INSERT del préstamo (la FK garantiza que el usuario existe)
 *  3. COMMIT solo si ambas escrituras funcionan; ante cualquier fallo, ROLLBACK
 *
 * Con dos peticiones simultáneas, la segunda espera el bloqueo de fila del UPDATE;
 * al reevaluar el WHERE ve disponible = false, rowCount = 0 y responde 409.
 */
export async function crearPrestamo(equipoId, usuarioId) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const act = await cliente.query(
      'UPDATE equipos SET disponible = false WHERE id = $1 AND disponible = true',
      [equipoId],
    );
    if (act.rowCount === 0) {
      const existe = await cliente.query('SELECT 1 FROM equipos WHERE id = $1', [equipoId]);
      throw existe.rowCount === 0
        ? new HttpError(404, 'El equipo no existe')
        : new HttpError(409, 'El equipo no está disponible');
    }

    const ins = await cliente.query(
      `INSERT INTO prestamos (equipo_id, usuario_id)
       VALUES ($1, $2)
       RETURNING id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion`,
      [equipoId, usuarioId],
    );

    await cliente.query('COMMIT');
    return ins.rows[0];
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    if (err.code === PG_FOREIGN_KEY_VIOLATION) throw new HttpError(404, 'El usuario no existe');
    if (err.code === PG_UNIQUE_VIOLATION) throw new HttpError(409, 'El equipo ya tiene un préstamo activo');
    throw err;
  } finally {
    cliente.release();
  }
}

/**
 * Devolución atómica: UPDATE condicional del préstamo activo + equipo disponible = true.
 * Si el préstamo no existe o ya está devuelto no se modifica ningún equipo.
 */
export async function devolverPrestamo(prestamoId) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const dev = await cliente.query(
      `UPDATE prestamos
          SET fecha_devolucion = now()
        WHERE id = $1 AND fecha_devolucion IS NULL
        RETURNING id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion`,
      [prestamoId],
    );
    if (dev.rowCount === 0) {
      const existe = await cliente.query('SELECT 1 FROM prestamos WHERE id = $1', [prestamoId]);
      throw existe.rowCount === 0
        ? new HttpError(404, 'El préstamo no existe')
        : new HttpError(409, 'El préstamo ya fue devuelto');
    }

    await cliente.query('UPDATE equipos SET disponible = true WHERE id = $1', [dev.rows[0].equipo_id]);

    await cliente.query('COMMIT');
    return dev.rows[0];
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}
