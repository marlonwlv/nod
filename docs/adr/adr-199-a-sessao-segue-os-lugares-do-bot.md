# ADR-199 — A sessão segue os lugares do bot: lugar que entra ou aviso que some larga a sessão do CLI

Status: proposta (2026-11-27, a partir de um caso de produção) · Frente "Navegador, computador e seu Mac" · Emenda a
regra de sessão da [ADR-107](adr-107-sessao-do-cli-por-maquina.md) e o aviso de recomeço da NOD-312, sem mudar o
que eles já decidem · Revê o texto do aviso de "fora do ar" da emenda de 2026-09-24 da
[ADR-037](adr-037-computadores-por-bot.md), sem mudar a regra dela (desligado ou fora do ar, o plano sai sem
`computador_*`) · Acrescenta um contador ao conjunto fechado da [ADR-017](adr-017-um-container-metricas-ligadas-a-promessa-de-produto-alar.md).

## Contexto

Um bot numa conversa longa, no Codex, respondeu por dias "o navegador continua indisponível nesta sessão" a pedidos de
abrir um site. O banco mostrava o contrário do que ele dizia: as doze ferramentas `navegador_*` estavam no plano de cada
turno, a máquina da pessoa puxava a fila do navegador, e o turno terminava com zero chamadas de ferramenta.

A linha do tempo da conversa explica:

1. O bot tentou `computador_navegar` e a chamada falhou com "máquina sem contato" (o computador do bot só mora em máquina
   Linux, e a pessoa só tinha um PC).
2. Por cinco dias, todo turno levou no prompt "Seu computador está fora do ar (…). Não prometa usá-lo nem tente
   contornar". O bot obedeceu e respondeu que não conseguia.
3. O navegador (ADR-190) entrou no plano com essa frase ainda no prompt. O bot seguiu recusando.
4. A frase saiu do prompt (2026-11-25, `computadorTemLugar`). O prompt estava certo e as ferramentas estavam lá.
5. O bot seguiu recusando, sem chamar nada.

A conversa foi sempre a MESMA sessão do CLI, retomada turno após turno. O que a sessão guardava (a tentativa que falhou,
cinco dias de "não tente contornar", as próprias respostas de recusa) pesou mais que o prompt novo. Ninguém disse ao bot
que algo tinha mudado: o nod só parou de mandar o aviso.

O defeito de fundo é que a verdade sobre os lugares do bot mora em dois lugares. O nod sabe o estado de agora e o põe no
plano de cada turno. A sessão do CLI guarda o estado de quando cada coisa foi dita. Quando os dois discordam, o modelo
escolhe, e nada no nod percebe.

A varredura de produção do mesmo dia achou um bot nessa situação entre 88 com sessão viva. O mecanismo, porém, não
depende daquela pessoa: vale para qualquer lugar que caia e volte, e para todo lugar novo que entrar no plano de quem já
tem conversa aberta.

## Decisão

1. **A sessão só é retomada enquanto os lugares do bot não melhoraram** (`src/domain/lugares-da-sessao.ts`).
   - Cada turno grava a marca dos lugares dele em `turnos.lugares` (0188), por exemplo
     `computador=fora_do_ar;navegador=no_plano;seuComputador=ausente`.
   - Ao emitir o plano, o nod compara os lugares de agora com a marca do último turno que rodou na sessão candidata
     (conversa, task ou cadeia). Se um lugar ENTROU no plano, ou se um aviso de "desligado" ou "fora do ar" SUMIU, a
     sessão não é retomada: o turno começa numa sessão nova, pelo caminho de recomeço que já existe (histórico das
     últimas falas, resumo do trabalho, aviso na entrada, marca "recomeçou" na conversa).
   - O motivo novo é `lugares_mudaram`. A entrada do turno ganha uma frase a mais, que diz o que há NESTE turno e manda
     conferir pela ferramenta em vez de pelo histórico.
   - Um lugar que SAI não larga a sessão. O prompt do turno diz o estado, e não há crença errada a desfazer.
   - Turno de antes da coluna (marca nula) é "não se sabe": retoma como antes. O deploy não larga sessão nenhuma.
   - A regra não pede nada ao modelo. Vale igual para o Claude e para o Codex, e não depende de o `thread/resume` do
     Codex aplicar ou não as instruções novas.

2. **O aviso de computador fora do ar vale para o computador e para o turno.** O texto de antes ("não prometa usá-lo
   nem tente contornar") virava proibição geral na memória da sessão: o bot recusava o navegador junto. O texto novo diz
   que o aviso vale só para o computador e só para este turno, aponta o navegador quando ele está no plano, e avisa que
   num turno seguinte vale o que estiver naquele turno. A resposta da ferramenta chamada com o computador fora do ar
   muda no mesmo sentido.

3. **Uma sonda com os CLIs de verdade** (`scripts/sonda-lugares.ts`) percorre os cenários em que um lugar cai, entra ou
   volta no meio de uma conversa, no Claude Code e no Codex, e registra por turno se a sessão foi retomada e o que o bot
   chamou. Não entra no `check` nem na CI (paga assinatura). Roda quando mudar o texto dos lugares no prompt, a regra
   deste ADR, ou a versão de um dos CLIs.

4. **Um alarme** mede o sintoma em produção: o bot disse que o navegador ou o computador não funciona, com o lugar no
   plano e sem chamar a ferramenta dele (`lugaresRecusadosSemTentar`). É heurística de texto e só mede:
   - log `lugar_recusado_sem_tentar` (aviso), com o turno, o bot e a IA;
   - campo `lugares_recusados` no evento `turno_encerrado`, que fica no banco e responde por consulta;
   - contador `lugar_recusado_sem_tentar{lugar, harness}` em `/metrics`. É a oitava métrica: a ADR-017 fechou sete, todas
     ligadas a promessa de produto, e esta é a promessa "o bot usa o lugar que tem". Fica registrada na própria ADR-017 (refinamento de 2026-11-27), com `harness` no union fechado (`IdHarness` ou `desconhecida`).

## O que a sonda mediu (2026-11-27)

Claude Code 2.1.332 (Sonnet) e Codex CLI 0.167.0 (gpt-5.6-sol), `main` em `410d1477` contra a branch, 88 turnos.

- **Cenário de origem, Codex, três rodadas.** No `main`, nos dois turnos com o navegador no plano (com o aviso do
  computador e depois sem ele), o bot não chamou `navegador_*` nenhuma vez: 0 de 6. Ele chama `gerir_maquinas`, vê a
  máquina desligada e responde que não há como abrir uma aba. Na branch, com a sessão nova, abriu o site nos 6 de 6.
- **Cenário de origem, Claude, uma rodada.** Abre o site nos dois lados, com a sessão retomada ou nova. O defeito medido
  é do Codex.
- **O mesmo lugar que cai e volta** (computador; navegador que sai e volta): as duas IAs voltam a chamar a ferramenta
  nos dois lados. O Codex só fica preso quando o lugar que entra é OUTRO, diferente do que falhou.
- **Memória.** Uma palavra combinada dois turnos antes da troca de sessão foi lembrada pelas duas IAs.
- **Tempo.** Nos 10 turnos que trocaram de sessão, 235 s antes e 236 s depois.
- **O alarme.** A primeira versão procurava "navegador indisponível" e não marcou nenhum dos 6 turnos presos: o Codex
  culpa a máquina. A regra passou a contar a recusa que culpa o computador ou a máquina quando só o navegador está no
  plano. Reaplicada às 88 respostas, marca os 6 e nenhuma das outras 82. Ela foi ajustada sobre essas frases: a taxa de
  erro em conversa real só sai de produção.

O que a medição não separa: o "depois" junta a sessão nova, a frase de recomeço e o aviso reescrito do item 2. E a
conversa da sonda tem dois turnos de recusa, não cinco dias.

## O que fica de fora

- **O computador da pessoa (ADR-197) não dispara a regra.** Ele entra e sai com a tampa do laptop. Para quem conversa
  pelo celular com uma máquina sempre ligada, isso largaria a sessão quase todo dia. Ele fica gravado na marca, e o
  alarme do item 4 diz se a ausência dele também prende o bot.
- **A ferramenta não responde ao vivo quando o computador está fora do ar.** Hoje o plano sai sem `computador_*` e só a
  pessoa tira o computador do "fora do ar" (Tentar de novo). Deixar o bot sondar o computador a cada pedido tornaria a
  proibição desnecessária, mas muda a saúde do computador (ADR-037) e fica para uma decisão própria.
- **O histórico da sessão nova ainda traz as recusas antigas.** As últimas falas vão no plano de quem recomeça, com
  "indisponível" escrito pelo próprio bot. A frase do item 1 fala disso; o alarme mede o que sobrar.

## Alternativas recusadas

- **Só avisar no turno que o lugar voltou, mantendo a sessão.** É o menor conserto, mas depende de o modelo dar mais
  peso a uma frase nova que a dias de histórico, e foi exatamente isso que falhou. Gatilho de reversão: a sonda mostrar,
  nas duas IAs, que a sessão retomada com o aviso se comporta igual à sessão nova por três versões seguidas dos CLIs.
- **Largar a sessão em qualquer mudança de lugares, inclusive quando um sai.** Mais simples de explicar, mas larga a
  memória da sessão quando nada precisa ser desfeito, e um computador instável largaria duas vezes por queda.
- **Tirar a recusa do histórico que vai no plano.** Editar o que o bot disse muda a conversa que a pessoa viu e não
  resolve a sessão retomada, que é onde o caso aconteceu.

## Gatilhos de reversão

- O log `sessao_largada_pelos_lugares` passar de uma vez por bot por semana na mediana: a regra está largando memória
  demais, e o computador instável é o suspeito. Rever o lado "o computador entrou" antes de qualquer outra coisa.
- O alarme do item 4 seguir contando casos em sessão nova: a memória da sessão não era a causa principal, e o conserto
  passa a ser a ferramenta responder ao vivo.
