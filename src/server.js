import path from 'node:path';
import express from 'express';
import { pool } from './db.js';
import { HttpError } from './http-error.js';
import { idDeRuta, idDeCuerpo, exigirObjeto, validarEquipo } from './validacion.js';
import {
  ORDENES_PERMITIDOS,
  listarEquipos,
  listarCategorias,
  obtenerEquipoConPrestamoActual,
  historialPrestamos,
  crearEquipo,
  actualizarEquipo,
  borrarEquipo,
} from './equipos.repo.js';
import { crearPrestamo, devolverPrestamo } from './prestamos.service.js';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(import.meta.dirname, 'views'));
app.use(express.json({ limit: '10kb' }));

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function idOrFail(valor) {
  const id = idDeRuta(valor);
  if (id === null) throw new HttpError(400, 'Identificador no válido');
  return id;
}

// ---------- Vistas HTML ----------
app.get('/', (req, res) => res.redirect('/equipos'));

app.get('/equipos', async (req, res) => {
  const q = texto(req.query.q, 100);
  const categoria = texto(req.query.categoria, 50);
  const disponibilidad = ['disponible', 'prestado'].includes(req.query.disponibilidad)
    ? req.query.disponibilidad
    : '';
  const orden = ORDENES_PERMITIDOS.includes(req.query.orden) ? req.query.orden : 'codigo';
  const pagina = /^\d{1,6}$/.test(req.query.pagina ?? '') ? Math.max(1, Number(req.query.pagina)) : 1;

  const [resultado, categorias] = await Promise.all([
    listarEquipos({ q, categoria, disponibilidad, orden, pagina }),
    listarCategorias(),
  ]);

  // Enlace a otra página conservando todos los filtros
  const enlace = (p) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (categoria) params.set('categoria', categoria);
    if (disponibilidad) params.set('disponibilidad', disponibilidad);
    params.set('orden', orden);
    params.set('pagina', String(p));
    return `/equipos?${params}`;
  };

  res.render('equipos', {
    ...resultado,
    categorias,
    filtros: { q, categoria, disponibilidad, orden },
    enlace,
  });
});

app.get('/equipos/:id', async (req, res) => {
  const id = idOrFail(req.params.id);
  const equipo = await obtenerEquipoConPrestamoActual(id);
  if (!equipo) throw new HttpError(404, 'El equipo no existe');
  const historial = await historialPrestamos(id);
  res.render('equipo', { equipo, historial });
});

// ---------- API: inventario ----------
app.post('/api/equipos', async (req, res) => {
  const datos = validarEquipo(req.body);
  const equipo = await crearEquipo(datos);
  res.status(201).location(`/api/equipos/${equipo.id}`).json(equipo);
});

app.put('/api/equipos/:id', async (req, res) => {
  const id = idOrFail(req.params.id);
  const datos = validarEquipo(req.body);
  res.status(200).json(await actualizarEquipo(id, datos));
});

app.delete('/api/equipos/:id', async (req, res) => {
  const id = idOrFail(req.params.id);
  await borrarEquipo(id);
  res.status(204).end();
});

// ---------- API: préstamos ----------
app.post('/api/prestamos', async (req, res) => {
  const cuerpo = exigirObjeto(req.body);
  const equipoId = idDeCuerpo(cuerpo.equipoId);
  const usuarioId = idDeCuerpo(cuerpo.usuarioId);
  if (equipoId === null || usuarioId === null) {
    throw new HttpError(400, 'equipoId y usuarioId deben ser enteros positivos');
  }
  const prestamo = await crearPrestamo(equipoId, usuarioId);
  res.status(201).json(prestamo);
});

app.post('/api/prestamos/:id/devolucion', async (req, res) => {
  const id = idOrFail(req.params.id);
  res.status(200).json(await devolverPrestamo(id));
});

// ---------- Errores ----------
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Express 5 envía aquí también los errores de funciones async
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Cuerpo demasiado grande' });
  console.error(err); // el detalle técnico solo se registra en el servidor
  res.status(500).json({ error: 'Error interno del servidor' });
});

const puerto = Number(process.env.PORT ?? 3000);
const servidor = app.listen(puerto, () => {
  console.log(`Servidor en http://localhost:${puerto}/equipos`);
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    servidor.close(() => pool.end().then(() => process.exit(0)));
  });
}
