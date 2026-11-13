# ADR-167 — Abrir um bot e o quadro na hora: leituras juntas, pré-carga das conversas e gzip na API

Status: proposta (2026-11-13, pedido do Marlon: "carregar msgs quando eu clico em um bot e carregar o quadro estão muito
lentos; quero instantâneo") · Relacionadas: [ADR-001](adr-001-modo-do-pooler-tamanho-do-pool-e-politica-de-deploy.md)
(pool e prazo de aquisição), [ADR-153](adr-153-quadros-por-bot-e-projetos.md) (o `?quadro=` e o último aberto), NOD-216 (a leitura
`vivos:` fora da tela), NOD-328 (o Caddy só comprime o bundle).

## Contexto

Medido em 2026-11-13 contra `app.nodbot.ai` (Caddy, HTTP/2): uma ida e volta de API custa ~60–80 ms com a conexão
aberta (~180 ms com TLS novo). A lentidão não estava numa consulta pesada, e sim em **filas de idas e voltas**:

- **Abrir um bot (web).** `reidratar` buscava as faltas da tela **uma por vez** (`for … await`) e só redesenhava no fim.
  Na primeira carga são ~15 GETs (ias, uso do plano, onboarding, conversa, concessões, disponibilidade, atividade de
  hoje, rotinas, conectores, sua vez, não lidos, trabalhos, máquinas, contas…): 1,2–2,5 s até a conversa aparecer. Num
  bot seguinte, quatro GETs em fila (conversa, concessões, disponibilidade, atividade) mais o servidor: 0,5–0,8 s.
- **A conversa (servidor).** `lerConversa` fazia ~12 idas ao banco em fila (anexos, fila dos pedidos, turnos, fios,
  trabalhos abertos, dono, presença das máquinas, reações, pedidos de colega, ações do modo), cada uma esperando a
  anterior voltar do Cloud SQL.
- **O quadro.** A web lia a lista do seletor e **depois** o quadro (duas idas e voltas em fila, ADA-14); o servidor
  montava o quadro com ~20 consultas em fila mais um `agentes.buscar` **por bot** e um `pessoas.buscar` por pessoa.
  Trocar de bot zerava o quadro e começava do nada.
- **O tamanho.** A API vai sem compressão (o Caddy só comprime o bundle, NOD-328): uma conversa de 200 falas passa de
  100 KB crus pela internet.

## Decisão

1. **As leituras de uma passada do `reidratar` saem juntas** (`Promise.all`), a conversa da tela primeiro
   (`web/lib/ordem-das-leituras.ts`: o HTTP/1.1 do nod diário abre seis de cada vez), e **cada resposta pinta no próximo
   quadro** (`renderNoQuadro`) em vez de esperar a última. A queda de rede guarda só a leitura que caiu
   (`pendentesDeRede`), e o erro e a sonda saem uma vez por passada. As guardas de ordem de antes (NOD-370: frota e
   gestão com `vez`) continuam valendo porque são por leitura, não pela fila.
2. **Pré-carga das conversas da barra** (`aquecerConversas`): com a tela servida e nada pendente, a web lê em segundo
   plano, **uma por vez com 250 ms entre elas**, as conversas dos outros bots (os da pessoa primeiro, na ordem da barra,
   até 12), pela leitura `vivos:` que já existia (NOD-216). O clique seguinte desenha da conversa que já está no estado;
   o que mudou enquanto ela ficou fora da vista chega pela invalidação de sempre (o frame marca `conversa:` e a abertura
   relê por cima). Só no computador e com a janela na frente (no celular é dado móvel). Qualquer falha encerra a passada.
3. **O quadro abre com uma ida e volta.** Sem link escolhendo o quadro, a lista do seletor e o quadro saem juntos; para
   isso `verQuadro` sem `?quadro=` abre **o último aberto que a pessoa deixou no bot** (`preferencias.quadroAberto`, o
   mesmo que `quadrosDoBot.aberto` diz; se ele saiu do bot, o padrão). Com `?quadro=` nada muda; as mutações seguem a
   ADR-153 (sem `?quadro=`, o padrão). A web **lembra o último quadro de cada bot na sessão** (`quadroLembrado`) e o
   mostra na hora ao voltar; a leitura que segue acende o que mudou desde então (a regra de sempre de `aplicarQuadro`).
4. **No servidor, o que não depende um do outro sai numa leva.** `lerConversa`: três levas (o que só depende da
   conversa; o que depende das falas lidas; o que depende das falas com fila). `montarQuadro`: os nomes dos bots num
   `Promise.all`, as leituras que só dependem do quadro numa leva, os nomes de quem pediu numa leva antes do laço. O
   postgres.js enfileira as consultas da mesma transação na mesma conexão: a leva poupa a espera entre elas, não abre
   conexão nova (o pool da ADR-001 não muda).
5. **gzip nas respostas JSON** a partir de 1 KiB quando o cliente aceita (`json()` em `util.ts`; `vary:
   accept-encoding`), assíncrono no threadpool do zlib; se outra resposta saiu no meio (o erro do roteador depois do
   handler), a compressão se cala. O SSE e o long-poll não passam por `json()` e seguem crus, e o Caddy continua sem
   `encode` na API (NOD-328). O chamador interno do MCP (ADR-166) não manda `accept-encoding`: recebe cru, como antes.

## Alternativas descartadas

- **Limitar a concorrência da passada (3–4 por vez).** Não: o HTTP/2 de produção multiplexa e o servidor já aguenta
  vários bots escrevendo frames; se o pool sofrer, é o gatilho abaixo.
- **Uma rota só "tudo da conversa"** (conversa + concessões + disponibilidade + atividade). Resolveria a fila também,
  mas acopla quatro casos de uso numa rota e o ganho sobre a leva paralela é só a diferença entre a maior e a soma
  de pequenas (~60 ms). Fica como passo seguinte se a leva não bastar.
- **Comprimir no Caddy** (`encode` na API). O SSE e o long-poll ficariam presos no buffer do encoder (motivo da NOD-328).

## Gatilhos de reversão

- `banco_ocupado` (503) ou `tx_longa` subindo em produção nas horas de pico depois deste deploy: a leva paralela ou a
  pré-carga estão pesando o pool → primeiro reduzir `AQUECER_MAX` ou desligar a pré-carga; depois voltar a passada a uma
  fila com limite.
- A memória da web crescendo com muitos bots (12 conversas × 200 falas é pequeno; mais que isso, medir): baixar o teto.
- CPU do servidor subindo com o gzip (a conversa de 200 falas comprime em poucos ms; medir com `top` no contêiner):
  subir `GZIP_A_PARTIR_DE` ou trocar o nível.
- O quadro que abre sem link vindo diferente do que a lista diz: `verQuadro` e `quadrosDoBot` divergiram em
  `quadroAoAbrir` → corrigir, não voltar à leitura em fila.
