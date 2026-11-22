# ADR-192 — Os desvios de uma mensagem numa tabela só (lote B das Jornadas da IA)

Status: aceita (2026-11-22, objetivo do lote B definido pelo dono) · Relacionadas: [ADR-045](adr-045-queda-do-mac-vira-um-aviso.md)
(a queda e o "Retomar"), [ADR-101](adr-101-varias-contas-por-ia-um-diretorio-por-conta.md) e ADR-102 (as contas da IA), ADR-107 (a sessão por máquina),
ADR-108 (a troca de IA do bot), [ADR-114](adr-114-chat-limpo.md) (o chat limpo), NOD-268 (o teto de reenvios), NOD-309
(o fundo volta sozinho).

## Contexto

O momento B do Paper ("Jornadas da IA · conectar e conversar") listou 12 desvios de uma mensagem a um bot. Cada um
terminava diferente: um aviso genérico ("a IA parou por um erro; tente de novo"), um texto com ids crus ("executor
indisponível (claude-cli nao_autenticado)"), uma espera calada ou uma troca silenciosa. A linha de base em produção
(14 a 21/11, 64 pessoas) mostrou:
- 52 avisos genéricos de "tente de novo";
- 76 avisos com termo interno;
- 20 conversas sem resposta em 24 h;
- 7 limites batidos de novo por um palpite de 1 h;
- 22 falhas sem texto nenhum.

Cada caminho tinha a sua regra espalhada por `assentar-turno.ts`, `erro-fornecedor.ts` e `redacao.ts`.

## Decisão

**Uma tabela única dos desvios no domínio**: `src/domain/desvios-da-conversa.ts`. Para cada desvio, ela define:
- como se reconhece pelo fim do turno (`reconhecerDesvio`);
- a ordem do que o nod tenta sozinho e os tetos (`decidirRecuperacao`);
- a frase da linha discreta, quando o nod resolveu (`linhaDaRecuperacao`);
- a frase do cartão, com o motivo e os botões, quando o nod parou (`cartaoDoDesvio`).

O id viaja no payload `desvio` da mensagem (`src/contracts/desvio.ts`). A web só desenha (`web/telas/desvio.ts`), com o
aviso do design system.

As regras:
1. **A mensagem nunca se perde.** Sem IA pronta, ela espera (`adiarFala`) e sai sozinha quando uma conta da IA fica
   pronta (`anteciparFalasEsperando`, no anúncio das contas).
2. **Recuperar antes de parar, sempre na mesma ordem e com teto:**
   - a ordem é mesma conta (só causa conhecida) → próxima conta do bot → outra IA → cartão;
   - o teto da mensagem é de 3 tentativas automáticas, somadas: `TETO_TENTATIVAS_DA_MENSAGEM`, e `TETO_REENVIOS` passa de 1 a 3;
   - o teto de cada desvio: sessão sumida 1, instável 2 (30 s e 2 min, depois a outra IA), erro desconhecido 1, queda 1.
3. **A conta com problema sai da vez.** Login vencido (vínculo `sem_login`, que o anúncio não desfaz até um login mais novo),
   sem acesso ou limite: a conversa segue na próxima conta, com uma linha discreta. As linhas de troca (`ia.trocada`,
   `conta.seguiu`, `conta.trocada`) voltam ao chat, revendo a revisão 3 do chat limpo.
4. **O limite usa a hora real.** A hora vem do protocolo, do texto com fuso ou da leitura de cota do turno
   (`voltaPelaLeituraDaCota`). O "try again at 3:39 PM" do Codex não serve: é o relógio da máquina, sem fuso. Sem
   nenhuma hora, a tela diz "volta sem hora".
5. **O "desta vez" não muda o bot.** A troca automática acontece só entre as contas do bot. Fora delas, é um botão
   ("Responder com o <outra IA> desta vez", "Rodar no <outra máquina> desta vez").
6. **O envio olha a máquina do bot agora** (último contato < 2 min). Fora do ar, a conversa avisa na hora.
7. **Todo cartão traz o motivo e um botão que o nod executa.** Não há "tente de novo" nem termos internos
   (`motivoLegivel`), e a máquina e a conta aparecem pelo nome, com o artigo certo.
8. **O erro desconhecido repetido vai sozinho para o time** (relato automático), e o cartão avisa.

A queda da conversa (o nod atualizou, a máquina dormiu) ganha a volta automática do fundo, uma vez, com a linha discreta.
Ela é absorvida se o sucesso tardio chegar (a entrada `ENTRADA_DA_RETOMADA_DA_QUEDA`). O "Retomar" fica só para o teto
da mensagem.

## Alternativas

- **Manter cada desvio no caminho dele:** foi o que gerou as 12 respostas diferentes, e não há como testar a regra
  inteira.
- **Teto 1 (NOD-268):** não deixa a ordem mesma conta → próxima conta → outra IA acontecer.
- **Ler a hora do texto do Codex no fuso da pessoa:** erra por horas numa VM em UTC.

## Como se prova

- `tests/unit/domain/desvios-da-conversa.test.ts`: o reconhecimento de cada desvio, cada galho da decisão, os tetos e a
  ausência de termo interno em todas as frases.
- `tests/concurrency/jornadas-ia-b-chrome.test.ts`: os 18 caminhos no Chrome real, sobre o servidor compartilhado, com
  máquinas falsas pela ponte HTTP (`tests/helpers/maquina-falsa-http.ts`) devolvendo o erro real de cada fornecedor. Com
  `NOD_AUDITORIA_DIR`, ele grava os prints de cada passo em claro, escuro e celular.

## Gatilho de reversão

Reverter se, duas semanas depois do deploy, as medidas da linha de base piorarem: mais conversas sem resposta em 24 h ou
mais avisos genéricos. Reverter também se as repetições automáticas gastarem cota de forma visível (mais de 3 turnos da
mesma mensagem, o alarme `reenvio_em_laco`). O desvio 9 ("Reinstalar e tentar") fica para quando o motor tiver o comando.
