// Reglas de negocio de los pedidos: validación, estados y consultas.
const { randomUUID } = require('crypto');

const ESTADOS = ['Pendiente', 'En Proceso', 'Enviado', 'Entregado', 'Cancelado'];

// Transiciones permitidas: el pedido avanza en orden y solo se cancela antes de enviarse.
const TRANSICIONES = {
  'Pendiente': ['En Proceso', 'Cancelado'],
  'En Proceso': ['Enviado', 'Cancelado'],
  'Enviado': ['Entregado'],
  'Entregado': [],
  'Cancelado': []
};

const CAMPOS_ORDEN = ['fechaCreacion', 'fechaActualizacion', 'estado', 'total', 'cliente'];

class ErrorNegocio extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

const esTextoValido = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;

function validarPedido(datos) {
  const errores = [];
  const { cliente, productos, direccionEnvio } = datos || {};

  if (!cliente || typeof cliente !== 'object') {
    errores.push('cliente es obligatorio');
  } else {
    if (!esTextoValido(cliente.nombre, 100)) errores.push('cliente.nombre es obligatorio (máx. 100 caracteres)');
    if (!cliente.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) errores.push('cliente.email no es válido');
  }

  if (!Array.isArray(productos) || productos.length === 0) {
    errores.push('productos debe tener al menos un producto');
  } else {
    productos.forEach((p, i) => {
      if (!esTextoValido(p?.nombre, 100)) errores.push(`productos[${i}].nombre es obligatorio`);
      if (!Number.isInteger(p?.cantidad) || p.cantidad < 1) errores.push(`productos[${i}].cantidad debe ser un entero mayor a 0`);
      if (typeof p?.precioUnitario !== 'number' || p.precioUnitario < 0) errores.push(`productos[${i}].precioUnitario debe ser un número mayor o igual a 0`);
    });
  }

  if (!esTextoValido(direccionEnvio, 300)) errores.push('direccionEnvio es obligatoria');

  if (errores.length) throw new ErrorNegocio(400, 'Datos del pedido inválidos', errores);
}

function construirPedido(datos) {
  validarPedido(datos);
  const ahora = new Date().toISOString();
  const productos = datos.productos.map(p => ({
    nombre: p.nombre.trim(),
    cantidad: p.cantidad,
    precioUnitario: p.precioUnitario,
    subtotal: Math.round(p.cantidad * p.precioUnitario * 100) / 100
  }));
  return {
    id: randomUUID(),
    cliente: {
      nombre: datos.cliente.nombre.trim(),
      email: datos.cliente.email.trim().toLowerCase(),
      telefono: datos.cliente.telefono ? String(datos.cliente.telefono).trim() : null
    },
    productos,
    total: Math.round(productos.reduce((s, p) => s + p.subtotal, 0) * 100) / 100,
    direccionEnvio: datos.direccionEnvio.trim(),
    estado: 'Pendiente',
    historialEstados: [{ estado: 'Pendiente', fecha: ahora }],
    fechaCreacion: ahora,
    fechaActualizacion: ahora
  };
}

function cambiarEstado(pedido, nuevoEstado) {
  if (!ESTADOS.includes(nuevoEstado)) {
    throw new ErrorNegocio(400, `Estado inválido. Valores permitidos: ${ESTADOS.join(', ')}`);
  }
  const permitidos = TRANSICIONES[pedido.estado];
  if (!permitidos.includes(nuevoEstado)) {
    throw new ErrorNegocio(409, `No se puede pasar de "${pedido.estado}" a "${nuevoEstado}"`,
      permitidos.length ? [`Desde "${pedido.estado}" solo se permite: ${permitidos.join(', ')}`] : ['El pedido ya está cerrado']);
  }
  const ahora = new Date().toISOString();
  return {
    ...pedido,
    estado: nuevoEstado,
    historialEstados: [...pedido.historialEstados, { estado: nuevoEstado, fecha: ahora }],
    fechaActualizacion: ahora
  };
}

// Filtros: estado, cliente (nombre o email, parcial), desde/hasta (fecha de creación).
// Orden: ordenarPor = fechaCreacion | fechaActualizacion | estado | total | cliente ; orden = asc | desc
function filtrarYOrdenar(pedidos, query = {}) {
  const { estado, cliente, desde, hasta, ordenarPor = 'fechaCreacion', orden = 'desc' } = query;

  if (estado && !ESTADOS.includes(estado)) throw new ErrorNegocio(400, `Estado inválido. Valores permitidos: ${ESTADOS.join(', ')}`);
  if (!CAMPOS_ORDEN.includes(ordenarPor)) throw new ErrorNegocio(400, `ordenarPor inválido. Valores permitidos: ${CAMPOS_ORDEN.join(', ')}`);
  if (!['asc', 'desc'].includes(orden)) throw new ErrorNegocio(400, 'orden debe ser asc o desc');

  const fechaDesde = desde ? new Date(desde) : null;
  const fechaHasta = hasta ? new Date(hasta) : null;
  if ((fechaDesde && isNaN(fechaDesde)) || (fechaHasta && isNaN(fechaHasta))) {
    throw new ErrorNegocio(400, 'desde/hasta deben ser fechas válidas (AAAA-MM-DD)');
  }
  // "hasta" incluye todo el día indicado
  if (fechaHasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta)) fechaHasta.setUTCHours(23, 59, 59, 999);

  const texto = cliente ? cliente.toLowerCase() : null;
  const resultado = pedidos.filter(p => {
    if (estado && p.estado !== estado) return false;
    if (texto && !p.cliente.nombre.toLowerCase().includes(texto) && !p.cliente.email.includes(texto)) return false;
    const creado = new Date(p.fechaCreacion);
    if (fechaDesde && creado < fechaDesde) return false;
    if (fechaHasta && creado > fechaHasta) return false;
    return true;
  });

  const valor = p => {
    if (ordenarPor === 'cliente') return p.cliente.nombre.toLowerCase();
    if (ordenarPor === 'estado') return ESTADOS.indexOf(p.estado);
    return p[ordenarPor];
  };
  const factor = orden === 'asc' ? 1 : -1;
  resultado.sort((a, b) => (valor(a) > valor(b) ? 1 : valor(a) < valor(b) ? -1 : 0) * factor);
  return resultado;
}

function resumenPorEstado(pedidos) {
  const resumen = Object.fromEntries(ESTADOS.map(e => [e, 0]));
  pedidos.forEach(p => { resumen[p.estado] += 1; });
  return { total: pedidos.length, porEstado: resumen };
}

module.exports = { ESTADOS, TRANSICIONES, ErrorNegocio, construirPedido, cambiarEstado, filtrarYOrdenar, resumenPorEstado };
