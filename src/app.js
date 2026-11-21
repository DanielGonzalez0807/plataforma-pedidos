const express = require('express');
const path = require('path');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const { ErrorNegocio, ESTADOS, construirPedido, cambiarEstado, filtrarYOrdenar, resumenPorEstado } = require('./pedidos');
const openapi = require('./openapi.json');

function leerInfoBuild() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf8'));
  } catch {
    return { commit: 'local', buildId: 'local', fecha: null };
  }
}

function crearApp(repositorio) {
  const app = express();
  const build = leerInfoBuild();

  app.use(express.json({ limit: '100kb' }));

  // Log de cada petición: en AWS estas líneas llegan a CloudWatch Logs
  const silenciar = Boolean(process.env.NODE_TEST_CONTEXT); // no ensuciar la salida de las pruebas
  app.use((req, res, next) => {
    if (silenciar) return next();
    const inicio = Date.now();
    res.on('finish', () => {
      if (req.path !== '/health') {
        console.log(JSON.stringify({ metodo: req.method, ruta: req.originalUrl, status: res.statusCode, ms: Date.now() - inicio }));
      }
    });
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'API de Pedidos' }));

  app.get('/health', async (req, res) => {
    try {
      const almacenamiento = await repositorio.salud();
      res.json({ estado: 'ok', almacenamiento });
    } catch (e) {
      res.status(503).json({ estado: 'error', detalle: e.message });
    }
  });

  app.get('/api/info', (req, res) => {
    res.json({
      app: 'plataforma-pedidos',
      version: require('../package.json').version,
      entorno: process.env.ENTORNO || 'local',
      commit: build.commit,
      buildId: build.buildId,
      fechaBuild: build.fecha,
      estados: ESTADOS
    });
  });

  app.post('/api/pedidos', async (req, res) => {
    const pedido = construirPedido(req.body);
    await repositorio.guardar(pedido);
    res.status(201).location(`/api/pedidos/${pedido.id}`).json(pedido);
  });

  app.get('/api/pedidos', async (req, res) => {
    const pedidos = filtrarYOrdenar(await repositorio.listar(), req.query);
    res.json({ total: pedidos.length, pedidos });
  });

  app.get('/api/pedidos/resumen', async (req, res) => {
    res.json(resumenPorEstado(await repositorio.listar()));
  });

  app.get('/api/pedidos/:id', async (req, res) => {
    const pedido = await repositorio.obtener(req.params.id);
    if (!pedido) throw new ErrorNegocio(404, 'Pedido no encontrado');
    res.json(pedido);
  });

  app.patch('/api/pedidos/:id/estado', async (req, res) => {
    const pedido = await repositorio.obtener(req.params.id);
    if (!pedido) throw new ErrorNegocio(404, 'Pedido no encontrado');
    const actualizado = cambiarEstado(pedido, req.body?.estado);
    await repositorio.guardar(actualizado);
    res.json(actualizado);
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Manejo central de errores (Express 5 captura también los errores de funciones async)
  app.use((err, req, res, next) => {
    if (err instanceof ErrorNegocio) {
      return res.status(err.status).json({ error: err.message, detalles: err.detalles });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { crearApp };
