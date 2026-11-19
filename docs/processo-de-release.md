
## Publicação automática dos downloads do Mac (NOD-334)

Depois do aceite nos dois Macs, publicar a release `vX.Y.Z[-rc.N]` dispara
`publicar-downloads.yml`: o evento da tag apenas encaminha um dispatch para a main.
O job da main usa o environment `producao`, WIF e conta `nod-downloads` restrita ao
bucket; nunca usa chave JSON nem runner próprio. RC publicada também pode promover.

O gate `NOD_PUBLICAR_DOWNLOADS` fica ausente/desligado até configurar:

- `GCP_WIF_PROVIDER` (secret de `producao`): provider da main, com repository_id,
  ref main e environment producao. Não usar o provider de tags do desktop-release.
- `GCP_DOWNLOADS_SA` (variável): conta dedicada; `NOD_DOWNLOADS_BUCKET` (variável):
  o mesmo bucket dos redirects existentes. O script confere os 302 antes de escrever.
- `BUCKET_DOWNLOADS` no config local de infraestrutura: substituir o exemplo público.
  O dono roda `PROVISIONAR_DOWNLOADS=1 infra/gcp/provisionar.sh`; sem esse opt-in,
  o provisionamento comum não toca em downloads. O bloco dedicado verifica projeto do bucket,
  condição WIF e ausência de chaves de usuário. A condição aceita é literalmente
  `assertion.repository_id == '<id do repo>' && assertion.ref == 'refs/heads/main' && assertion.environment == 'producao'`
  (também entre parênteses). Política legada diferente exige auditoria do dono;
  o script não modifica o provider compartilhado nem amplia a confiança.
- Conferir IAM efetivo da conta (inclusive heranças): `roles/storage.objectAdmin`
  somente no bucket. O script não remove permissões antigas de uma conta existente.

Só então configure `NOD_PUBLICAR_DOWNLOADS=1`. Não é necessário publicar outra versão
para repetir uma release já publicada:

```bash
gh workflow run publicar-downloads.yml -R marlonwlv/nod --ref main -f tag=vX.Y.Z
# Rollback explícito: continua exigindo origem, hashes e versionado imutável.
gh workflow run publicar-downloads.yml -R marlonwlv/nod --ref main -f tag=vX.Y.Z -f permitir_voltar=true
```

O script resolve o commit real da tag e exige `desktop-release` verde nesse SHA/tag,
com draft e os dois Macs concluídos: run seco não serve. Confere os quatro assets e
os SHA-256 baixados. Os checksums atuais podem conter linhas DMG e ZIP com `release/`;
o novo `SHA256SUMS.txt` contém só os dois DMGs, com nomes relativos à pasta da versão.
Mantenedores que publicam/editam a release são a fronteira de confiança: isso não é
uma atestação criptográfica ligando os assets ao run contra um mantenedor malicioso.

Todos os versionados são conferidos antes da primeira escrita. Objeto existente com
outros bytes falha; igual é reaproveitado. O cache versionado deve ser
`public, max-age=31536000`. O job antigo de downloads continua criando versionados:
se ele ou um upload manual deixou cache diferente, o dono deve ajustar **somente o
metadado**, após conferir o SHA-256, antes da promoção. O publicador não reescreve
objetos imutáveis para corrigir metadados.

O estável recebe `versao=X.Y.Z[-rc.N]`, `public, max-age=300` e os mesmos bytes/MD5 do
versionado. Estável legado sem versão falha fechado: identifique a versão comparando
SHA-256 com uma release/versionado conhecido e grave `versao` manualmente, usando
precondições de geração/metageração. Nunca adote uma versão só pelo nome estável.
Versão inferior sobe só o versionado; somente `permitir_voltar=true` libera downgrade.

A fila é global e não cancela uma publicação em andamento. GCS não tem transação
entre os dois objetos estáveis: falha entre cópias pode deixar versões diferentes.
Repita a mesma tag; ela reconcilia o estado parcial sem recópia dos objetos já corretos.
Não há rollback compensatório automático. Erro 412 significa concorrência: a execução
falha, e a repetição relê e verifica os bytes antes de tentar novamente.

Conferência real depois da ativação: run verde em até 15 minutos; dois DMGs e
`SHA256SUMS.txt` versionados; SHA-256 igual à release; MD5, versão e cache dos dois
estáveis; HEAD público 200 com tamanho correto; `/download/mac` e `/download/mac-intel`
respondendo 302 para os estáveis. O script verifica os URLs com uma query de diagnóstico
para evitar cache antigo; usuários podem observar o cache anterior por até 300 segundos.
Não declarar o aceite real com base apenas nos testes simulados. Desligar o gate interrompe
novos dispatches de publicação; não altera arquivos já publicados nem cancela execução ativa.
