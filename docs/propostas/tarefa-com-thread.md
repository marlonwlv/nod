# Especificação de implementação — Tarefa com sessão/Thread

Data: 2026-11-22

Base examinada: `origin/main` em `3315e2fe`

Decisão: [ADR-192](../adr/adr-192-tarefa-e-objetivo-thread-e-contexto-turno-e-execucao.md)
Evidências: [diagnóstico do ciclo](../evidencias/diagnostico-ciclo-das-tarefas-2026-11-20.md) ·
[diagrama antes/depois](arquitetura-tarefa-sessao.html)

Esta especificação é o handoff para uma sessão limpa implementar do zero. Ela não contém código de produto e não
depende de nenhuma implementação parcial anterior.

## Resultado esperado

Na interface, a pessoa continua usando “+ Nova tarefa” e “Tarefas”. Cada Tarefa passa a representar um objetivo
persistente, com conversa dedicada e aceite humano. O fim de um turno deixa de fechar o objetivo. O runtime atual de
`trabalhos` e `turnos` permanece operando durante uma migração aditiva.

## Taxonomia e invariantes

| Conceito | Responsabilidade | Fonte de verdade |
|---|---|---|
| Tarefa | Objetivo, entrega, resolução, reabertura e arquivo | nova tabela `tarefas` + histórico |
| Thread | Conversa/contexto durável da Tarefa | nova tabela `threads`; mensagens ligadas a ela |
| Turno | Uma execução atômica | `turnos` existente |
| Atividade | Sinal atual: trabalhando, precisa de você, em espera, interrompida | projeção; não criar tabela |
| Trabalho | Runtime legado: sessão CLI, pasta, máquina, custo, coordenação | `trabalhos` existente durante a migração |
| Card | Workflow opcional do Quadro | `quadro_tarefas` existente |

Invariantes obrigatórios:

1. Criar uma Tarefa pelo fluxo novo cria a Tarefa e sua Thread primária na mesma transação, ou não cria nenhuma.
2. No MVP toda Tarefa nova tem uma Thread primária; o banco permite 1:N futuro.
3. Um Turno pertence a no máximo uma Thread e pode continuar ligado a um `trabalho_id` legado.
4. Terminar, falhar ou interromper um Turno nunca grava `resolvida` na Tarefa.
5. Só uma ação explícita da pessoa grava resolução no MVP, com autoria e timestamp.
6. Reabrir e arquivar nunca apagam mensagens, turnos, decisões, entregas ou vínculos.
7. Atividade é calculada; nenhum caso de uso a persiste.
8. O Card não é requisito para criar, ler, continuar ou resolver uma Tarefa.
9. Eventos só são publicados depois do commit; consumidores antigos continuam recebendo os frames legados enquanto
   houver leitura antiga.
10. Toda tabela nova recebe RLS por `nod_escopar_tabela`; toda mutação de pessoa entra no registro de ações.

## Arquitetura atual comprovada

### Dados e domínio

- [`conversas`](../../src/db/migrations/0002_dominio.sql) guarda a conversa própria do bot e `sessao_cli`; mensagens e
  turnos apontam para ela.
- [`trabalhos`](../../src/db/migrations/0063_trabalhos.sql) concentra título, origem, estado, sessão CLI, pasta,
  memória, custo e tempos. Migrações posteriores acrescentam `forma`, lote, resumo, máquina da sessão, repo e
  `tarefa_id` de Card.
- [`turnos`](../../src/contracts/turno.ts) tem os estados `pendente`, `despachando`, `concluido` e `interrompido`.
  `turnos.trabalho_id` cria a faixa de execução de um trabalho.
- [`estadoDoTrabalho`](../../src/domain/trabalho.ts) deriva `na_fila`, `rodando`, `precisa_de_voce`,
  `fechado_ocioso`, `terminado`, `parado` ou `falhou`. Sem fatos vivos, último turno `concluido` resulta em
  `terminado`.
- [`quadro_tarefas`](../../src/db/migrations/0133_quadros.sql) é outro agregado: título, descrição, status,
  responsável, Linear, PR, pergunta, resposta e turno. [`trabalhos.tarefa_id`](../../src/db/migrations/0164_trabalho_da_tarefa_em_tarefa_id.sql)
  liga trabalhos do quadro e frentes filhas a esse Card.

### Casos de uso atuais

- [`abrirTarefaDaPessoa`](../../src/use-cases/coordenar-trabalhos.ts) atende “+ Nova tarefa” e cria mensagem, lote,
  trabalho/frente e primeiro turno.
- [`abrirLote`](../../src/use-cases/frentes.ts) cria um lote, N trabalhos e os primeiros turnos; `devolver_resumo`
  grava relato, mas não decide o estado.
- [`sincronizarTrabalho`](../../src/use-cases/trabalhos.ts) relê fatos estruturados e grava a projeção em `trabalhos`.
- [`assentar-turno`](../../src/use-cases/assentar-turno.ts) transforma sucesso do executor em `turno.concluido` e
  sincroniza o trabalho.
- [`fechar-lote`](../../src/use-cases/fechar-lote.ts) retorna os resumos à conversa do dono quando as frentes ficam
  terminais.
- [`quadro-execucoes`](../../src/use-cases/quadro-execucoes.ts) adiciona às tarefas de Card o protocolo de saída e as
  tentativas que a Tarefa genérica não possui.

### APIs e eventos atuais

As rotas reais estão em [`rotas/trabalhos.ts`](../../src/adapters/http/rotas/trabalhos.ts):

- `GET /trabalhos?agenteId=` e `GET /trabalhos/:id`;
- `POST /agentes/:id/trabalhos`;
- `POST /trabalhos/:id/mensagens`, `/parar`, `/encerrar`, `/titulo`, `/depois` e `/fazer-aqui`;
- `POST /trabalhos/:id/rodar-desta-vez` em `rotas/maquinas.ts`;
- rotas de trabalhos do Card sob `/agentes/:id/quadro/tarefas/:tarefa/trabalhos`.

O outbox publica `turno.iniciado`, `turno.encerrado`, `turno.interrompido`, `trabalho.mudou` e `quadro.mudou`.
Enquanto o turno vive, `turno.atividade` é o nome histórico de um frame de ferramenta; isso não deve ser confundido
com a atividade derivada desta especificação.

### Antes e depois

```text
ANTES

conversa própria do bot
  └─ trabalho (antiga Frente, chamada Tarefa na UI)
       ├─ sessão CLI + pasta + máquina + custo
       ├─ mensagens filtradas pelos seus turnos
       └─ turnos N
            └─ último concluído => trabalho terminado

quadro_tarefas (Card)
  └─ trabalho origem=quadro ── trabalhos.tarefa_id ──> Card
```

```text
DEPOIS

Tarefa (objetivo e estado de negócio)
  ├─ Thread primária (conversa/contexto durável; MVP 1:1, schema 1:N)
  │    ├─ mensagens N
  │    └─ turnos N ──> trabalho legado/runtime opcional
  ├─ entregas/resoluções/reaberturas/arquivamentos no histórico
  └─ Card opcional (workflow/projeção)

atividade atual = projetar(turnos vivos, decisões, esperas, interrupções)
```

## Modelo de dados mínimo

Os nomes abaixo são propostos. A implementação deve manter a cerca aditiva das migrações e trazer rollback executável.

### `tarefas`

```sql
id uuid primary key composto com tenant_id
agente_id uuid not null
titulo text not null
estado text not null check (... nao_iniciada, em_andamento, entregue, resolvida, arquivada ...)
entregue_em timestamptz null
entregue_por_tipo text null
entregue_por_id uuid null
resolvida_em timestamptz null
resolvida_por uuid null
arquivada_em timestamptz null
criado_em timestamptz not null
atualizado_em timestamptz not null
```

Regras de consistência devem ligar carimbos ao estado sem apagar a história anterior. Como reabrir precisa preservar
resoluções, recomenda-se guardar transições numa tabela irmã e tratar os carimbos da linha como projeção atual.

### `tarefa_eventos`

```sql
id uuid
tarefa_id uuid not null
tipo text not null -- criada, iniciada, entregue, resolvida, reaberta, arquivada, desarquivada
autor_tipo text not null
autor_id uuid not null
turno_id uuid null
dados jsonb not null default '{}'
criado_em timestamptz not null
```

O payload é tipado por `tipo`; não colocar prosa livre sensível na trilha. Mensagens e resumos continuam nas tabelas
apagáveis adequadas, conforme ADR-004.

### `threads`

```sql
id uuid
tarefa_id uuid not null
conversa_id uuid not null
tipo text not null default 'primaria'
criado_em timestamptz not null
fechada_em timestamptz null
```

- índice por `(tenant_id, tarefa_id, criado_em)`;
- índice parcial único para uma Thread `tipo='primaria'` por Tarefa no MVP;
- **não** criar `UNIQUE(tarefa_id)` geral;
- `conversa_id` pode reutilizar a infraestrutura de mensagens/SSE, mas deve ser uma conversa dedicada, não a conversa
  principal do bot.

### Vínculos aditivos

```sql
ALTER TABLE turnos ADD COLUMN thread_id uuid null;
ALTER TABLE trabalhos ADD COLUMN tarefa_objetivo_id uuid null;
ALTER TABLE quadro_tarefas ADD COLUMN tarefa_objetivo_id uuid null;
ALTER TABLE rotinas ADD COLUMN tarefa_objetivo_id uuid null; -- somente se a etapa de compatibilidade provar necessidade
```

Não reutilizar `trabalhos.tarefa_id`: hoje esse campo significa Card do Quadro e tem semântica dupla documentada. O
nome explícito `tarefa_objetivo_id` evita uma migração ambígua.

## Estados e projeções

### Transições da Tarefa

| De | Comando/fato | Para | Autor obrigatório |
|---|---|---|---|
| criação | criar | `nao_iniciada` ou `em_andamento` se o primeiro turno nasce junto | pessoa |
| `nao_iniciada` | primeiro turno começa | `em_andamento` | sistema, referindo o turno |
| `em_andamento` | bot entrega resultado | `entregue` | agente, referindo o turno |
| `entregue` | continuar | `em_andamento` | pessoa |
| `entregue` | resolver | `resolvida` | pessoa |
| `resolvida` | reabrir | `em_andamento` | pessoa |
| qualquer não arquivada | arquivar | `arquivada` | pessoa |
| `arquivada` | reabrir/desarquivar | estado anterior ou `em_andamento` | pessoa |

Um turno interrompido não muda sozinho o estado de negócio; apenas a atividade passa a `interrompida`. Uma entrega
posterior substitui a entrega vigente na projeção, mas ambas ficam no histórico.

### Algoritmo de atividade derivada

Calcular por Tarefa, usando turnos ligados à(s) Thread(s), decisões e esperas:

1. Se houver decisão/pergunta pendente dirigida à dona, `precisa_de_voce`.
2. Senão, se houver turno `despachando`, ou `pendente` elegível/na fila, `trabalhando`.
3. Senão, se houver despertar futuro, pedido a colega aberto, comando persistido, espera de recurso ou condição externa,
   `em_espera`.
4. Senão, se o último turno terminal for `interrompido` e não houver retomada, `interrompida`.
5. Senão, `null`.

Na primeira versão, “pendente” pode ser exibido como trabalhando/na fila dentro do detalhe; a lista usa só o vocabulário
de produto definido. A projeção deve morar em função pura do domínio, com teste de tabela, e ser montada no servidor.

## API proposta e compatibilidade

### Endpoints novos

- `POST /agentes/:agenteId/tarefas` — corpo `{texto, anexos?, levarConversa?}`; cria Tarefa + Thread + primeira
  mensagem/turno atomicamente; responde `201` com `tarefa`, `thread` e `turnoId`.
- `GET /tarefas?agenteId=&estado=&arquivadas=` — lista estado do objetivo e atividade projetada.
- `GET /tarefas/:id` — detalhe da Tarefa e Thread primária, incluindo mensagens, passos, decisões e atividade.
- `POST /tarefas/:id/mensagens` — ação **Continuar**/mensagem; grava na Thread e absorve ou enfileira Turno.
- `POST /tarefas/:id/resolver` — ação da pessoa; exige versão/ETag para corrida e grava autoria/timestamp.
- `POST /tarefas/:id/reabrir` — preserva histórico e cria continuação na Thread existente no MVP.
- `POST /tarefas/:id/arquivar` — arquiva sem apagar; se houver Turno vivo, exigir escolha explícita entre parar e manter
  rodando, não inferir.
- `POST /tarefas/:id/titulo` — renomeia o objetivo, sem renomear Card implicitamente.

Registrar as mutações em `src/domain/acoes/`, atualizar `docs/paridade.md` e oferecer caminho equivalente pelo chat
para os botões novos, conforme ADR-135.

### Eventos

Publicar `tarefa.mudou` com ids e motivo mínimo; o cliente reidrata por REST. Eventos de domínio/outbox sugeridos:

- `tarefa_criada`, `tarefa_iniciada`, `tarefa_entregue`, `tarefa_resolvida`, `tarefa_reaberta`,
  `tarefa_arquivada`, `tarefa_desarquivada`;
- `thread_criada` e, quando 1:N existir, `thread_fechada`;
- manter `turno_*`, `trabalho_mudou` e `quadro_mudou` atuais.

Não criar eventos `atividade_*`: atividade é projeção. Durante a transição, qualquer mutação que altere seus fatos
publica o evento factual já existente e `tarefa.mudou` para reidratação.

### Adaptadores legados

1. `POST /agentes/:id/trabalhos` chama internamente o novo caso de uso quando a flag de escrita estiver ligada e devolve
   o DTO antigo do `trabalho` vinculado.
2. `GET /trabalhos*` continua lendo a projeção atual até a virada; em shadow read, comparar estado/atividade novos sem
   alterar resposta.
3. `POST /trabalhos/:id/mensagens` resolve `tarefa_objetivo_id` e escreve na Thread; trabalhos sem vínculo seguem no
   caminho antigo.
4. `trabalho.mudou` continua saindo; clientes novos usam `tarefa.mudou`.
5. `devolver_resumo` passa a registrar entrega da Tarefa vinculada apenas quando o turno realmente entregou um
   resultado. `falta` não resolve a Tarefa e não deve ser usado como parser de estado.

## Relação com Card/Quadro

### Ponte inicial

- `quadro_tarefas.tarefa_objetivo_id` é opcional e usa `ON DELETE SET NULL` se exclusão física de Tarefa algum dia
  existir; arquivamento não mexe no vínculo.
- Criar Card não cria automaticamente Tarefa no primeiro rollout. Criar uma Tarefa a partir de um Card pode criar o
  vínculo explicitamente.
- Um trabalho `origem='quadro'` ligado a Card resolve também sua Tarefa de núcleo, se houver, para que turnos e
  mensagens caiam na Thread correta.
- Coluna `feito` e estado `resolvida` não sincronizam automaticamente. `quem_fecha='pessoa'` pode, numa etapa futura,
  oferecer “Marcar Card como Feito e resolver Tarefa” como uma única ação explícita e auditada.

### Riscos de cardinalidade

- **Tarefa 1 — 1 Card:** simples no MVP, mas bloqueia mostrar o mesmo objetivo em dois quadros ou migrar de quadro sem
  identidade. Não impor unique global antes de medir.
- **Tarefa 1 — N Cards:** flexível, porém dois Cards podem divergir em coluna/responsável. A Tarefa continua dona da
  resolução; cada Card é dono do seu workflow.
- **Card 1 — N Tarefas:** não suportar. Um Card com vários objetivos deve ser desmembrado; a ambiguidade inviabiliza
  resolução e histórico.
- **Substituir Card por Tarefa:** só depois de provar que campos e comportamentos de quadro cabem como projeção; não faz
  parte deste plano.

## Migração incremental

### Etapa 0 — testes de caracterização e métricas

- Fixar em testes o comportamento atual de criação, assentamento, decisões, reabertura, lotes, rotina e quadro.
- Medir trabalhos por `origem`/`forma`, Cards ligados e antigas tarefas terminais.
- Adicionar shadow helper da atividade derivada, sem mudar UI.

### Etapa 1 — schema e domínio aditivos

- Criar `tarefas`, `tarefa_eventos` e `threads`; adicionar FKs nulas.
- Implementar regras puras de transição e atividade.
- Gates: RLS, migração aditiva, rollback ida-e-volta, domínio puro e tipos.

### Etapa 2 — criação nova com dual-write

- Trocar “+ Nova tarefa” para um caso de uso transacional único que cria Tarefa, Thread, conversa dedicada, trabalho
  runtime e primeiro turno.
- Manter resposta e eventos legados.
- Flag de escrita permite rollback de código sem apagar schema/dados.

### Etapa 3 — leitura e ações de produto

- Lista e detalhe passam a ler Tarefa + atividade; detalhe usa a Thread.
- Implementar Continuar, Resolver, Reabrir e Arquivar.
- Conversa principal mostra só card/resumo compacto e reidrata pelo id da Tarefa.
- Não remover rotas antigas.

### Etapa 4 — backfill compatível

Backfill idempotente, retomável e com chave de origem:

- trabalho `forma='frente'`, origem pessoa/rede e sem Card: uma Tarefa + Thread por trabalho;
- Card: uma Tarefa por Card somente quando houver trabalho/mensagem que justifique o objetivo; trabalhos já ligados
  pelo atual `trabalhos.tarefa_id` apontam para ela;
- frentes filhas do mesmo objetivo podem herdar a Tarefa do trabalho/turno pai quando a relação for inequívoca;
- casos ambíguos ficam separados; nunca unir por título;
- trabalhos `terminado` viram `entregue`, não `resolvida`;
- `parado`/`falhou` antigos viram Tarefa não resolvida com atividade ausente ou interrompida conforme o último turno;
- rotinas históricas não geram uma Tarefa por execução; preservar seus trabalhos e ligá-los apenas quando já houver
  objetivo explícito;
- retornos de lote continuam apontando para trabalhos e passam a incluir `tarefaId` quando disponível.

Gerar relatório de contagem antes/depois e executar o backfill duas vezes em teste para provar idempotência.

### Etapa 5 — virar leitura e reduzir dualidade

- Shadow read deve ficar sem divergências conhecidas por sete dias.
- Virar a tela Tarefas e a conversa principal para o read model novo.
- Decidir depois, em ADR própria, se `trabalhos` vira apenas runtime permanente ou pode ser contraído.
- Não remover tabela, coluna, evento ou rota enquanto houver app/servidor anterior suportado.

## Experiência detalhada

### Lista Tarefas

Cada linha mostra título, bot, estado do objetivo e, se existir, atividade atual. Exemplos: “Entregue · precisa de
você”, “Em andamento · trabalhando”, “Resolvida” e “Arquivada”. “Entregue” nunca aparece como “Resolvida”.

### Detalhe

O detalhe é a conversa dedicada da Thread. Mostra pedido inicial, mensagens, passos ao vivo, decisões e entrega. Não
mostra as palavras Thread ou Turno. O composer usa “Continuar tarefa” quando não há execução viva.

### Conversa principal

Ao criar/atualizar uma Tarefa, inserir ou atualizar um card compacto com título, estado, atividade e última entrega.
Abrir o card leva ao detalhe. Perguntas podem manter a sinalização “precisa de você”, mas a resposta pertence à Thread
e não deve gerar duas decisões.

### Ações

- **Continuar:** válida em `entregue`, `resolvida` (reabre primeiro), `interrompida` e sem atividade; cria Turno na
  Thread.
- **Marcar como resolvida:** só pessoa; idempotente; se houver Turno vivo, pede decisão explícita, nunca mata execução
  silenciosamente.
- **Reabrir:** preserva evento de resolução e volta a `em_andamento`.
- **Arquivar:** esconde da lista padrão, preserva tudo; arquivada pode ser reaberta/desarquivada.

## Localhost e processos

Fica fora de escopo implementar serviço persistente. O grupo do Turno continua sendo encerrado, incluindo descendentes
e fugitivos marcados. Registrar para ADR futura uma operação de preview supervisionado com processo, porta, healthcheck,
Tarefa dona, TTL, autenticação/bind e ação de encerrar. Até lá, entregas interativas devem usar preview publicado,
build estático, screenshot ou vídeo; não usar `nohup`, `disown` ou `setsid` como contrato.

## Plano de testes

### Unidade/domínio

- tabela completa de transições da Tarefa, incluindo idempotência e autoria;
- fim de Turno concluído/falhado/interrompido não resolve Tarefa;
- atividade derivada com precedência: decisão > turno vivo > espera > interrupção > ausente;
- 1:N futuro permitido no domínio, uma Thread primária no MVP;
- projeção antiga `estadoDoTrabalho` caracterizada para o adaptador.

### Integração

- criação atômica: falha em qualquer insert não deixa Tarefa, Thread, conversa ou trabalho órfão;
- RLS por tenant e pessoa nas tabelas novas;
- resolver grava pessoa e timestamp; reabrir/arquivar preserva eventos e mensagens;
- backfill idempotente e antigas terminadas ficam `entregue`;
- dual-write mantém `trabalho_id`, `thread_id` e `tarefa_objetivo_id` coerentes;
- Card opcional não é requisito e exclusão/arquivo do Card não apaga a Tarefa;
- rotina e lote mantêm comportamento anterior.

### Concorrência

- dois cliques em resolver geram uma resolução lógica;
- Continuar concorrendo com Resolver não perde mensagem nem resolve execução nova por engano;
- Reabrir concorrendo com Arquivar termina em estado versionado previsível;
- dois pedidos de criação com a mesma chave idempotente criam uma Tarefa/Thread;
- resposta a decisão concorrendo com assentamento projeta uma única atividade correta.

### HTTP/web

- contratos e erros das rotas novas;
- lista separa estado e atividade; detalhe renderiza Thread sem vocabulário técnico;
- card compacto na conversa principal reidrata por `tarefa.mudou`;
- ações têm registro/paridade e caminho no chat;
- acessibilidade, navegação por teclado, celular e estados vazio/carregando/erro.

### Compatibilidade e migração

- cliente antigo recebe `trabalho.mudou` e rotas antigas após dual-write;
- servidor antigo ignora colunas/tabelas novas após rollback de código;
- migração passa `fence:migrations` e rollback ida-e-volta;
- `gitleaks`, lint, typecheck, unit, integration, conformidade e concorrência passam no `npm run check`.

## Critérios de aceite para a sessão de implementação

- [ ] “+ Nova tarefa” cria atomicamente Tarefa + Thread dedicada e abre o detalhe.
- [ ] A pessoa nunca vê “Thread” nem “Turno” na UI.
- [ ] Lista e detalhe mostram estado do objetivo separado da atividade atual.
- [ ] Encerrar qualquer Turno não marca a Tarefa como resolvida.
- [ ] Entrega do bot deixa a Tarefa `entregue`; só ação humana a torna `resolvida`.
- [ ] Resolver registra autoria e timestamp; Reabrir e Arquivar preservam todo o histórico.
- [ ] Continuar cria novo Turno na mesma Thread do MVP.
- [ ] Conversa principal recebe card/resumo compacto, sem duplicar o detalhe.
- [ ] Tarefa funciona sem Card; Card pode ser vinculado sem unificação big-bang.
- [ ] Tarefas antigas `terminado` migram para `entregue`, nunca `resolvida`.
- [ ] Rotinas, Cards, lotes e retornos antigos continuam funcionando.
- [ ] Atividade é projeção, sem tabela/eventos próprios.
- [ ] O cleanup de localhost permanece e o fora de escopo está documentado.
- [ ] Testes de unidade, integração, concorrência, HTTP/web, migração, RLS e compatibilidade passam.
- [ ] `npm run check`, validação de links e `gitleaks` passam antes do PR da implementação.

## Ordem sugerida de leitura para a sessão limpa

1. [ADR-192](../adr/adr-192-tarefa-e-objetivo-thread-e-contexto-turno-e-execucao.md).
2. [Diagnóstico do ciclo](../evidencias/diagnostico-ciclo-das-tarefas-2026-11-20.md).
3. [ADR-187](../adr/adr-187-tarefas-a-frente-com-outro-nome.md),
   [ADR-083](../adr/adr-083-trabalhos-paralelos-a-conversa-coordena.md),
   [ADR-159](../adr/adr-159-a-tarefa-e-a-casa-do-trabalho.md) e
   [ADR-163](../adr/adr-163-tarefa-do-quadro-e-trabalho.md).
4. `src/contracts/trabalho.ts`, `src/domain/trabalho.ts`, `src/use-cases/trabalhos.ts`,
   `src/use-cases/coordenar-trabalhos.ts`, `src/use-cases/frentes.ts`, `src/use-cases/assentar-turno.ts` e
   `src/adapters/http/rotas/trabalhos.ts`.
5. Migrações `0063`, `0071`, `0133`, `0157`, `0163`, `0164` e as regras de migração do `AGENTS.md`.
