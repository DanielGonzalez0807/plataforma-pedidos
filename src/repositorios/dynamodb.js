// Repositorio en Amazon DynamoDB: se usa en AWS (pruebas y producción).
// La instancia de Elastic Beanstalk accede con el rol LabRole (LabInstanceProfile),
// así que no hay credenciales en el código.
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

class RepositorioDynamo {
  constructor(tabla, region = process.env.AWS_REGION || 'us-east-1') {
    this.tabla = tabla;
    this.base = new DynamoDBClient({ region });
    this.cliente = DynamoDBDocumentClient.from(this.base, { marshallOptions: { removeUndefinedValues: true } });
  }
  async guardar(pedido) {
    await this.cliente.send(new PutCommand({ TableName: this.tabla, Item: pedido }));
    return pedido;
  }
  async obtener(id) {
    const r = await this.cliente.send(new GetCommand({ TableName: this.tabla, Key: { id } }));
    return r.Item || null;
  }
  async listar() {
    // Para el volumen de esta plataforma basta un Scan paginado; filtros y orden se aplican en la API.
    const items = [];
    let ExclusiveStartKey;
    do {
      const r = await this.cliente.send(new ScanCommand({ TableName: this.tabla, ExclusiveStartKey }));
      items.push(...(r.Items || []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }
  async salud() {
    await this.base.send(new DescribeTableCommand({ TableName: this.tabla }));
    return 'dynamodb';
  }
}

module.exports = { RepositorioDynamo };
