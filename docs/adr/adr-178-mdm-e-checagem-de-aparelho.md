# ADR-178: MDM (só origem https) e checagem de aparelho no teste grátis

Status: proposta (2026-11-12, frente "Assistente pessoal"; decisão "MDM e checagem de aparelho", com "teto de modo do
admin, já agora").

## Contexto

Assistentes de referência aceitam configuração gerenciada: user defaults `DeploymentBackendUrl` e `DeploymentWebsiteUrl` e um `policy.json`,
e limitam o teste grátis com DeviceCheck e detecção de VM.

## Decisão

1. **Política do MDM** (src/domain/mdm.ts; leitura no Mac em desktop/mdm.ts, atrás de `NOD_MDM=1`): só origem https
   (host e porta, sem caminho, consulta ou usuário), `tetoModoAprovacao` (o modo do bot nunca passa dele, `modoComTeto`),
   `ferramentasDoMacTravadas` e `semTesteGratis`. O que não serve é ignorado com o erro escrito; o app sobe com o padrão,
   nunca com meia política.
2. **Teste grátis um por aparelho**: o token do DeviceCheck vai ao servidor, que lê os dois bits na Apple; bit 0 = já usou.
   VM nunca ganha (`kern.hv_vmm_present`, modelo "VirtualMac"), nem quando a empresa desliga. Driver de teste em memória
   (src/adapters/checagem-aparelho/teste.ts); o real atrás de `NOD_DEVICECHECK=1`.

## O que falta

Ligar a política na janela do app (servidor e site vindos do MDM, teto aplicado na troca de modo) e o driver real do
DeviceCheck (JWT ES256 com a chave .p8 do time da Apple) e a rota do teste grátis.

## Gatilho de reversão

Se um cliente empresa precisar de URL com caminho (proxy reverso em subpasta), aceitar caminho fixo sem consulta, nunca http.

## Porte (NOD-485)

MDM no público (é do app). DeviceCheck e teste grátis são da cobrança: `gamefik/nod-fechado`.
