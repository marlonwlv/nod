# Diagnóstico do ciclo das Tarefas (antigas frentes)

Data: 20/11/2026

Escopo: `origin/main` em `7b95477f`

Natureza: diagnóstico; nenhuma correção implementada.

## Resumo executivo

Há duas causas comprovadas e independentes:

1. **“Concluída” hoje significa que a última execução do agente terminou com sucesso, não que o objetivo foi aceito pela pessoa.** Quando não há turno, decisão, colega, despertar ou comando pendente, o último turno `concluido` projeta o trabalho como `terminado`. A regra não lê o objetivo, não exige confirmação humana e não considera o campo `falta` do resumo. Portanto, uma execução que encerra normalmente após entregar resultado parcial — inclusive declarando que ainda falta algo — fecha a Tarefa.
2. **Servidores localhost abertos pela Tarefa são mortos deliberadamente no fim do turno.** O CLI roda como líder de um grupo de processos; quando ele termina, o Nod envia `SIGKILL` ao grupo e procura processos que escaparam com `setsid` pela marca `NOD_GRUPO`. Um servidor em background não é um entregável persistente no desenho atual.

A limpeza de worktrees não explica a queda imediata do localhost: ela não ocorre nas primeiras duas horas e, entre duas horas e três dias, exige PR mergeado. Pode afetar um processo excepcionalmente sobrevivente mais tarde, mas não é a causa provável do sintoma relatado.

## Fluxo completo

```text
conversa do dono
  -> abrir_frentes / abrir_task
  -> lote + trabalho(na_fila) + primeiro turno(pendente)
  -> executor prepara pasta/sessão e inicia CLI em grupo de processos próprio
  -> saída do CLI é classificada
       sucesso -> turno concluido
       stop/queda/erro -> turno interrompido (com motivo)
  -> sincronizarTrabalho relê fatos estruturados
       turno/continuação viva -> rodando/na_fila
       decisão pendente -> precisa_de_voce
       colega/despertar/comando -> rodando
       nada vivo + último turno concluido -> terminado
       nada vivo + erro -> falhou
  -> resumo explícito ou sintetizado da última fala
  -> lote final dispara um novo turno na conversa do dono com os resumos
```

## 1. Criação, início e isolamento

**Comprovado.** `abrirLote` cria um lote, um `Trabalho` por frente e um primeiro turno pendente; a criação está em [`src/use-cases/frentes.ts`](../../src/use-cases/frentes.ts), linhas 52–138. Cada trabalho recebe pasta própria `~/nod/<bot>/<slug>` em [`src/use-cases/trabalhos.ts`](../../src/use-cases/trabalhos.ts), linhas 57–71, e nasce em `na_fila` pelo repositório.

**Comprovado.** Uma Tarefa tem sessão de CLI própria quando o harness suporta retomada. A seleção da sessão está em [`src/use-cases/emitir-plano-turno.ts`](../../src/use-cases/emitir-plano-turno.ts), linhas 283–313; sem sessão retomável, a frente recebe apenas seu próprio histórico, linhas 332–335. Isso preserva contexto lógico entre turnos, mas não preserva processos do sistema operacional.

**Comprovado.** A pasta é isolada por Tarefa, mas a worktree é criada pelo agente sob regra do hook/prompt, não automaticamente para todo trabalho. A política está na [ADR-088](../adr/adr-088-limpeza-das-pastas-de-task.md), linhas 26–32.

## 2. O que marca turno e Tarefa como concluídos

**Comprovado.** Um resultado de executor com `desfecho === "sucesso"` vira turno `concluido` em [`src/use-cases/assentar-turno.ts`](../../src/use-cases/assentar-turno.ts), linhas 149–153. Após persistir o resultado, o assentamento chama a sincronização do trabalho, linhas 547–565.

**Comprovado.** A Tarefa não possui um avaliador de objetivo. `estadoDoTrabalho` usa apenas fatos operacionais em [`src/domain/trabalho.ts`](../../src/domain/trabalho.ts), linhas 280–350. A decisão final é direta: sem continuação viva, `ultimo.estado === "concluido"` retorna `terminado` (linhas 339–350). Os fatos vêm da consulta em [`src/repositories/trabalhos.repo.ts`](../../src/repositories/trabalhos.repo.ts), linhas 439–478: turnos vivos, decisão pendente, colega, despertar, comando e último turno terminal.

**Comprovado.** `devolver_resumo` apenas valida e grava o resumo; ele não altera o estado. Veja [`src/use-cases/frentes.ts`](../../src/use-cases/frentes.ts), linhas 208–224. Seu contrato aceita `falta` e ainda manda encerrar o turno em [`src/contracts/ferramentas-frente.ts`](../../src/contracts/ferramentas-frente.ts), linhas 55–66.

**Prova direta já codificada.** O teste de integração em [`tests/integration/frentes-abrir.test.ts`](../../tests/integration/frentes-abrir.test.ts), linhas 190–216, grava `falta: "esperar a CI"`, assenta o turno como `concluido` e espera o trabalho em `terminado`. Se o agente nem chamar `devolver_resumo`, [`src/use-cases/resumo-sem-chamada.ts`](../../src/use-cases/resumo-sem-chamada.ts), linhas 10–20, sintetiza o resumo da última fala; a ausência da chamada também não impede o fechamento.

### Sessão terminou versus objetivo concluído

- `turno.concluido`: o processo do agente terminou normalmente.
- `trabalho.terminado`: não há continuação estruturada e o último turno terminou normalmente.
- “objetivo aceito pela pessoa”: **não é estado nem condição do fluxo genérico de Tarefas**.

Logo, a interface está atribuindo semântica de produto (“concluída”) a um estado de execução (“o agente terminou sem erro”). Esta é a causa mais provável e comprovada do primeiro sintoma.

## 3. Perguntas, bloqueios, parciais e validação humana

**Comprovado.** Uma pergunta estruturada por `pedir_a_pessoa` cria uma decisão e manda encerrar o turno; a resposta cria uma retomada. O contrato e o caso de uso estão em [`src/contracts/pedido.ts`](../../src/contracts/pedido.ts), linhas 23 e 87, e [`src/use-cases/pedir-a-pessoa.ts`](../../src/use-cases/pedir-a-pessoa.ts), linhas 157–169. Enquanto a decisão está pendente, o trabalho projeta `precisa_de_voce`.

**Comprovado.** Pedidos a colega, `me_chame_as` e `esperar_comando` mantêm o trabalho em `rodando` porque geram fatos persistidos. Uma frase comum como “estou bloqueado”, uma pergunta escrita apenas no texto ou `falta` no resumo não gera nenhum desses fatos e, ao fim bem-sucedido do CLI, permite `terminado`.

**Comprovado.** Frentes genéricas não recebem `me_chame_as` nem `esperar_comando`; o catálogo remove essas ferramentas e orienta a devolver o fato ao dono (`src/domain/plano-turno.ts`, linhas 103–104). Isso é coerente com “não esperar dentro da frente”, mas faz a espera deixar de pertencer à própria Tarefa se o dono não criar uma continuação estruturada.

**Comprovado.** Existe uma proteção mais forte para **trabalhos de cards do quadro**, não para toda Tarefa genérica: a ADR-155 exige uma de quatro saídas e tenta novamente quando o agente termina sem saída; na segunda ocorrência, espera a pessoa. O escopo no código está em [`src/use-cases/quadro-execucoes.ts`](../../src/use-cases/quadro-execucoes.ts), linhas 27–58, e no prompt em `src/domain/prompt-sistema.ts`, linha 509. Essa camada não muda a regra geral `ultimo concluido -> terminado` da Tarefa.

**Comprovado.** O quadro também possui `quem_fecha: pessoa`, que impede o bot de levar o card a Feito sozinho (`src/domain/quadro.ts`, em torno da linha 1023). Esse gate é do card do quadro e não equivale a aceite humano das Tarefas/frentes genéricas.

## 4. Processos filhos, shells, jobs e localhost

**Comprovado.** No Unix, o CLI nasce com `detached: true` e se torna líder de um grupo de processos em [`src/adapters/executor/processo.ts`](../../src/adapters/executor/processo.ts), linhas 341–379. Filhos abertos por Bash, MCPs e servidores herdam o grupo.

**Comprovado.** Quando o líder encerra normalmente, o Nod remove o registro de posse e envia `SIGKILL` ao grupo inteiro, linhas 441–460 do mesmo arquivo. Em interrupção explícita, envia `SIGTERM`, aguarda até cinco segundos e finaliza com `SIGKILL`, linhas 482–524. O driver Codex ainda chama `proc.interromper()` no `finally`, em [`src/adapters/executor/drivers/codex-cli.ts`](../../src/adapters/executor/drivers/codex-cli.ts), linhas 298–306.

**Comprovado.** Um processo que usa `setsid` para escapar do grupo continua carregando a marca herdada do turno. [`src/adapters/executor/fugitivos.ts`](../../src/adapters/executor/fugitivos.ts), linhas 147–165, procura esses processos ao fim do turno e envia sinais de término. Portanto, `nohup`, `&`, `disown` ou `setsid` não são mecanismos suportados de persistência.

**Reprodução controlada.** Foram executados com Node 24.19.0:

```text
npm test -- --project unit \
  tests/unit/domain/trabalho.test.ts \
  tests/unit/executor/processo-grupo.test.ts \
  tests/unit/executor/fugitivos.test.ts

Resultado: 3 arquivos, 115 testes aprovados, 3,07 s.
```

O caso `processo-grupo.test.ts:61` abre um `sleep 60 &`, deixa o líder sair e comprova que o neto morre. O caso `fugitivos.test.ts:203` abre um descendente em sessão própria (`setsid`) e comprova que a limpeza por marca também o encerra. Nenhum processo de longa duração foi deixado como entregável.

### Cleanup de worktree

**Comprovado.** Não há remoção imediata da worktree quando a Tarefa termina. A [ADR-088](../adr/adr-088-limpeza-das-pastas-de-task.md), linhas 34–49, determina: nunca limpar nas primeiras duas horas; entre duas horas e três dias, somente com PR mergeado; depois de três dias, a Tarefa terminal é elegível. A passada ocorre inicialmente após dez minutos e depois a cada seis horas, linhas 51–80.

**Hipótese secundária.** Se um processo sobreviver por estar fora do mecanismo de posse, ele pode perder seu diretório mais tarde quando a worktree se tornar elegível. O risco é explicitamente aceito na ADR-088, linhas 174–180. Isso não explica indisponibilidade imediatamente sincronizada com o fim do turno.

## 5. Timeouts, supervisão e encerramentos indiretos

**Comprovado.** Não existe timeout geral de duração do trabalho. [`src/adapters/executor/laco.ts`](../../src/adapters/executor/laco.ts), linhas 456–463, afirma que o turno termina quando o bot termina, a pessoa aperta Parar ou a máquina some; o vigia apenas avisa.

**Comprovado.** O lease da máquina é de 90 segundos, renovado a cada 30 segundos em [`src/shared/constantes.ts`](../../src/shared/constantes.ts), linhas 3–6. O varredor roda a cada 15 segundos e assenta turno perdido como `interrompido`, em [`src/adapters/fundo/varredor-lease.ts`](../../src/adapters/fundo/varredor-lease.ts), linhas 11–45.

**Hipótese para quedas que não coincidem com o fim normal.** Se um servidor cair antes do fechamento da Tarefa, investigar logs de lease, Parar, reinício da máquina/servidor e o watchdog opcional de silêncio do modelo. Esses caminhos também encerram o grupo, mas faltam logs do incidente relatado para atribuir um caso concreto a eles.

## 6. Como o resultado volta à conversa principal

**Comprovado.** Quando uma frente chega a estado final, o fechamento decide se aguarda as demais ou retorna imediatamente. Quando o lote está pronto, [`src/use-cases/fechar-lote.ts`](../../src/use-cases/fechar-lote.ts), linhas 30–62 e 160–191, enfileira um novo turno na conversa do dono, retomando a sessão adequada, com os resumos estruturados.

[`src/domain/retorno-do-lote.ts`](../../src/domain/retorno-do-lote.ts), linhas 127–177, transforma cada frente em JSON e instrui o dono a integrar os resultados, inclusive “o que ficou pela metade”. A linha visual `frentes_terminadas` é criada em `fechar-lote.ts`, linhas 242–254. Como o lote considera `terminado`, `parado` ou `falhou` estados finais, o retorno pode chegar mesmo com `resumo.falta`; a conversa principal é informada, mas a Tarefa já está terminal.

## Causas prováveis por sintoma

### Tarefas marcadas como concluídas cedo demais

**Causa comprovada:** `sucesso do CLI -> turno concluido -> trabalho terminado`, desde que não haja fatos estruturados pendentes. O objetivo e a aceitação da pessoa não participam da decisão. `resumo.falta` é apenas texto de relatório.

**Fatores contribuintes comprovados:**

- o prompt manda a frente terminar e devolver o que falta;
- frentes não podem manter espera por comando/horário;
- resumo ausente é sintetizado automaticamente;
- a UI usa uma palavra de conclusão de objetivo para um estado de término de execução.

### Localhost deixa de responder ao terminar a Tarefa

**Causa comprovada:** cleanup do grupo de processos no fim do turno, incluindo fugitivos por `setsid`. Esse é comportamento intencional para evitar processos órfãos, vazamento de recursos e servidores MCP esquecidos.

**Não é a causa imediata provável:** limpeza da worktree, por causa das janelas de duas horas/três dias.

## Opções de correção e trade-offs

### A. Separar entrega do agente de conclusão do objetivo — recomendada

Adicionar um estado como `entregue`/`aguardando_validacao` e reservar `concluida` para ação explícita da pessoa; alternativamente, generalizar `quem_fecha` do quadro para Tarefas.

- Prós: semântica correta; elimina falso positivo; deixa claro quem fecha.
- Contras: migração de banco/API/UI; mais interação; rotinas e tarefas totalmente automáticas precisam de política de autoaceite.

### B. Saída estruturada obrigatória para toda Tarefa

Generalizar o protocolo da ADR-155: o turno deve encerrar com `concluida`, `precisa_pessoa`, `bloqueada` ou `voltar_depois`; sem saída, retentar uma vez. Fazer `devolver_resumo` receber `status`, não inferi-lo pelo exit code.

- Prós: corrige perguntas e resultados parciais sem depender de linguagem natural; reutiliza desenho existente.
- Contras: custo de uma retomada em falha de protocolo; ainda é autoavaliação do agente se não houver gate humano.

### C. Dar semântica ao campo `falta`

Se `falta` existir, não transicionar para terminal; exigir categoria estruturada (`decisao_humana`, `evento_externo`, `proxima_acao`) e projetar `precisa_de_voce` ou `aguardando`.

- Prós: mudança menor e compatível com o resumo atual.
- Contras: `falta` hoje também descreve pendências informativas; uma string livre não indica quem ou o que pode retomar, então apenas testar presença criaria Tarefas presas.

### D. Ajuste apenas de linguagem/UI

Exibir `terminado` como “agente terminou”/“resultado entregue” e oferecer “Concluir” à pessoa.

- Prós: baixo risco e esclarece o estado real rapidamente.
- Contras: não corrige automações, retornos de lote nem servidores; é mitigação, não correção de modelo.

### E. Serviços persistentes explicitamente gerenciados — recomendada para localhost

Criar uma operação explícita como `manter_servidor`/`publicar_preview`. Ela registra processo, porta, saúde, dono, TTL e Tarefa; o supervisor a exclui do cleanup do turno e a encerra ao aceitar/cancelar a Tarefa ou vencer o TTL.

- Prós: preview realmente persistente com posse, observabilidade e cleanup previsível.
- Contras: supervisor novo; conflitos de porta, consumo de recursos e segurança de bind/rede; precisa de UI para estado/encerramento.

### F. Entrega não persistente

Quando a persistência não for essencial, exigir screenshot/vídeo/build estático ou preview publicado em vez de localhost.

- Prós: aproveita o isolamento atual; nenhum processo órfão.
- Contras: menos interativo; preview externo pode exigir credencial, custo e cleanup próprio.

### Opção não recomendada

Não matar processos em background ou ensinar o agente a escapar do grupo. Isso reabre exatamente os vazamentos que o grupo de processos e a caça a fugitivos corrigem, sem posse, TTL ou garantia de limpeza.

## Conclusão

Os dois sintomas são consequências coerentes do desenho atual: a Tarefa acompanha a vida da execução, e o turno possui isolamento forte de processos. A correção conceitual é separar “o agente acabou esta execução”, “o resultado foi entregue” e “a pessoa aceitou o objetivo”; previews persistentes devem ser recursos supervisionados, não descendentes acidentais do shell do agente.
