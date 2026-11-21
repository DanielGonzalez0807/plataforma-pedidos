#!/usr/bin/env bash
# ------------------------------------------------------------------
# Crea toda la infraestructura de la Actividad 6 desde AWS CloudShell.
#
# Con GitHub:      bash scripts/crear-infra.sh github  usuario/repositorio  arn:aws:codeconnections:...
# Con CodeCommit:  bash scripts/crear-infra.sh codecommit
# ------------------------------------------------------------------
set -euo pipefail

FUENTE=${1:-}
REGION=${AWS_REGION:-us-east-1}
APP=plataforma-pedidos
STACK_APP=pedidos-app
STACK_PIPE=pedidos-pipeline

if [[ "$FUENTE" != "github" && "$FUENTE" != "codecommit" ]]; then
  echo "Uso: bash scripts/crear-infra.sh github usuario/repo ARN_CONEXION   |   bash scripts/crear-infra.sh codecommit"
  exit 1
fi

echo "1/3 Buscando la plataforma más reciente de Node.js 22 en Elastic Beanstalk..."
STACK_EB=$(aws elasticbeanstalk list-available-solution-stacks --region "$REGION" \
  --query "SolutionStacks[?contains(@, 'Amazon Linux 2023') && contains(@, 'Node.js 22')] | [0]" --output text)
echo "    -> $STACK_EB"

echo "2/3 Creando DynamoDB + Elastic Beanstalk (pruebas y producción). Tarda ~8 minutos..."
aws cloudformation deploy --region "$REGION" \
  --stack-name "$STACK_APP" \
  --template-file infra/app.yml \
  --parameter-overrides NombreApp="$APP" SolutionStack="$STACK_EB" \
  --no-fail-on-empty-changeset

echo "3/3 Creando el pipeline (CodePipeline + CodeBuild)..."
if [[ "$FUENTE" == "github" ]]; then
  REPO=${2:?Falta usuario/repositorio}
  CONEXION=${3:?Falta el ARN de la conexión con GitHub}
  PARAMS="ProveedorFuente=GitHub RepositorioGitHub=$REPO ConexionGitHubArn=$CONEXION"
else
  if ! aws codecommit get-repository --repository-name "$APP" --region "$REGION" >/dev/null 2>&1; then
    aws codecommit create-repository --repository-name "$APP" --region "$REGION" \
      --repository-description "API de gestión de pedidos" >/dev/null
    echo "    Repositorio CodeCommit '$APP' creado"
  fi
  PARAMS="ProveedorFuente=CodeCommit RepositorioCodeCommit=$APP"
fi

aws cloudformation deploy --region "$REGION" \
  --stack-name "$STACK_PIPE" \
  --template-file infra/pipeline.yml \
  --parameter-overrides NombreApp="$APP" StackApp="$STACK_APP" $PARAMS \
  --no-fail-on-empty-changeset

echo
echo "================ LISTO ================"
aws cloudformation describe-stacks --stack-name "$STACK_APP" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UrlPruebas' || OutputKey=='UrlProduccion'].[OutputKey,OutputValue]" --output table
aws cloudformation describe-stacks --stack-name "$STACK_PIPE" --region "$REGION" \
  --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output table
if [[ "$FUENTE" == "codecommit" ]]; then
  echo "URL para clonar/push (git-remote-codecommit):  codecommit::$REGION://$APP"
fi
