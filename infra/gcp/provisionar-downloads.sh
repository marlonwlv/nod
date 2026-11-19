#!/usr/bin/env bash
# Recebe config.env já carregado por provisionar.sh. Não cria nem alarga o provider compartilhado.
set -euo pipefail
: "${PROJETO:?}" "${BUCKET_DOWNLOADS:?}" "${GITHUB_REPO:?}" "${NUMERO:?}"
[[ "$BUCKET_DOWNLOADS" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || exit 1
G="${GCLOUD:-gcloud}"
gc() { "$G" --project="$PROJETO" --quiet "$@"; }
# O provider é o da main/producao (GCP_WIF_PROVIDER), nunca o de tags/release.
# Falha fechado se não for exatamente a condição pública da ADR-161; um provider com política legada
# deve ser auditado pelo dono antes de usar este provisionamento, sem alargar confiança automaticamente.
REPO_ID="$(gh api "repos/$GITHUB_REPO" --jq .id)"
CONDICAO="$(gc iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github --format='value(attributeCondition)')"
ESPERADA="assertion.repository_id == '$REPO_ID' && assertion.ref == 'refs/heads/main' && assertion.environment == 'producao'"
if [[ "$CONDICAO" != "$ESPERADA" && "$CONDICAO" != "($ESPERADA)" ]]; then
  echo 'Provider WIF requer auditoria: condição diferente de repository_id + main + producao; nenhuma permissão de downloads foi concedida.' >&2
  exit 1
fi
BUCKET_PROJETO="$(gc storage buckets describe "gs://$BUCKET_DOWNLOADS" --raw --format='value(projectNumber)')"
[[ "$BUCKET_PROJETO" == "$NUMERO" ]] || { echo 'Bucket pertence a outro projeto; nenhuma permissão concedida.' >&2; exit 1; }
SA_DOWNLOADS="nod-downloads@$PROJETO.iam.gserviceaccount.com"
gc iam service-accounts describe "$SA_DOWNLOADS" >/dev/null 2>&1 || gc iam service-accounts create nod-downloads --display-name='nod: downloads publicados'
CHAVES="$(gc iam service-accounts keys list --iam-account="$SA_DOWNLOADS" --managed-by=user --format='value(name)')"
[[ -z "$CHAVES" ]] || { echo 'Conta tem chave gerenciada pelo usuário: nenhuma permissão concedida.' >&2; exit 1; }
gc storage buckets add-iam-policy-binding "gs://$BUCKET_DOWNLOADS" --member="serviceAccount:$SA_DOWNLOADS" --role=roles/storage.objectAdmin >/dev/null
# Subject inclui environment; ref e repository_id são impostos pelo provider verificado acima.
gc iam service-accounts add-iam-policy-binding "$SA_DOWNLOADS" --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/github/subject/repo:$GITHUB_REPO:environment:producao" >/dev/null
echo 'Conta de downloads provisionada; conferir IAM efetivo e configurar GCP_DOWNLOADS_SA antes de habilitar o gate.'
