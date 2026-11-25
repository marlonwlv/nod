# ADR-191 — Seguir conversando dispensa o pedido aberto

Status: aceita (2026-11-20, pedido do dono) · Relacionadas: [ADR-007](adr-007-a-fila-global-le-por-pessoa-sob-rls-item-vencido-em-cinz.md) (o sistema nunca
some com nada sozinho), [ADR-045](adr-045-queda-do-mac-vira-um-aviso.md) (o "Retomar" e o ×),
[ADR-114](adr-114-chat-limpo.md) (o cartão encolhe no lugar), [ADR-184](adr-184-mensagem-nova-substitui-a-aprovacao-aberta.md)
(a aprovação substituída), [ADR-185](adr-185-o-parar-nao-perde-o-que-a-pessoa-disse.md) (a sessão viva).

## Contexto

O dono mandou prints de três problemas na conversa:

1. O cartão que espera um clique (o login do computador, "Conectar o Google Drive", uma proposta de app ou de rotina, o
   "Retomar") ficava aberto até vencer quando a pessoa não agia e seguia conversando. O bot não sabia que ela tinha
   seguido e às vezes pedia de novo.
2. As propostas abertas eram desenhadas depois de todas as mensagens (`blocosDoHistorico`), então pareciam presas no fim
   da conversa. Os pedidos de "Sua vez" já ficavam na fala do turno que pediu (`comPedidosAncorados`).
3. O cartão ficava colado no balão: o `.cp` tinha margem de cima negativa (-4 px) e entrava na fala da pessoa.

A referência é o app de referência ("Grok Bot"), que marca o cartão esquecido como "Dismissed" quando a pessoa manda uma
mensagem nova. A ADR-184 já fazia isso para a aprovação, por regra.

## Decisão

**A. A mensagem nova da pessoa fecha os pedidos abertos da conversa criados antes dela, como dispensados por ela.**
`dispensarAoSeguirConversando` (src/use-cases/seguir-conversando.ts) roda na transação de `enviarMensagem`, depois de
gravar a mensagem e antes do turno novo, só na conversa própria. A mensagem de bot, de sistema ou da sala não passa por
esse caminho. O desfecho é o do × (`dispensada`, `por` = quem mandou, `antes` = o estado de antes), por
`decisoes.dispensarAoSeguir`. A ADR-007 continua valendo: quem dispensa é a pessoa, ao seguir conversando, e o registro
fica. Os efeitos são os de `depoisDeDispensar`: as gêmeas fecham, a janela da rotina passa em branco e o computador
volta ao bot. A diferença é a opção `semRetomada`: a mensagem já cria o turno dela, então não nasce um segundo turno com
o "Agora não". A proposta de mesmo id sai recusada (o perfil leva as rotinas do cartão; a reconfiguração continua aberta,
porque a pessoa está conversando sobre o perfil). O card de conexão, que é só proposta, também sai recusado.

- **Entram** (`TIPOS_DISPENSADOS_AO_SEGUIR`): acesso, app, credencial, perfil, bot, lote_bots, rotina,
  rotina_atualizacao, rotina_exclusao, rotina_execucao, colunas_quadro, quadro_exclusao, importacao_linear,
  assumir_quadro, retomar_turno e, de `pergunta`, só a ajuda do computador. O caso de uso confere o balão
  (`pedido_a_pessoa.ajudaDoComputador`), o mesmo sinal que a web usa para não responder a ajuda com texto. No `main`,
  o "login/ajuda/código do navegador" é esse pedido de ajuda.
- **Ficam de fora**: as perguntas que se respondem com texto (`pergunta`, `falta_de_dado`, `permissao`), porque a
  mensagem digitada já é a resposta e vai pela rota de responder (EMENDA 16). Também ficam: `gate_rotina`,
  `decisoes_exportacao`, a espera de uma tarefa do quadro (`tarefaId`), o pedido dirigido a outra decisora, a decisão em
  revisão e a vencida (as listas só trazem pendente/reaberta), e o pedido de um turno ainda vivo, que lê a mensagem na
  sessão (ADR-185) e decide o que fazer com o próprio pedido.
- **A aprovação segue a ADR-184**: ela já é fechada pela `regra:aprovacao_substituida`, nada roda e o hook diz ao bot
  que não foi recusa. Ela não vira `dispensada`, porque a ADR-184 escolheu de propósito não pôr o nome da pessoa numa
  decisão que ela não tomou. O que muda para ela é só a tela (C).

**B. O bot fica sabendo por uma mensagem `sistema` com payload `pedido_dispensado`** {decisaoId, tipo, frase, motivo:
"seguiu_conversando", turnoId, agenteId, conector?, conectar?, ajuda?}. O texto é a linha fixa de
`linhaDoPedidoDispensado`: "A pessoa seguiu sem responder ao seu pedido: <frase>. Nada foi feito com ele. Não peça de
novo agora: siga com a mensagem nova e só volte ao pedido se ela pedir." Como `criado_em` é `clock_timestamp()` e a
linha nasce antes do turno, ela entra no histórico do turno sem sessão e no "desde a sua última vez" da sessão retomada
(`emitir-plano-turno.ts`, sem mudança lá). A web usa a mesma mensagem como recibo do cartão. O assunto é
`pedido.dispensado`, com destino chat.

**C. Na tela, o cartão dispensado vira uma linha cinza no lugar onde nasceu** (`linhaDispensada`, web/telas/cartao-encolhido.ts),
na âncora do cartão encolhido (`turnoDoEncolhido`): "Entrar no Drive · você seguiu sem entrar · Fazer agora" (abre a
tela do bot), "Conectar o Google Drive · você seguiu sem conectar · Conectar" (o login de sempre), "Pagar R$ 249,90 na
loja · não pago · Pedir de novo" (a aprovação substituída) e "<frase> · você seguiu sem responder · Pedir de novo".
"Pedir de novo" manda ao bot, pelo campo, a frase pronta "Pode pedir de novo: …", pela rota de toda mensagem
(`conversas.enviar`): nenhuma ação nova no registro ([ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md)). As linhas do mesmo turno ficam juntas, a 6 px uma da outra.

**D. Toda proposta aberta fica onde nasceu**, pela regra dos pedidos (`ancoraDoPedido`), com o turno e a hora da decisão
de mesmo id ou da própria proposta. Só a que não acha âncora vai para o fim.

**E. A pílula "o que espera você"**: com nenhum cartão que espera a pessoa à vista, aparece "A Ada espera você:
**entrar no Drive** · Ver ↓", ou "2 pedidos esperam você · Ver ↓", que leva ao mais antigo. Os cartões levam
`data-pedido-espera`, e a rolagem que já existia mede (web/lib/rolagem-na-tela.ts).

**F. O campo diz "Responda à <bot> ou fale de outra coisa"** com um desses cartões aberto e o campo no modo comum
(`aparenciaDoComposer`). Com uma pergunta de texto aberta, o campo continua sem mudar (decisão de 2026-10-18). A
aprovação mantém o placeholder dela.

**G. O cartão ganha 10 px de respiro acima e abaixo** (28 px no lugar de 18). Os balões seguidos não mudam.

### Revisão de 2026-11-21 (teste do dono): onde o cartão aparece e o espaço dele

- **Embaixo da fala do turno que pediu, sem pular.** Antes o cartão surgia embaixo da mensagem da pessoa enquanto o turno
  rodava e, quando a fala final chegava, pulava para baixo dela ("o balão do bot sobe por cima do cartão"). Agora o pedido
  do turno vivo que ainda não falou fica segurado e aparece de uma vez embaixo da fala (`ancoraDoPedido`, `comPedidosAncorados`,
  `comPropostasAncoradas`). O dono aceitou os poucos segundos a mais.
- **A aprovação aparece na hora.** O turno espera a decisão antes de falar (a fala vem depois); segurá-la a esconderia para
  sempre. Ela não pula: nada do bot chega antes da decisão.
- **O espaço de um balão.** O cartão (aberto, ancorado ou a linha cinza) segue a regra de `.message[data-group-start]`:
  16 px de margem e 2 px de folga. O respiro de 28 px da primeira versão saiu.

## Alternativas descartadas

- **Manter o cartão aberto até vencer** (como era): a conversa acumula pedidos que a pessoa já deixou para trás, e o
  bot, sem saber, pede de novo. Foi o que os prints mostraram.
- **Dispensar só as perguntas**: a pergunta de texto já se resolve com a mensagem, e os cartões que não se respondem com
  texto (conexão, propostas, ajuda do computador) são justamente os que ficavam presos.
- **Avisar o bot pela entrada do turno** (prefixar o texto da pessoa): cobriria a fala absorvida pela sessão viva, mas
  misturaria texto do sistema com o da pessoa na entrada, na busca de memória e no contexto do colega. O pedido de turno
  vivo ficou de fora (A), então a sessão viva não precisa do aviso.

## Gatilho de reversão

- A pessoa reclama de cartão sumindo com uma mensagem curta que era a resposta ("ok", "pode"), ou o bot repete o mesmo
  pedido logo depois de cada mensagem: pensar em só dispensar quando a mensagem não responder ao cartão, como na ADR-184.
- Um pedido dispensado que depois executa alguma coisa (acesso concedido, rotina rodada, app criado) sem um clique novo:
  a dispensa não está fechando o que devia, e o caminho volta a recusar pelos casos de cada tipo.
- Medir pela tabela: em 30 dias, mais de 20% das decisões `dispensada` com `antes` aberto seguidas, no mesmo turno do
  bot, de um pedido igual (mesmo tipo e frase) indica que a linha do bot não está segurando o pedido repetido.
