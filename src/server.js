const { crearApp } = require('./app');
const { RepositorioMemoria } = require('./repositorios/memoria');
const { RepositorioDynamo } = require('./repositorios/dynamodb');

// En AWS, TABLE_NAME llega como variable de entorno desde Elastic Beanstalk.
// Sin ella (en local) los pedidos se guardan en memoria.
const tabla = process.env.TABLE_NAME;
const repositorio = tabla ? new RepositorioDynamo(tabla) : new RepositorioMemoria();
const PORT = process.env.PORT || 8080;

crearApp(repositorio).listen(PORT, () => {
  console.log(`API de pedidos en el puerto ${PORT} | almacenamiento: ${tabla ? `DynamoDB (${tabla})` : 'memoria'} | entorno: ${process.env.ENTORNO || 'local'}`);
});
