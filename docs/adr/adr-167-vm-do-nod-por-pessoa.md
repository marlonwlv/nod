# ADR-167 — A VM do Nod: a terceira opção de onde o agente roda

Status: proposta · Data: 2026-11-12 (decisão 1 do Marlon sobre o Grok Bot) · Estende a
[ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) e a [ADR-121](adr-121-caminho-b-a-vm-na-conta-de-nuvem-da-pessoa.md).

## Contexto

No Grok Bot o agente não roda no Mac: cada usuário tem uma "box", uma VM na nuvem do fornecedor onde moram o agente, o
navegador e o terminal, e o Mac é um cliente fino que empresta ferramentas. O nod roda o motor na máquina da pessoa (o
diferencial de custo: a assinatura e o harness são dela) ou numa VM que ela mesma configura. O Marlon decidiu as três:

1. **Máquina da pessoa** — o padrão, o primeiro que quase todo mundo usa;
2. **VM própria da pessoa** — como ele já faz hoje (ADR-090; ADR-121 para dormir e acordar pelo Google);
3. **VM do Nod, paga** — a pessoa contrata e o nod cuida de uma VM só dela, o modelo da box.

## Decisão

1. **A VM do Nod é uma máquina como as outras** (ADR-090 item 1): o motor nela pareia com uma chave de máquina, recebe os
   turnos pela ponte e anuncia o computador (ADR-122). Turno, `alvoDoTurno`, ponte, motor e computador não mudam. O que
   muda é QUEM paga e em que conta ela mora: no projeto de nuvem do nod, não no da pessoa.
2. **Uma VM por pessoa**, nome estável `nod-box-<20 hex do id da pessoa>` (`nomeDaVmDoNod`), rótulos `nod-box=1` e
   `nod-plano=<plano>`, sem e-mail. Todos os bots da pessoa dividem a VM, como na box do Grok Bot (persona, memória e
   workspace separados por bot; hardware em comum).
3. **O provisionamento é uma interface com driver** (`ProvisionadorVmDoNod`, `src/adapters/nuvem/vm-do-nod.ts`):
   - `seco` (padrão): monta o pedido exato que iria ao Google (`compute.instances.insert`, tipo, zona, rótulos, `requestId`)
     e o devolve como previsão, **sem chamar a rede**;
   - `gcp`: o MESMO `ProvedorNuvem` da ADR-121 (criar, ligar, desligar, excluir, estado), com a conta de serviço do projeto
     do nod. O `requestId` é um UUID derivado do pedido: a segunda tentativa não cria outra VM (o Google dá 409).
   O ciclo depois de criada (acordar com trabalho, dormir ociosa, motor sem contato, reiniciar uma vez) é o reconciliador
   da ADR-121, que já opera qualquer `ProvedorNuvem`.
4. **Planos provisórios** (`PLANOS_VM_DO_NOD_PADRAO`): Essencial (e2-standard-4, 4 vCPU, 16 GB, 200 h acordada,
   R$ 199/mês) e Pro (e2-standard-8, 8 vCPU, 32 GB, 400 h, R$ 399/mês) — os dois tamanhos que o `gcp.ts` já cria. Preços
   SEM medição de custo; o servidor troca por `NOD_VM_DO_NOD_PLANOS` (JSON) sem publicar versão.
5. **Flags.** `NOD_VM_DO_NOD=1` liga a opção; `NOD_VM_DO_NOD_DRIVER=gcp` liga o driver real (padrão `seco`). Sem a
   primeira, a tela mostra a opção "Em teste fechado".
6. **Tela.** "Onde o agente roda", no topo de Máquinas (`web/telas/onde-roda.ts`, componentes `grupoConfig`/`linhaConfig`):
   as três opções, "Em uso" quando a pessoa já tem uma máquina daquele tipo, "Padrão" na primeira, os planos com preço na
   terceira. Lida por `GET /api/t/:t/maquinas/onde-roda` junto com a lista de máquinas.

## Fora deste recorte (próximo PR)

- **Contratar e cobrar.** Exige decidir o meio de pagamento (o Grok Bot pede passkey para gasto) e o projeto do nod. O
  pedido (`pedidoVmDoNod`) já exige o aceite explícito da cobrança (`nao_permitido` sem ele). A ação entra no registro
  (`maquinas.contratar_vm_do_nod`, risco `arriscada`) com caminho no chat, junto com a rota `POST`.
- **Persistência.** Uma coluna `do_nod boolean` (ou `credencial_id` nulo com dono "nod") em `maquinas_nuvem`, migração
  aditiva com rollback, para o reconciliador saber que a VM é do projeto do nod. Não foi escrita aqui porque o Postgres
  desta máquina não estava de pé para rodar o teste de ida e volta.
- **Pareamento automático** pelo `startup-script` com convite pré-aprovado (o mesmo da ADR-121, PR 2).
- **Retenção.** Encerrar a assinatura vira snapshot do disco por N dias antes de apagar.

## Gatilho de reversão

Se o custo medido de uma VM por pessoa (compute + disco, com o sono da ADR-121) passar de 60% do preço do plano em 30 dias
de teste fechado, a VM do Nod passa a ser compartilhada (vários usuários por host, isolados como os computadores do
Docker da ADR-037) em vez de uma por pessoa.
