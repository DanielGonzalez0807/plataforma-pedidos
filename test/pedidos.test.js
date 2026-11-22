const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { crearApp } = require('../src/app');
const { RepositorioMemoria } = require('../src/repositorios/memoria');
const {
  filtrarYOrdenar,
  cambiarEstado,
  construirPedido,
} = require('../src/pedidos');

const pedidoValido = (sobrescribir = {}) => ({
  cliente: {
    nombre: 'Laura Martínez',
    email: 'laura@correo.com',
    telefono: '3001234567',
  },
  productos: [
    { nombre: 'Teclado', cantidad: 1, precioUnitario: 180000 },
    { nombre: 'Mouse', cantidad: 2, precioUnitario: 65000 },
  ],
  direccionEnvio: 'Calle 72 # 10-34, Bogotá',
  ...sobrescribir,
});

let app;
beforeEach(() => {
  app = crearApp(new RepositorioMemoria());
});

describe('Crear pedidos', () => {
  test('crea un pedido válido en estado Pendiente y calcula el total', async () => {
    const res = await request(app).post('/api/pedidos').send(pedidoValido());
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.estado, 'Pendiente');
    assert.strictEqual(res.body.total, 1);
    assert.strictEqual(res.body.historialEstados.length, 1);
    assert.match(res.headers.location, /\/api\/pedidos\//);
  });

  test('rechaza un pedido sin productos (400)', async () => {
    const res = await request(app)
      .post('/api/pedidos')
      .send(pedidoValido({ productos: [] }));
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.detalles.some((d) => d.includes('productos')));
  });

  test('rechaza email inválido y cantidad negativa (400)', async () => {
    const res = await request(app)
      .post('/api/pedidos')
      .send(
        pedidoValido({
          cliente: { nombre: 'Ana', email: 'no-es-email' },
          productos: [{ nombre: 'Silla', cantidad: -1, precioUnitario: 10 }],
        }),
      );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.detalles.length, 2);
  });

  test('rechaza JSON mal formado (400)', async () => {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Content-Type', 'application/json')
      .send('{"mal":');
    assert.strictEqual(res.status, 400);
  });
});

describe('Visualizar pedidos', () => {
  test('lista, consulta por id y responde 404 si no existe', async () => {
    const creado = (
      await request(app).post('/api/pedidos').send(pedidoValido())
    ).body;
    const lista = await request(app).get('/api/pedidos');
    assert.strictEqual(lista.body.total, 1);
    const uno = await request(app).get(`/api/pedidos/${creado.id}`);
    assert.strictEqual(uno.body.id, creado.id);
    const no = await request(app).get('/api/pedidos/no-existe');
    assert.strictEqual(no.status, 404);
  });

  test('filtra por estado y por cliente', async () => {
    const a = (await request(app).post('/api/pedidos').send(pedidoValido()))
      .body;
    await request(app)
      .post('/api/pedidos')
      .send(
        pedidoValido({
          cliente: { nombre: 'Carlos Ruiz', email: 'carlos@correo.com' },
        }),
      );
    await request(app)
      .patch(`/api/pedidos/${a.id}/estado`)
      .send({ estado: 'En Proceso' });

    const enProceso = await request(app)
      .get('/api/pedidos')
      .query({ estado: 'En Proceso' });
    assert.strictEqual(enProceso.body.total, 1);
    assert.strictEqual(enProceso.body.pedidos[0].id, a.id);

    const carlos = await request(app)
      .get('/api/pedidos')
      .query({ cliente: 'carlos' });
    assert.strictEqual(carlos.body.total, 1);
  });

  test('ordena por total ascendente y descendente', async () => {
    await request(app)
      .post('/api/pedidos')
      .send(
        pedidoValido({
          productos: [{ nombre: 'A', cantidad: 1, precioUnitario: 500 }],
        }),
      );
    await request(app)
      .post('/api/pedidos')
      .send(
        pedidoValido({
          productos: [{ nombre: 'B', cantidad: 1, precioUnitario: 100 }],
        }),
      );
    const asc = await request(app)
      .get('/api/pedidos')
      .query({ ordenarPor: 'total', orden: 'asc' });
    assert.deepStrictEqual(
      asc.body.pedidos.map((p) => p.total),
      [100, 500],
    );
    const desc = await request(app)
      .get('/api/pedidos')
      .query({ ordenarPor: 'total', orden: 'desc' });
    assert.deepStrictEqual(
      desc.body.pedidos.map((p) => p.total),
      [500, 100],
    );
  });

  test('filtra por rango de fechas de creación', () => {
    const viejo = {
      ...construirPedido(pedidoValido()),
      fechaCreacion: '2026-01-10T12:00:00.000Z',
    };
    const nuevo = {
      ...construirPedido(pedidoValido()),
      fechaCreacion: '2026-11-20T12:00:00.000Z',
    };
    const r = filtrarYOrdenar([viejo, nuevo], {
      desde: '2026-11-01',
      hasta: '2026-11-20',
    });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].id, nuevo.id);
  });

  test('rechaza filtros inválidos (400)', async () => {
    assert.strictEqual(
      (await request(app).get('/api/pedidos').query({ estado: 'Perdido' }))
        .status,
      400,
    );
    assert.strictEqual(
      (await request(app).get('/api/pedidos').query({ ordenarPor: 'precio' }))
        .status,
      400,
    );
    assert.strictEqual(
      (await request(app).get('/api/pedidos').query({ desde: 'ayer' })).status,
      400,
    );
  });

  test('resumen cuenta pedidos por estado', async () => {
    await request(app).post('/api/pedidos').send(pedidoValido());
    await request(app).post('/api/pedidos').send(pedidoValido());
    const r = await request(app).get('/api/pedidos/resumen');
    assert.strictEqual(r.body.total, 2);
    assert.strictEqual(r.body.porEstado.Pendiente, 2);
  });
});

describe('Actualizar estado', () => {
  test('recorre el flujo completo Pendiente → Entregado y guarda historial', async () => {
    const { id } = (
      await request(app).post('/api/pedidos').send(pedidoValido())
    ).body;
    for (const estado of ['En Proceso', 'Enviado', 'Entregado']) {
      const r = await request(app)
        .patch(`/api/pedidos/${id}/estado`)
        .send({ estado });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.estado, estado);
    }
    const final = await request(app).get(`/api/pedidos/${id}`);
    assert.deepStrictEqual(
      final.body.historialEstados.map((h) => h.estado),
      ['Pendiente', 'En Proceso', 'Enviado', 'Entregado'],
    );
  });

  test('no permite saltar estados (409)', async () => {
    const { id } = (
      await request(app).post('/api/pedidos').send(pedidoValido())
    ).body;
    const r = await request(app)
      .patch(`/api/pedidos/${id}/estado`)
      .send({ estado: 'Entregado' });
    assert.strictEqual(r.status, 409);
  });

  test('no permite cancelar un pedido ya enviado', () => {
    let p = construirPedido(pedidoValido());
    p = cambiarEstado(p, 'En Proceso');
    p = cambiarEstado(p, 'Enviado');
    assert.throws(
      () => cambiarEstado(p, 'Cancelado'),
      (err) => err.status === 409,
    );
  });

  test('rechaza un estado que no existe (400) y un pedido inexistente (404)', async () => {
    const { id } = (
      await request(app).post('/api/pedidos').send(pedidoValido())
    ).body;
    assert.strictEqual(
      (
        await request(app)
          .patch(`/api/pedidos/${id}/estado`)
          .send({ estado: 'Perdido' })
      ).status,
      400,
    );
    assert.strictEqual(
      (
        await request(app)
          .patch('/api/pedidos/xyz/estado')
          .send({ estado: 'Enviado' })
      ).status,
      404,
    );
  });
});

describe('Sistema', () => {
  test('GET /health responde ok', async () => {
    const r = await request(app).get('/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.estado, 'ok');
  });

  test('GET /api/info devuelve versión y entorno', async () => {
    const r = await request(app).get('/api/info');
    assert.strictEqual(r.body.app, 'plataforma-pedidos');
    assert.ok(r.body.version);
  });
});
