// Repositorio en memoria: se usa en las pruebas unitarias y al correr en local.
class RepositorioMemoria {
  constructor() {
    this.pedidos = new Map();
  }
  async guardar(pedido) {
    this.pedidos.set(pedido.id, structuredClone(pedido));
    return pedido;
  }
  async obtener(id) {
    const p = this.pedidos.get(id);
    return p ? structuredClone(p) : null;
  }
  async listar() {
    return [...this.pedidos.values()].map(p => structuredClone(p));
  }
  async salud() {
    return 'memoria';
  }
}

module.exports = { RepositorioMemoria };
