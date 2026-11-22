// Pruebas manuales automatizadas con fetch. Requiere el servidor en marcha.
// Uso: npm run pruebas   (opcional: BASE_URL=http://localhost:3000)
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const resultados = [];

async function http(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* respuesta HTML o vacía */ }
  return { status: r.status, json, texto, location: r.headers.get('location') };
}

function comprobar(caso, esperado, obtenido) {
  resultados.push({ Caso: caso, Esperado: String(esperado), Obtenido: String(obtenido), OK: esperado === obtenido ? '✔' : '✘' });
}

const sufijo = Date.now().toString(36).toUpperCase();
const nuevoEquipo = (letra) =>
  http('POST', '/api/equipos', { codigo: `T-${sufijo}-${letra}`, nombre: `Equipo prueba ${letra}`, categoria: 'Prueba' });

// --- Alta y modificación ---
const a = await nuevoEquipo('A');
comprobar('POST /api/equipos', 201, a.status);
comprobar('Cabecera Location', `/api/equipos/${a.json?.id}`, a.location);
const put = await http('PUT', `/api/equipos/${a.json.id}`, { codigo: `T-${sufijo}-A`, nombre: 'Equipo prueba A (editado)', categoria: 'Prueba' });
comprobar('PUT /api/equipos/:id', 200, put.status);
comprobar('PUT no modifica disponible', true, put.json?.disponible);
comprobar('POST con código repetido', 409, (await nuevoEquipo('A')).status);
comprobar('POST con nombre vacío', 400, (await http('POST', '/api/equipos', { codigo: 'X1', nombre: '   ', categoria: 'Z' })).status);
comprobar('PUT id inexistente', 404, (await http('PUT', '/api/equipos/99999999', { codigo: 'Q', nombre: 'Q', categoria: 'Q' })).status);
comprobar('PUT id mal formado', 400, (await http('PUT', '/api/equipos/abc', { codigo: 'Q', nombre: 'Q', categoria: 'Q' })).status);

// --- Borrado ---
comprobar('DELETE sin historial', 204, (await http('DELETE', `/api/equipos/${a.json.id}`)).status);
comprobar('DELETE id inexistente', 404, (await http('DELETE', '/api/equipos/99999999')).status);

// --- Préstamos ---
const b = await nuevoEquipo('B');
const p1 = await http('POST', '/api/prestamos', { equipoId: b.json.id, usuarioId: 1 });
comprobar('Préstamo correcto', 201, p1.status);
const det = await http('GET', `/equipos/${b.json.id}`);
comprobar('Detalle: equipo prestado y 1 préstamo activo', true, det.texto.includes('Prestado') && det.texto.includes('Pendiente'));
comprobar('Préstamo duplicado', 409, (await http('POST', '/api/prestamos', { equipoId: b.json.id, usuarioId: 2 })).status);
comprobar('DELETE con préstamos', 409, (await http('DELETE', `/api/equipos/${b.json.id}`)).status);

// --- Rollback: usuario inexistente ---
const c = await nuevoEquipo('C');
comprobar('Préstamo a usuario inexistente', 404, (await http('POST', '/api/prestamos', { equipoId: c.json.id, usuarioId: 99999 })).status);
const detC = await http('GET', `/equipos/${c.json.id}`);
comprobar('Rollback: equipo sigue disponible y sin préstamos', true, detC.texto.includes('Disponible') && detC.texto.includes('todavía no tiene préstamos'));
comprobar('Préstamo posterior válido', 201, (await http('POST', '/api/prestamos', { equipoId: c.json.id, usuarioId: 1 })).status);
comprobar('Préstamo con body inválido', 400, (await http('POST', '/api/prestamos', { equipoId: 'x', usuarioId: 1 })).status);

// --- Devolución ---
const d1 = await http('POST', `/api/prestamos/${p1.json.id}/devolucion`);
comprobar('Devolución', 200, d1.status);
comprobar('Devolución registra fecha_devolucion', true, d1.json?.fecha_devolucion != null);
const detB = await http('GET', `/equipos/${b.json.id}`);
comprobar('Tras devolver: equipo disponible', true, detB.texto.includes('Disponible'));
comprobar('Segunda devolución', 409, (await http('POST', `/api/prestamos/${p1.json.id}/devolucion`)).status);
comprobar('Devolución de préstamo inexistente', 404, (await http('POST', '/api/prestamos/99999999/devolucion')).status);

// --- Simultaneidad ---
const e = await nuevoEquipo('E');
const [r1, r2] = await Promise.all([
  http('POST', '/api/prestamos', { equipoId: e.json.id, usuarioId: 1 }),
  http('POST', '/api/prestamos', { equipoId: e.json.id, usuarioId: 2 }),
]);
comprobar('Simultaneidad: un 201 y un 409', '201,409', [r1.status, r2.status].sort().join(','));
const detE = await http('GET', `/equipos/${e.json.id}`);
comprobar('Simultaneidad: una sola fila de préstamo', 1, (detE.texto.match(/Pendiente/g) ?? []).length);

// --- Consultas y filtros (HTML) ---
const f1 = await http('GET', '/equipos?q=thinkpad&orden=nombre');
comprobar('Filtro ILIKE (thinkpad)', true, f1.status === 200 && f1.texto.includes('PORT-001') && !f1.texto.includes('TAB-001'));
const f2 = await http('GET', '/equipos?categoria=Tableta');
comprobar('Filtro por categoría', true, f2.texto.includes('TAB-002') && !f2.texto.includes('PORT-001'));
const f3 = await http('GET', '/equipos?disponibilidad=prestado&categoria=Port%C3%A1til');
comprobar('Filtros combinados (prestado + Portátil)', true, f3.texto.includes('PORT-003') && !f3.texto.includes('PORT-001'));
const f4 = await http('GET', '/equipos?orden=nombre&pagina=2');
comprobar('Segunda página', true, f4.status === 200 && f4.texto.includes('Página 2 de'));
const f5 = await http('GET', '/equipos?q=zzzzzz');
comprobar('Sin resultados: mensaje claro', true, f5.status === 200 && f5.texto.includes('No se han encontrado'));
comprobar('Orden no permitido → usa el predeterminado', 200, (await http('GET', '/equipos?orden=id;DROP TABLE equipos')).status);
comprobar('GET /equipos/abc', 400, (await http('GET', '/equipos/abc')).status);
comprobar('GET /equipos/99999999', 404, (await http('GET', '/equipos/99999999')).status);

console.table(resultados);
const fallos = resultados.filter((r) => r.OK !== '✔').length;
console.log(fallos === 0 ? 'Todas las pruebas correctas' : `${fallos} prueba(s) con resultado distinto al esperado`);
process.exitCode = fallos === 0 ? 0 : 1;
