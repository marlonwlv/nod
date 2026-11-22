# ADR-192 — Tarefa é objetivo, Thread é contexto e Turno é execução

Status: proposta (2026-11-22, decisão de produto) · Substitui a equivalência entre Tarefa e Frente da
[ADR-187](adr-187-tarefas-a-frente-com-outro-nome.md), preserva o quadro como plugin e refina as
[ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md),
[ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md),
[ADR-159](adr-159-a-tarefa-e-a-casa-do-trabalho.md) e
[ADR-163](adr-163-tarefa-do-quadro-e-trabalho.md). Especificação:
[Tarefa com sessão/Thread](../propostas/tarefa-com-thread.md). Evidências:
[diagnóstico do ciclo atual](../evidencias/diagnostico-ciclo-das-tarefas-2026-11-20.md) e
[diagrama navegável](../propostas/arquitetura-tarefa-sessao.html).

## Contexto

A antiga Frente foi renomeada para Tarefa na interface, mas `trabalhos` continua no meio de três conceitos:

- o objetivo durável que a pessoa quer acompanhar;
- a conversa/contexto do trabalho;
- a execução do agente, com sessão de CLI, pasta, máquina, custo e desfecho.

Hoje, quando o último turno termina com sucesso e não há decisão, colega, despertar ou comando pendente,
`estadoDoTrabalho` projeta `terminado`. O fim técnico de uma execução, portanto, encerra na interface algo que se chama
Tarefa, mesmo sem aceite humano e mesmo quando `devolver_resumo.falta` registra trabalho restante. Ao mesmo tempo,
processos localhost descendentes do turno são mortos deliberadamente no cleanup do grupo de processos. Os Cards do
Quadro já carregam mais semântica de tarefa — objetivo, descrição, responsável, coluna, PR, comentários e história —,
mas o quadro foi corretamente mantido como plugin e não deve virar dependência do núcleo.

## Decisão

### Linguagem do produto

1. A interface mantém **“+ Nova tarefa”** e **“Tarefas”**. A pessoa não vê “Thread” nem “Turno”.
2. **Tarefa** é o objetivo persistente. Seu ciclo de negócio independe do processo da IA.
3. **Thread** é a conversa e o contexto durável de uma Tarefa.
4. **Turno** é uma execução atômica: entra na fila, roda e termina. Um novo turno nunca substitui nem reescreve o
   anterior.
5. **Atividade não é entidade nem tabela.** É uma projeção efêmera calculada de turnos, decisões e interrupções.

### Cardinalidade

“+ Nova tarefa” cria, na mesma transação, uma Tarefa e uma Thread dedicada. No MVP a relação é 1:1 e a API expõe uma
única conversa da Tarefa. O esquema usa `threads.tarefa_id`, sem `UNIQUE(tarefa_id)`, para permitir 1:N no futuro sem
migração destrutiva. Toda Tarefa criada pelo caminho novo deve ter exatamente uma Thread primária; não há Thread órfã.

### Estados de negócio da Tarefa

A Tarefa tem exatamente um destes estados:

- `nao_iniciada`: existe, mas nenhum turno começou;
- `em_andamento`: houve execução ou continuação e ainda não houve entrega vigente;
- `entregue`: o bot entregou um resultado; o objetivo aguarda avaliação da pessoa;
- `resolvida`: a pessoa aceitou explicitamente o objetivo;
- `arquivada`: foi retirada das listas ativas, sem apagar o histórico.

Terminar um turno, com sucesso ou falha, nunca resolve a Tarefa. A resolução registra `resolvida_em` e
`resolvida_por`; no MVP, `resolvida_por` é a pessoa dona. A entrega registra autoria e timestamp próprios. Reabrir
preserva a resolução anterior no histórico, volta a `em_andamento` e mantém a mesma Tarefa e Thread. Arquivar preserva
Tarefa, Thread, mensagens, turnos, decisões e vínculos com o quadro.

### Atividade derivada

A lista e o detalhe calculam uma atividade atual, ortogonal ao estado do objetivo:

- `trabalhando`: existe turno vivo (`pendente` ou `despachando`) que não está parado numa decisão;
- `precisa_de_voce`: existe decisão/pergunta pendente dirigida à pessoa, com precedência sobre espera;
- `em_espera`: não há turno executando, mas há volta, colega, comando, recurso ou evento externo persistido que pode
  retomar o trabalho;
- `interrompida`: a última tentativa terminou interrompida e não existe retomada nem espera viva.

Sem esses sinais, a atividade é ausente. Um turno concluído pode tornar a Tarefa `entregue`, mas não produz uma
atividade “concluída”: conclusão pertence ao turno; resolução pertence à Tarefa.

### Experiência

- “+ Nova tarefa” cria Tarefa + Thread atomicamente e abre sua conversa dedicada.
- A lista mostra, separadamente, o estado do objetivo e a atividade atual.
- O detalhe da Tarefa é a Thread: pedido, mensagens, passos, decisões e entregas.
- A conversa principal recebe apenas um card/resumo compacto com link para a Tarefa; o histórico detalhado não é
  duplicado nela.
- Ações visíveis: **Continuar**, **Marcar como resolvida**, **Reabrir** e **Arquivar**. Continuar cria um novo turno na
  mesma Thread; resolver exige gesto da pessoa; reabrir e arquivar são reversíveis quanto ao conteúdo.

### Quadro

Não haverá unificação big-bang entre `tarefas` e `quadro_tarefas`. A migração é aditiva. Um Card pode apontar para uma
Tarefa de núcleo por FK opcional. No futuro, após medir uso e divergências, há duas saídas aceitáveis: Card como
projeção opcional da Tarefa ou Tarefa substituindo Card. Até essa decisão, coluna/status do Card e estado do objetivo
continuam dimensões diferentes e nenhuma transição implícita de “Feito” resolve uma Tarefa sem uma política explícita.

### Compatibilidade

- `trabalhos` continua como runtime e adaptador legado durante a migração; sessão de CLI, pasta, máquina e custo não
  migram para Thread.
- Tarefas antigas terminadas viram `entregue`, nunca `resolvida`, porque não houve aceite humano.
- Frentes de lote, retornos de lote, rotinas e trabalhos de quadro continuam pelos caminhos atuais enquanto o vínculo
  novo é preenchido de forma aditiva.
- Rotina não cria Tarefa por janela automaticamente. Ela só se vincula a uma Tarefa quando já existe um objetivo
  acompanhável ou quando o caso de produto pedir explicitamente a criação.

### Fora de escopo

Um serviço supervisionado de preview localhost não faz parte desta mudança. O cleanup atual de processos permanece.
Uma decisão futura poderá introduzir preview com posse, porta, saúde, TTL e encerramento explícito; ensinar processos a
escapar do grupo do turno não é alternativa aceita.

## Consequências

- O núcleo ganha identidade própria para objetivo (`tarefas`) e contexto (`threads`), sem acoplar o quadro.
- O estado de produto deixa de ser inferido do exit code do executor.
- A UI precisa renderizar duas dimensões: estado da Tarefa e atividade derivada.
- A transição exige dual-read/dual-write temporários e eventos compatíveis; renomear ou remover `trabalhos` não é parte
  desta ADR.
- A cardinalidade física preparada para 1:N custa pouca complexidade agora e evita uma migração destrutiva depois.

## Alternativas descartadas

- **Só renomear `terminado` para “entregue”.** Corrige parte do texto, mas não cria resolução humana, Thread própria,
  reabertura de objetivo nem ponte estável com Card.
- **Fazer `quadro_tarefas` ser a Tarefa de núcleo.** Obriga tarefas simples, rotinas e conversa a dependerem do plugin
  de quadro e contradiz a ADR-187.
- **Usar `trabalhos` como Tarefa definitiva.** Mantém objetivo, contexto e runtime misturados; a sessão e o desfecho do
  executor continuariam governando o produto.
- **Criar uma tabela `atividades`.** Duplica o que `turnos`, decisões e esperas já registram. A projeção resolve a tela
  sem uma nova fonte de verdade.
- **Resolver automaticamente quando o bot entrega.** Repete o problema atual: autoavaliação da execução no lugar de
  aceite do objetivo.

## Gatilhos de revisão

- Se mais de 5% das Tarefas ativas em 30 dias precisarem de dois contextos simultâneos e isolados, implementar Thread
  1:N na experiência, usando a cardinalidade já suportada pelo esquema.
- Se mais de 2% das projeções de atividade divergirem dos fatos de turno/decisão em shadow read por sete dias, não
  virar a leitura: corrigir a projeção e manter o adaptador legado.
- Se mais de 20% das Tarefas entregues forem resolvidas sem abrir o detalhe, avaliar uma ação de resolução no card da
  conversa principal; não restaurar resolução automática.
- Se Card e Tarefa divergirem em mais de 10% dos vínculos ativos por 30 dias, decidir explicitamente entre Card como
  projeção ou substituição do Card, antes de adicionar sincronizações bidirecionais.

## Emenda 1 — a conversa da Thread no MVP (2026-11-22, implementação da etapa 2)

Medido na implementação (mapa de dependências de `trabalhos.conversa_id` e `conversas.tipo`, 2026-11-22): mover as
mensagens e os turnos de cada Tarefa para uma conversa própria (um terceiro `tipo_conversa`) mexe em oito sistemas que
hoje leem "a conversa do bot" — o retorno do lote ao dono (`fechar-lote`), o "Fazer aqui", a linha "Você abriu a
tarefa", as pastas autorizadas do bot (`workspaces`: a tarefa perderia o acesso aos projetos), a busca e o
`ler_conversa` do bot, os não lidos (cada Tarefa viraria uma linha "bot" sem leitura), os anexos da tarefa nova e o
escopo do revisor/contaminação. Cada um precisaria de rota de volta para a conversa do bot.

Decisão: no MVP, `threads.conversa_id` aponta para a conversa onde as mensagens da Tarefa já moram — a conversa
própria do bot —, e o contexto **dedicado** da Thread é garantido por `turnos.thread_id`: a Thread é o conjunto dos
turnos dela (e das mensagens desses turnos), como a tela da task já lia pelos turnos do trabalho. Nada é perdido para a
saída futura: o schema mantém `threads.conversa_id NOT NULL` por Thread, e trocar para uma conversa dedicada é criar a
conversa e apontar a Thread nova para ela, depois de resolver os oito pontos acima. O invariante "uma Thread primária
por Tarefa, criada na mesma transação" vale sem mudança.

Gatilho de revisão: quando a Thread 1:N entrar na experiência (dois contextos isolados na mesma Tarefa), ou quando o
histórico da Tarefa precisar sair da conversa do bot (busca, retenção ou exportação por Tarefa).

## Emenda 2 — flag de escrita e autoria (2026-11-22)

- `NOD_TAREFA_OBJETIVO=0` desliga a escrita da Tarefa + Thread na criação (rollback de código sem apagar schema nem
  dados); ligada por padrão. As Tarefas já criadas seguem sincronizando pelo trabalho ligado.
- O trabalho runtime alimenta a Tarefa ligada: trabalho começou → `iniciar` (autor sistema); terminou → `entregar`
  (autor o bot, com o último turno concluído), mesmo com `falta` no resumo; parado, interrompido ou falho não mudam o
  objetivo. A fala da pessoa na tarefa é **Continuar**. "Encerrar a tarefa" (ADR-187 §6) é gesto explícito da pessoa e
  resolve a Tarefa ligada, com autoria e hora.
- `turnos.thread_id` é preenchido pelo banco (0181) para todo turno de trabalho ligado a uma Tarefa, em qualquer caminho.

## Emenda 3 — o backfill roda no servidor (2026-11-22, etapa 4)

- O backfill (`src/use-cases/backfill-tarefas.ts`, regras puras em `src/domain/backfill-tarefas.ts`) roda uma vez por
  boot, dois minutos depois de a cor ficar ativa, por pessoa e em lotes de 200, cada lote numa transação. A chave de
  origem (`trabalho:<id>`, `card:<id>`) é única: rodar de novo não duplica, e o trabalho já ligado sai da consulta.
  `NOD_TAREFAS_BACKFILL=0` desliga; `node scripts/backfill-tarefas.ts` simula (e `--aplicar` grava) com o relatório de
  contagens antes e depois.
- Frente de pessoa/rede → uma Tarefa; trabalhos de um Card → uma Tarefa por Card (a ponte no Card só quando a pessoa é
  dona dele); filha de mãe já ligada → a Tarefa da mãe; rotina, colega e as `task` antigas ficam de fora. `terminado` →
  `entregue`; parado, falho ou aberto → `em_andamento` (ou `nao_iniciada` se nunca começou). A trilha diz
  `criada {backfill: true, legado}` e, nas entregues, `entregue` na hora em que o trabalho terminou.
- O retorno do lote (`frentes_terminadas`) passa a levar `tarefaId` de cada frente ligada.

## Emenda 4 — a virada da leitura (2026-11-22, etapa 5)

- A virada está no código, atrás de `NOD_TAREFAS_LEITURA_NOVA` (desligada por padrão; `infra/gcp/config.env`). Ligada, a
  lista de trabalhos avisa a web (`leituraNovaDasTarefas`) e a tela Tarefas passa a decidir pela Tarefa: a arquivada sai da
  lista padrão (segue aberta pela linha da conversa, com Desarquivar); o estado do objetivo e a atividade já aparecem desde
  a etapa 3 em todas as telas.
- **Quando ligar:** depois de sete dias corridos, contados do deploy da etapa 0 em produção, sem divergência conhecida na
  sombra. Como medir no Cloud Logging (projeto de produção): `jsonPayload.evento="atividade_sombra_divergente"` nos
  últimos 7 dias — cada linha traz `origem`, `forma`, `estado` e `atividade`. Divergência "conhecida" é a que já tem
  motivo registrado (a decisão que sobra numa tarefa parada, por exemplo); qualquer outra corrige a projeção antes da
  virada, como manda o gatilho de revisão deste ADR (mais de 2% das projeções divergindo: não virar). Também conferir
  `backfill_tarefas` (falhas 0) e o relatório de `node scripts/backfill-tarefas.ts` (simulação: 0 Tarefas novas).
- **Como ligar:** `NOD_TAREFAS_LEITURA_NOVA=1` em `infra/gcp/config.env` num PR; desligar é voltar a `0`. Nada no banco
  muda com a flag.
- Fica para ADR própria: se `trabalhos` vira só o runtime permanente ou pode ser contraído. Nenhuma tabela, coluna, evento
  ou rota antiga sai enquanto houver app ou servidor anterior suportado (as rotas `trabalhos/*` e o frame
  `trabalho.mudou` seguem).


## Emenda 5 — o que as jornadas de QA de ponta a ponta mostraram (2026-11-22)

Sete jornadas pela tela, com o Claude Code de verdade (UI × chat, interrupções, resolver/arquivar com o bot vivo, pergunta
no meio, arquivar e desarquivar, backfill), acharam dois furos de produto e cinco de acabamento. Decidido corrigir todos:

- **A tarefa que o bot abre ganha a Tarefa na hora.** A frente de `abrir_frentes`/`abrir_task` e o turno que a rede de
  2 min promove passam por `ligarObjetivoDoTrabalhoNovo` (src/use-cases/tarefas.ts), na mesma transação, com a MESMA regra
  do backfill (`decidirBackfill`): frente de pessoa ou rede → Tarefa própria (chave `trabalho:<id>`); de um Card → a Tarefa
  do Card; filha → a da mãe; rotina, colega e `task` comum ficam de fora. Ligada antes do turno, ele nasce na Thread (0181).
  A trilha diz quem decidiu: `criada` com autor `agente` (o bot abriu) ou `sistema` (a rede). Antes, só o "+ Nova tarefa"
  fazia o dual-write e a tarefa do bot terminava como "Tarefa feita", sem Resolver nem Arquivar; o backfill só corrigia o
  passado.
- **A rota antiga da aba respeita a arquivada** (`POST trabalhos/:id/mensagens` recusa com 409, como a nova); o campo
  manda desarquivar. Antes o bot voltava a trabalhar numa Tarefa arquivada que não recebia a entrega.
- **Parar é interrupção** na atividade (`paradoPelaPessoa`, lido com os fatos do trabalho `parado`): quando o bot esperava
  um comando, o último turno já tinha concluído e a lista dizia só "Em andamento" ao lado de "Você parou a tarefa".
- **Resolver e arquivar fecham a pergunta que sobrou**, por regra (`regra:tarefa_resolvida`, `regra:tarefa_arquivada`),
  como o Parar faz; com "deixar terminar" nada fecha (o bot vivo pode precisar da resposta). Na Tarefa resolvida ou
  arquivada a tela só mostra a atividade "trabalhando" (`atividadeNoObjetivo`).
- **A conversa principal mostra a tarefa das duas origens** com o mesmo cartão vivo: a aberta pelo "+ Nova tarefa" ganha a
  linha "Você abriu uma tarefa" (a `trabalho_aberto` dela já existia, escondida), e o fim do cartão diz o objetivo
  ("Entregue às 16:13", "Resolvida") em vez de "pronta".
- Acabamento: o retorno do lote de frentes com Tarefa instrui o bot a dizer "entregue, espera a sua avaliação" (não "a
  tarefa terminou"); a tarefa parada com Tarefa perde o "Encerrar a tarefa" (duplicava "Marcar como resolvida"); a tela
  Tarefas ganha o chip "Arquivadas" com a leitura nova (`GET tarefas?estado=arquivada`).
