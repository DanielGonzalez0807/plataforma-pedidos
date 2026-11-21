# Actividad 6 · Plataforma de gestión de pedidos con DevOps en AWS

API REST en **Node.js + Express** para crear, consultar (con filtros y orden) y actualizar el estado de pedidos, con todo el ciclo de vida automatizado en AWS.

```
                      ┌──────────────────────── AWS CodePipeline ─────────────────────────────────────────┐
GitHub (main) ─push─▶ │ Fuente ─▶ Construcción ─▶ Desplegar-Pruebas ─▶ Pruebas de humo ─▶ Aprobación ─▶ Desplegar-Producción │
                      │           (CodeBuild:      (Elastic Beanstalk)  (CodeBuild: curl)    (manual)     (Elastic Beanstalk)  │
                      │           npm ci, tests,                                                                            │
                      │           informe JUnit)                                                                            │
                      └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
   Infraestructura como código: CloudFormation (infra/app.yml, infra/pipeline.yml)
   Datos: DynamoDB (una tabla por entorno) · Monitoreo: CloudWatch Logs + salud mejorada de Beanstalk
```

## Requisitos de negocio → endpoints

| Requisito | Endpoint | Detalle |
|---|---|---|
| Crear pedidos | `POST /api/pedidos` | Cliente (nombre, email, teléfono), productos (nombre, cantidad, precio), dirección. Calcula subtotales y total. Valida y responde 400 con el detalle. |
| Visualizar pedidos | `GET /api/pedidos` | Filtros: `estado`, `cliente`, `desde`, `hasta`. Orden: `ordenarPor` (fechaCreacion, fechaActualizacion, estado, total, cliente) y `orden` (asc/desc). |
| | `GET /api/pedidos/:id` · `GET /api/pedidos/resumen` | Detalle con historial de estados · conteo por estado |
| Actualizar estado | `PATCH /api/pedidos/:id/estado` | Pendiente → En Proceso → Enviado → Entregado. Se puede Cancelar si está Pendiente o En Proceso. Saltos no permitidos → 409. |
| Sistema | `GET /health` · `GET /api/info` · `/docs` | Salud (la usa Beanstalk) · versión y commit desplegado · Swagger |

La raíz `/` sirve una interfaz web para crear, filtrar, ordenar y cambiar estados.

## Estructura

```
src/            app.js (rutas), pedidos.js (reglas de negocio), repositorios/ (memoria y DynamoDB), openapi.json
test/           16 pruebas unitarias (node:test + supertest)
public/         interfaz web
buildspec.yml        CI en CodeBuild: npm ci, sintaxis, pruebas + informe JUnit, artefacto (con caché de npm)
buildspec-humo.yml   pruebas de humo contra el entorno de pruebas
infra/app.yml        CloudFormation: DynamoDB + Elastic Beanstalk (pruebas y producción) + CloudWatch Logs
infra/pipeline.yml   CloudFormation: bucket de artefactos, 2 proyectos CodeBuild y el pipeline
scripts/             crear-infra.sh y borrar-infra.sh (para CloudShell)
plan-b/              GitHub Actions si el Learner Lab bloquea CodePipeline/CodeBuild
```

---

## Paso 0 · Revisar permisos del Learner Lab

En CloudShell (us-east-1) sube y corre `00_probar-permisos-learner-lab.sh` → **captura**.
Si CodeBuild o CodePipeline salen **BLOQUEADO**, ve directo al **Plan B**.

## Paso 1 · Probar en local

```powershell
cd E:\Trabajos_LaSalle\7mo\herramientasDeSoftware_2\actividad6
npm install
npm test        # 16 pruebas en verde → captura
npm start       # http://localhost:8080  y  http://localhost:8080/docs
```

En local los pedidos se guardan en memoria; en AWS, en DynamoDB (lo decide la variable `TABLE_NAME`).

## Paso 2 · Subir a GitHub

Repo **público** `plataforma-pedidos`:

```powershell
git init -b main
git add .
git commit -m "API de pedidos, pruebas, buildspec e infraestructura como código"
git remote add origin https://github.com/TU_USUARIO/plataforma-pedidos.git
git push -u origin main
```

## Paso 3 · Conexión con GitHub

**CodePipeline → Settings → Connections → Create connection → GitHub** → nombre `github-daniel` → *Install a new app* → autoriza el repo → *Connect*. Copia el **ARN** de la conexión (estado *Available*).

## Paso 4 · Crear toda la infraestructura (CloudShell)

```bash
git clone https://github.com/TU_USUARIO/plataforma-pedidos.git
cd plataforma-pedidos
bash scripts/crear-infra.sh github TU_USUARIO/plataforma-pedidos ARN_DE_LA_CONEXION
```

El script busca la plataforma Node.js 22, crea el stack `pedidos-app` (DynamoDB + 2 entornos, ~8 min) y luego `pedidos-pipeline`. Al final imprime las URL de pruebas y producción → **captura** de CloudShell y de **CloudFormation → Stacks** en *CREATE_COMPLETE*.

> Si la conexión con GitHub está bloqueada: `bash scripts/crear-infra.sh codecommit` y empuja el código a CodeCommit desde CloudShell (ver *Alternativa CodeCommit*).

## Paso 5 · Primera ejecución del pipeline

En **CodePipeline → plataforma-pedidos-pipeline**:

1. *Fuente* y *Construcción* en verde. Abre el build → pestaña **Reports**: 16 pruebas pasadas → **captura**.
2. *Desplegar-Pruebas* + *Pruebas-de-Humo* en verde. Abre la URL de pruebas y crea un par de pedidos → **captura**.
3. *Aprobación*: **Review → Approve** (escribe un comentario) → **captura**.
4. *Desplegar-Producción* en verde → **captura** del pipeline completo y de la app en producción + `/docs`.
5. **Elastic Beanstalk → Environments**: ambos en *Ok* con la misma versión → **captura**.

## Paso 6 · Demostrar CI/CD con un commit

Cambia `"version": "1.0.0"` a `"1.1.0"` en `package.json` (o cualquier detalle visible de la interfaz) y:

```powershell
git commit -am "Versión 1.1.0"
git push
```

El pipeline arranca solo. Muestra cómo avanza, aprueba y verifica que el encabezado de la app muestra `v1.1.0` y el nuevo commit en ambos entornos.

**Prueba que falla (muy bueno para el video):** cambia una aserción en `test/pedidos.test.js` (por ejemplo `310000` por `1`), push → el pipeline **se detiene en Construcción** y producción sigue intacta → **captura**. Revierte con `git revert HEAD` y push.

## Paso 7 · Monitoreo

- **CloudWatch → Log groups** → `/aws/elasticbeanstalk/plataforma-pedidos-produccion/var/log/web.stdout.log`: cada petición queda registrada en JSON → **captura**.
- `/codebuild/plataforma-pedidos`: logs de los builds.
- Elastic Beanstalk → *Monitoring* y *Health* (salud mejorada).
- DynamoDB → *Tables → plataforma-pedidos-produccion → Explore items* → **captura** de los pedidos guardados.

## Capturas para el informe

1. Script de permisos
2. Pruebas en local + app corriendo en local
3. Repo de GitHub (estructura e historial de commits)
4. Stacks de CloudFormation en *CREATE_COMPLETE* (y la plantilla en el *Designer/Template*)
5. Proyecto CodeBuild + log del build + **Reports**
6. Pipeline completo en verde (las 6 etapas)
7. Aprobación manual
8. Entornos de Beanstalk en *Ok*
9. App en pruebas y en producción + Swagger
10. Ejecución disparada por commit (historial con el mensaje del commit)
11. Pipeline detenido por prueba fallida
12. CloudWatch Logs + items en DynamoDB

## Guion del video (≤ 10 min)

| Min | Qué mostrar |
|---|---|
| 0:00–0:45 | Presentación y caso: plataforma de pedidos con ciclo DevOps automatizado. Diagrama de arquitectura. |
| 0:45–2:30 | Código: reglas de negocio (`pedidos.js`, transiciones de estado), endpoints, pruebas. App local y Swagger. |
| 2:30–4:00 | Automatización: `buildspec.yml` (caché, pruebas, informe, artefactos), `infra/app.yml` y `infra/pipeline.yml`. Stacks en CloudFormation. |
| 4:00–5:30 | Pipeline en la consola: etapas, CodeBuild y su reporte, entornos de Beanstalk. |
| 5:30–8:30 | **Demo en vivo**: cambio + `git push` → pipeline solo → pruebas de humo → aprobación → producción. Crear un pedido y cambiar su estado en producción. |
| 8:30–9:30 | Prueba fallida que bloquea el despliegue + CloudWatch Logs y DynamoDB. |
| 9:30–10:00 | Conclusiones. |

## Plan B · Si CodePipeline/CodeBuild están bloqueados

1. Crea igual la infraestructura de la app (sí la permite el lab):
   ```bash
   STACK_EB=$(aws elasticbeanstalk list-available-solution-stacks --query "SolutionStacks[?contains(@, 'Amazon Linux 2023') && contains(@, 'Node.js 22')] | [0]" --output text)
   aws cloudformation deploy --stack-name pedidos-app --template-file infra/app.yml --parameter-overrides SolutionStack="$STACK_EB"
   ```
2. Intenta igual `bash scripts/crear-infra.sh ...` y guarda la **captura del error** de permisos: es la evidencia de por qué cambias de herramienta.
3. Copia `plan-b/ci-cd-github-actions.yml` a `.github/workflows/ci-cd.yml`, crea los secretos `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (de **AWS Details** del lab; vencen cada ~4 h) y un *Environment* `produccion` en GitHub con *Required reviewers* (equivale a la aprobación manual).
4. Push → **Actions** muestra: pruebas → pruebas en AWS → aprobación → producción.

## Alternativa CodeCommit

```bash
bash scripts/crear-infra.sh codecommit
pip install --user git-remote-codecommit
git remote add aws codecommit::us-east-1://plataforma-pedidos
git push aws main
```

## Limpieza (cuando te califiquen)

```bash
bash scripts/borrar-infra.sh
```
