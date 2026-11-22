# Práctica DWES · Gestión de préstamos de material informático

Aplicación con Node.js 24, Express 5, PostgreSQL 18 (Docker Compose), `pg` 8 y EJS 3.
Acceso a datos con SQL directo y consultas parametrizadas.

## Requisitos

- Node.js 24 o superior
- Docker y Docker Compose

## Instalación y arranque

```bash
# 1. Configuración (edita la contraseña en .env)
cp .env.example .env

# 2. Dependencias
npm install

# 3. Base de datos (Docker)
docker compose up -d

# 4. Servidor
npm start
```

Después abre <http://localhost:3000/equipos>.

### Inicialización de la base de datos

`init.sql` está montado en `/docker-entrypoint-initdb.d/`, así que PostgreSQL lo ejecuta
automáticamente **la primera vez** que arranca con el volumen vacío. Crea el esquema
`practica_prestamos`, las tablas, restricciones, el índice único parcial y los datos de ejemplo.
Para reiniciar desde cero:

```bash
docker compose down -v      # borra el volumen
docker compose up -d
```

## Estructura

```
compose.yaml            PostgreSQL 18 con volumen persistente
init.sql                esquema, restricciones y datos de ejemplo
.env.example            plantilla de configuración (sin credenciales reales)
src/server.js          arranque de Express, rutas y manejo de errores
src/db.js              pool de conexiones (pg)
src/equipos.repo.js    SQL de consultas y CRUD de equipos
src/prestamos.service.js   transacciones de préstamo y devolución
src/validacion.js      validación de identificadores y JSON
src/http-error.js      error HTTP controlado y códigos SQLSTATE
src/views/              equipos.ejs y equipo.ejs
scripts/pruebas.js     script con fetch que ejecuta los casos de la tabla de pruebas
```

## Rutas disponibles

| Método y ruta | Descripción | Respuestas |
|---|---|---|
| `GET /equipos` | Listado con `q`, `categoria`, `disponibilidad` (`disponible`/`prestado`), `orden` (`codigo`/`nombre`), `pagina` (5 por página) | 200 |
| `GET /equipos/:id` | Detalle, usuario actual e historial | 200, 400, 404 |
| `POST /api/equipos` | `{ codigo, nombre, categoria }` | 201 + `Location`, 400, 409 |
| `PUT /api/equipos/:id` | `{ codigo, nombre, categoria }` (no modifica `disponible`) | 200, 400, 404, 409 |
| `DELETE /api/equipos/:id` | Borra un equipo sin historial | 204, 400, 404, 409 |
| `POST /api/prestamos` | `{ equipoId, usuarioId }` | 201, 400, 404 (equipo/usuario inexistente), 409 (ocupado) |
| `POST /api/prestamos/:id/devolucion` | Devuelve el préstamo | 200, 400, 404, 409 (ya devuelto) |

Cualquier error inesperado devuelve 500 con un mensaje genérico (el detalle solo se escribe en la consola del servidor).

## Decisiones de diseño

- **Ordenación**: el parámetro `orden` solo se usa como clave de una lista blanca (`codigo`, `nombre`); nunca se concatena en el SQL.
- **ILIKE**: los comodines `%`, `_` y `\` escritos por el usuario se escapan para buscarse literalmente.
- **Préstamo**: un único cliente del pool con `BEGIN` → `UPDATE equipos ... WHERE id=$1 AND disponible=true` → `INSERT prestamos` → `COMMIT`; `ROLLBACK` ante cualquier fallo y `release()` en `finally`. Si dos peticiones compiten, la segunda espera el bloqueo de fila, reevalúa el `WHERE` y obtiene `rowCount = 0` (409). El índice único parcial es una segunda barrera.
- **Devolución**: `UPDATE prestamos ... WHERE id=$1 AND fecha_devolucion IS NULL` + `UPDATE equipos SET disponible=true` en la misma transacción.
- **Claves foráneas** `ON DELETE RESTRICT`: un equipo con préstamos (incluso finalizados) no se puede borrar (SQLSTATE `23503` → 409). `codigo` duplicado (`23505`) → 409.

## Datos iniciales

- 3 usuarios (ids 1–3): Ana García, Luis Martínez, Marta López.
- 12 equipos de 5 categorías (Portátil, Tableta, Proyector, Accesorio, Redes).
- `PORT-003` está prestado a Ana (préstamo activo); `TAB-001` tiene un préstamo ya finalizado (no se puede borrar).

## Pruebas realizadas

Con el servidor en marcha, `npm run pruebas` ejecuta todos los casos con `fetch` (incluida la simultaneidad con `Promise.all`) y muestra una tabla con el resultado. Los equipos de prueba creados quedan en la base; para limpiarlos, reinicia el volumen.

| Caso | Petición | Resultado esperado | Resultado obtenido |
|---|---|---|---|
| Alta | `POST /api/equipos` con datos válidos | 201, equipo con `id` y `Location` | _(completar con la salida del script)_ |
| Modificación | `PUT /api/equipos/:id` | 200, `disponible` sin cambios | |
| Código repetido | `POST /api/equipos` con `codigo` existente | 409 | |
| Búsqueda ILIKE | `GET /equipos?q=thinkpad` | Solo equipos cuyo nombre contiene el texto | |
| Filtros combinados | `GET /equipos?disponibilidad=prestado&categoria=Portátil` | Solo `PORT-003` | |
| Orden y paginación | `GET /equipos?orden=nombre&pagina=2` | 200, "Página 2 de 3" | |
| Sin resultados | `GET /equipos?q=zzzzzz` | 200 con mensaje claro | |
| Detalle | `GET /equipos/abc` / `/equipos/99999999` | 400 / 404 | |
| Borrado sin historial | `DELETE /api/equipos/:id` | 204 | |
| Borrado inexistente | `DELETE /api/equipos/99999999` | 404 | |
| Borrado con préstamos | `DELETE` de un equipo con historial | 409 | |
| Préstamo correcto | `POST /api/prestamos` | 201, un préstamo activo, equipo no disponible | |
| Préstamo duplicado | Segundo `POST /api/prestamos` del mismo equipo | 409, sin filas nuevas | |
| Rollback | `POST /api/prestamos` con `usuarioId` inexistente | 404; equipo sigue disponible, sin préstamo nuevo | |
| Devolución | `POST /api/prestamos/:id/devolucion` | 200, `fecha_devolucion` y equipo disponible | |
| Segunda devolución | Repetir la devolución | 409, nada se modifica | |
| Simultaneidad | Dos `POST /api/prestamos` a la vez (mismo equipo) | Un 201 y un 409; una sola fila | |

## Limitaciones conocidas

- Sin autenticación, sesiones ni gestión de usuarios (solo los 3 usuarios de `init.sql`).
- Las altas, modificaciones, borrados, préstamos y devoluciones solo existen como API JSON (sin formularios HTML).
- Los errores de las rutas HTML (400/404) se devuelven como JSON, ya que la práctica pide únicamente dos vistas.
- No hay tests automatizados con framework; `scripts/pruebas.js` es una comprobación manual asistida.
- `package-lock.json` se genera al ejecutar `npm install`.
