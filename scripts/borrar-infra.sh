#!/usr/bin/env bash
# Borra todo lo creado (para no gastar créditos del Learner Lab cuando termines).
set -uo pipefail
REGION=${AWS_REGION:-us-east-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

aws s3 rm "s3://plataforma-pedidos-artefactos-${ACCOUNT}" --recursive --region "$REGION" 2>/dev/null
# El bucket es versionado: hay que borrar también las versiones antiguas
aws s3api list-object-versions --bucket "plataforma-pedidos-artefactos-${ACCOUNT}" --region "$REGION" \
  --query '{Objects: [Versions, DeleteMarkers][][].{Key:Key,VersionId:VersionId}}' --output json > /tmp/versiones.json 2>/dev/null \
  && grep -q Key /tmp/versiones.json \
  && aws s3api delete-objects --bucket "plataforma-pedidos-artefactos-${ACCOUNT}" --delete file:///tmp/versiones.json --region "$REGION" >/dev/null

aws cloudformation delete-stack --stack-name pedidos-pipeline --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name pedidos-pipeline --region "$REGION"
aws cloudformation delete-stack --stack-name pedidos-app --region "$REGION"
echo "Borrando entornos de Beanstalk (tarda unos minutos)..."
aws cloudformation wait stack-delete-complete --stack-name pedidos-app --region "$REGION"
echo "Listo."
