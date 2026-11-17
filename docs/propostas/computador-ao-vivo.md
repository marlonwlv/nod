# Computador ao vivo — mapa técnico e proposta de entrega

Data da análise: 2026-11-16.

Base comparada:

- Nod `preview/grokbot` em `7369e9c40f0ace6f248184e03270d6aeb8a27a97`.
- Bot HQ em `decf9a215cddd8792a5f20f4a11a87d4dffa6d15`.
- Artefato visual “Bot HQ × Nod preview/grokbot”, versão 3.

Esta é uma proposta de implementação. Nenhum código de produto foi alterado.

> Atualização de 2026-11-17: a entrega da NOD-498 tornou este documento histórico. Onde ele descreve “computador por
> bot” ou diz que o aluguel bot→display falta, prevalece a ADR-168 corrigida: uma máquina/container por pessoa/espaço,
> uma tela e workspace por bot, e autenticação compartilhada por loja serializada — nunca pelo mesmo `user-data-dir`.

## Conclusão

O Nod não precisa copiar a arquitetura do Bot HQ. A maior parte difícil já existe no Nod com garantias melhores: noVNC,
sessão WebSocket autenticada, filtro RFB no servidor, controle persistido, reconferência de autorização, contrapressão,
fallback por capturas e isolamento do computador. O bloqueio da prioridade é de composição: essa pilha ao vivo só nasce
quando `NOD_COMPUTADORES=motor`, enquanto o provedor Orgo já declara `telaAoVivo: "vnc_websocket"` e devolve URL e senha,
mas `acessoTela()` não é consumido por nenhuma rota. No Orgo, a tela cheia tenta a rota, recebe 404 e acaba no plano B de
capturas periódicas.

A entrega deve tornar a sessão ao vivo neutra ao provedor, mantendo uma única API para a web e dois adaptadores de origem:
o canal de saída do motor, já existente, e um relay VNC autenticado pelo servidor para provedores externos. Depois disso,
o controle assumir/devolver deve ser ligado à sessão que o pediu, para nunca haver duas abas mandando entrada ao mesmo
desktop.

## O que existe no Bot HQ

### Componentes e fluxo

1. `web/src/components/ComputerViewer.tsx` monta o noVNC sob demanda. Há vista pequena no painel e vista grande, estados
   `idle`, `waking`, `live`, `switching`, `asleep`, `paused` e `error`, além de tela cheia, reset e reconexão.
2. O navegador abre `WS /api/bots/:botId/screen?mode=watch|control` com o cookie da sessão.
3. `server/src/vnc.ts` valida usuário e propriedade do bot, busca a tela do bot e a senha VNC no Orgo, abre o WebSocket
   upstream e termina o handshake RFB autenticado. Para o navegador, oferece uma sessão RFB sem senha; a credencial
   root-equivalent do computador nunca chega ao cliente.
4. Em `watch`, o relay interpreta apenas o fluxo cliente → servidor e descarta `KeyEvent`, `PointerEvent` e
   `ClientCutText`. Mensagem desconhecida falha fechada. Em `control`, os bytes passam.
5. `server/src/computer.ts` mantém um computador Orgo compartilhado e aluga uma tela por bot, até quatro. A primeira tela
   é a principal; as demais são criadas no Orgo. Antes do turno, a tela e o Chrome são preparados.
6. `GET /api/events` publica por SSE mudanças de linhas, estado ao vivo, elenco e computador. O VNC é um canal separado.
7. “Hand back” troca o modo local para `watch` e grava `handback_at`; no próximo turno o bot recebe uma nota para olhar a
   tela novamente.

### Sessões e estados

- SQLite guarda usuário, sessão web, computadores, telas alugadas, bots, turnos e aprovações.
- A tela é persistente por bot, mas `watch|control` não é um lease exclusivo persistido. O modo vem da URL do WebSocket;
  duas abas podem abrir `control` ao mesmo tempo.
- O bot continua trabalhando durante o controle humano. A devolução é um aviso para o próximo turno, não um bloqueio
  transacional do executor.
- Uma conexão aberta conta como presença para o computador não dormir.

### APIs, dependências e chaves

- React 18, Zustand, `@novnc/novnc` 1.7 e `ws` 8.22.
- Orgo para máquina, telas, screenshot, VNC e comandos; Hermes para execução; Composio para apps; xAI para voz.
- `ORGO_API_KEY`, `ORGO_COMPUTER_ID` e `SESSION_SECRET` são necessários para o computador e a sessão. A senha VNC é
  buscada no servidor.
- O código é MIT. O algoritmo de handshake/relay pode ser adaptado, com atribuição no `THIRD_PARTY_NOTICES.md`; os assets
  visuais restaurados não devem ser copiados.

### Segurança, mobile e testes

- Ponto forte: a senha VNC não vai ao browser e o modo watch é filtrado no servidor.
- Pontos fracos declarados pelo próprio projeto: bots dividem arquivos na mesma máquina; browser e shell não passam pelas
  aprovações; não houve auditoria de segurança; controle não é exclusivo.
- O viewer se ajusta ao espaço e expõe os controles em dispositivos sem hover, mas a aplicação conserva larguras mínimas
  de desktop e o E2E usa apenas `1512×864`. Não há prova de jornada mobile real.
- `tests/e2e.mjs` cria um bot real, espera uma tela, abre o viewer, assume e devolve. É uma boa prova de integração, mas
  não envia entrada ao desktop, não testa duas abas, revogação, queda, pressão de fluxo ou celular.

## O que existe no Nod

### Componentes e fluxo atual

1. `web/telas/tela-cheia.ts` abre a tela em um `dialog` de borda a borda. A primeira observação acorda/abre a tela; depois
   `web/lib/tela-vivo.ts` carrega noVNC dinamicamente em
   `WS /api/t/:tenant/agentes/:id/computador/vivo?modo=assistir`.
2. Assistir e controlar usam a mesma conexão. `rfb.viewOnly` muda no cliente e `src/adapters/computador/rfb-so-ver.ts`
   aplica a decisão de verdade no servidor, filtrando teclado, ponteiro, clipboard, resize, XVP, GII e tecla estendida.
3. A web mantém a última tela na queda, reconecta em 1, 2, 4 e 8 segundos e, depois de 30 segundos, ativa capturas a cada
   2 segundos. Sem VNC, clique, arrasto, rolagem, texto e tecla continuam pelas ações HTTP com revisão de quadro.
4. `src/adapters/computador/vivo.ts` cria uma sessão em memória, com token de uso único, limite de duas sessões por pessoa
   e tela, prazo de pareamento, reconferência a cada 10 segundos e filtro RFB. Os lados fecham juntos.
5. `src/adapters/voz/ws.ts` autentica a web por cookie, tenant e `Origin` do mesmo host, reconfere a sessão web e limita a
   fila a 8 MiB. O motor chega sem cookie, autenticado pelo id e token que vieram num comando assinado.
6. No caminho motor, o comando `vivo` vai pela fila assinada; o motor abre uma conexão exclusiva com o supervisor, que
   conecta ao socket Unix do x11vnc e transforma o canal em bytes RFB. O motor volta ao servidor por WebSocket e aplica
   contrapressão em 4 MiB, partindo mensagens em 32 KiB.
7. `src/adapters/fundo/computadores.ts` é o portão. `assumir` persiste `controle = pessoa`, impede o bot de agir e libera
   entrada na sessão; `devolver` persiste `controle = bot`, fecha ajuda pendente e retoma o bot; fechar a tela usa
   `fetch keepalive`. Mensagem nova da própria pessoa pode retomar o bot segundo as regras da ADR-138.
8. Estado durável fica no Postgres sob RLS. Frames SSE já carregam mudanças relevantes da máquina, cursor e
   `computador.mudou`, mas a tela cheia ainda lê o DTO por HTTP a cada 2 segundos para sincronizar controle e saúde.

### Provedores

- `src/contracts/provedor-computador.ts` e `src/adapters/computador/provedores/seletor.ts` já separam ciclo de vida e plano
  de dados. Docker e Orgo usam o mesmo `DriverComputador` do portão.
- O Orgo já implementa criação, saúde, screenshot, mouse, teclado, comando, arquivo e `acessoTela()`. A chave fica no
  cofre da pessoa, no conector `orgo`; não é cacheada nem logada.
- A lacuna é objetiva: `criarSessoesVivo()` e as rotas WebSocket só são montadas quando
  `env.NOD_COMPUTADORES === "motor"`. O seletor não expõe `acessoTela()` ao portão. Assim, `CAPACIDADES_ORGO.telaAoVivo`
  é hoje apenas uma declaração não consumida.
- O contrato atual de Orgo foi implementado a partir da documentação e de fakes; não houve chamada real. Em especial,
  `connection_url`, `vnc_password` e o handshake do websockify precisam de uma prova contra uma conta real.

### Segurança e isolamento

O Nod deve ser a base, não o Bot HQ, nestes pontos:

- controle durável por pessoa/bot e bloqueio das ações do bot enquanto a pessoa controla;
- tenant e pessoa em toda transação, propriedade do agente e RLS;
- `Origin` do mesmo host, sessão web revogável, token de pareamento de uso único e comparação em tempo constante;
- nenhuma porta VNC no motor: x11vnc apenas em socket Unix privado;
- contrapressão, limites de sessão e falha fechada no protocolo RFB;
- captura mascarada para o modelo, isolamento de perfil/workspace e limpeza do clipboard entre humano e bot;
- credencial do provedor no cofre e nunca no navegador.

Há dois riscos a corrigir antes de chamar a experiência de pronta:

1. Ao assumir, todas as sessões `assistir` abertas para a mesma tela recebem `entrada = true`. Duas abas podem enviar
   teclado e mouse simultaneamente. O estado “pessoa” é exclusivo contra o bot, mas não entre sessões da pessoa.
2. Um relay de provedor externo não pode aceitar uma URL arbitrária devolvida pela API. O adapter deve abrir o upstream
   ou validar esquema, host, caminho e id esperado; redirecionamentos, DNS privado e downgrade para `ws://` devem falhar.

### Mobile e testes

- A tela cheia já é responsiva por container, o modo celular é decidido por toque sem hover, há alvos de 44 px e auditoria
  em `390×844`. O mesmo noVNC escala para caber e o paste de texto tem tratamento próprio.
- Falta uma prova real de mouse por toque, teclado virtual, colar, rotação, background/foreground e reconexão em iOS e
  Android. O auditor de 44 px não abre a jornada do computador ao vivo.
- A cobertura unitária do transporte do Nod é maior que a do Bot HQ: pareamento, token errado, limite por tela,
  reconferência, filtro RFB, queda/reconexão, fallback, clipboard, x11vnc sem TCP, supervisor e controle. Falta um E2E que
  atravesse web → servidor → provedor real → VNC e prove que a entrada alterou a tela.

## Arquitetura alvo

Manter a URL pública e a UI atuais. Introduzir uma pequena porta interna de “origem RFB” na camada de adapters:

```text
web/noVNC
   │ cookie + tenant + Origin
   ▼
WS /computador/vivo ── sessão/controle/filtro/limites ── origem RFB
                                                        ├─ motor: comando assinado → WS de saída → socket Unix x11vnc
                                                        └─ provedor: adapter abre WS upstream e autentica o RFB
```

O portão continua escolhendo computador, pessoa, bot e controle. A origem RFB não decide autorização. Para provedor
externo, URL e segredo ficam encapsulados no adapter; o núcleo recebe um duplex de bytes, não uma credencial. O relay
termina a autenticação upstream e oferece RFB sem senha ao noVNC, como o Bot HQ. Isso evita expor a senha VNC no DOM,
DevTools, proxy corporativo ou relatório de erro.

Não criar outro viewer, outra rota nem outro estado de controle. Reutilizar:

- `web/telas/tela-cheia.ts`, `web/lib/tela-vivo.ts` e os estilos atuais;
- `criarSessoesVivo`, `criarFiltroRfb`, autenticação do upgrade, vigia de sessão e contrapressão;
- o portão `criarComputadores`, as operações `assumir/devolver`, RLS, atividade e retomada do bot;
- o contrato de capacidades e a escolha bot > pessoa > global > padrão;
- o fallback de capturas e as primitivas do provedor.

Adaptar:

- a composição, para montar sessões ao vivo quando o driver escolhido tiver `motor` **ou** `vnc_websocket`;
- o relay RFB autenticado do Bot HQ, reescrito na organização e nos limites do Nod e atribuído como MIT;
- `AcessoTelaAoVivo`, para o segredo não sair do adapter como dado que qualquer camada possa serializar;
- os frames SSE, para a tela cheia não depender de polling constante.

Reescrever:

- a posse do controle entre abas: um lease de entrada por sessão ao vivo, independente do simples estado
  `controle = pessoa`;
- os testes E2E de tela, porque os do Bot HQ não provam entrada e os do Nod não atravessam um provedor real.

## Fatias verticais

Cada fatia abaixo é um PR independente e deixa uma jornada utilizável.

### F1 — Assistir ao vivo num provedor externo

**Resultado para a pessoa:** abrir Computador num bot que usa Orgo mostra movimento contínuo; se o stream cair, a última
tela permanece, reconecta e depois cai para capturas sem travar a conversa.

**Código:** criar a porta interna de origem RFB; montar `sessoesVivo` fora do `computadorNoMotor`; ligar o provedor
selecionado à rota atual; implementar handshake upstream e relay; manter a web sem mudança de API.

**Reutilizar:** sessão, filtro watch, autenticação, limites, noVNC, reconexão e fallback do Nod.

**Adaptar do Bot HQ:** fila de bytes e handshake RFB upstream/browser, com timeout, tamanho máximo, logs redigidos e
atribuição MIT. Não copiar UI nem assets.

**Critérios verificáveis:**

- com fake VNC protegido por senha, o canvas recebe ao menos dois frames diferentes pela rota pública;
- senha/token não aparecem em resposta HTTP, URL da web, log, erro ou bundle;
- em `assistir`, eventos RFB de teclado, ponteiro e clipboard não chegam ao upstream;
- sessão revogada, tenant errado, Origin cruzado, URL upstream fora da allowlist, fila acima de 8 MiB e handshake
  inválido fecham a conexão;
- queda do upstream aciona reconexão e capturas no mesmo estado visual;
- motor continua passando os testes existentes sem mudança de protocolo.

**Riscos:** formato real do endpoint Orgo, autenticação dupla token + VNC, compatibilidade RFB e SSRF. A fatia só fecha
depois de um ensaio numa conta real; sem chave, o teste fica explicitamente marcado como não executado, nunca simulado
como prova de produção.

### F2 — Assumir e devolver, com uma única sessão dirigindo

**Resultado para a pessoa:** tocar em “Assumir o controle” libera mouse e teclado sem trocar o canvas; “Parar” bloqueia
entrada antes da resposta e devolve o bot ao trabalho.

**Código:** generalizar `vivo()`, `vivoAindaPode()` e `vivoPodeAssistir()` para o computador por bot dos provedores;
vincular o assumir ao id da sessão WebSocket; manter no máximo um lease de entrada por pessoa/tela e deixar outras abas
em watch; expirar o lease em close, logout, devolução, retomada do bot e prazo sem heartbeat.

**Reutilizar:** estado `controle`, transação/trava, atividade, fechamento da ajuda, `viewOnly` sem reconexão e filtro RFB.

**Reescrever:** `liberarDaTela()` não pode liberar todas as sessões. Deve liberar só a vencedora e publicar às demais que
continuam assistindo.

**Critérios verificáveis:**

- o primeiro clique depois do 200 do assumir chega uma vez à tela, sem novo WebSocket;
- duas abas concorrentes: só uma recebe entrada; a outra continua vendo e não manda `KeyEvent`/`PointerEvent`;
- fechar/recarregar a aba controladora devolve ou expira o lease sem prender o bot;
- `devolver` bloqueia bytes de entrada antes de responder e o próximo turno do bot reobserva a tela;
- mensagem nova, pedido de ajuda, Parar, operação administrativa e sessão web revogada respeitam as regras atuais.

**Riscos:** corrida assumir × fechar × retomar e perda do processo com controle persistido. A recuperação deve ser
determinística: sem sessão viva, ninguém dirige; a pessoa pode reassumir e o bot só retoma pela regra existente.

### F3 — Estado ao vivo sem polling e telemetria de sessão

**Resultado para a pessoa:** ligar, conectar, reconectar, fora do ar, assistindo e controlando mudam imediatamente, sem
piscar nem esperar o ciclo de 2 segundos.

**Código:** publicar frames tipados de sessão (`conectando`, `ao_vivo`, `reconectando`, `fallback`, `encerrada`) e de
controle no barramento existente; o reducer atualiza a tela cheia; HTTP periódico fica apenas como reconciliação depois
de SSE reconectar.

**Reutilizar:** SSE numerado/replay, `computador.estado`, `computador.mudou` e a máquina de estados visual atual.

**Critérios verificáveis:**

- assumir/devolver noutra aba atualiza a aberta por SSE em até um frame, sem polling;
- frame duplicado ou fora de ordem não regride estado;
- restart do servidor derruba o VNC, a web reconecta e reidrata por REST uma vez;
- métricas contam abertura, tempo até primeiro quadro, quedas, fallback e bytes/fila, sem ids externos ou segredos;
- alertas distinguem falha da web, servidor, provedor e computador.

**Riscos:** tempestade de frames e duas fontes de verdade. Persistência continua no Postgres; SSE só notifica e a
reidratação REST é autoritativa.

### F4 — Login assistido no celular

**Resultado para a pessoa:** no telefone, abrir o pedido de login, assistir, assumir, tocar/digitar/colar, rotacionar,
voltar de outro app e devolver ao bot funciona na mesma tela.

**Código:** conservar o viewer único; ajustar teclado virtual e viewport visual, foco do canvas, safe areas e barra de
controle; não criar versão mobile separada.

**Reutilizar:** consulta canônica de toque, tokens mobile, alvos de 44 px, tela cheia e `ligarColar`.

**Critérios verificáveis:**

- Playwright/WebKit e Chromium em `390×844`, toque real emulado: clique, arrasto, scroll, texto, Enter, Backspace e paste
  alteram a tela remota;
- a barra não encobre o alvo com teclado virtual nem em retrato/paisagem;
- background por 30 segundos e retorno reconectam sem liberar entrada a outra aba silenciosamente;
- auditoria de 44 px cobre sair, assumir e parar;
- ensaio manual em um iPhone e um Android registra vídeo e versão do navegador.

**Riscos:** limitações do teclado/clipboard no iOS, gesto de scroll capturado pela página e consumo de banda móvel.

### F5 — Prova ponta a ponta e lançamento gradual

**Resultado para a pessoa:** a jornada real fica disponível para um grupo pequeno, com fallback automático e evidência de
qualidade antes de ampliar.

**Código:** ensaio automatizado que cria/liga um computador descartável no provedor, abre uma página mutável, assiste,
assume, digita um nonce, devolve, deixa o bot observar o nonce e remove apenas o recurso criado pelo ensaio. Flag por
pessoa/bot permite desligar só o ao vivo, preservando capturas e ações.

**Critérios verificáveis:**

- E2E prova pixels mudando e texto digitado, não só a presença do canvas;
- repete queda do upstream, revogação da sessão, duas abas e fila lenta;
- p95 de primeiro quadro e taxa de queda ficam registrados; gatilho inicial: menos de 20% das sessões caem, conforme
  ADR-138, e nenhum segredo chega aos logs;
- rollback da flag volta a capturas sem derrubar computador, login ou turno;
- custo e limite do provedor são exibidos antes de criar a máquina.

**Riscos:** custo e quota do provedor, recursos órfãos e teste destrutivo. Todo recurso leva idempotency key, rótulo de
ensaio e limpeza por id exato.

## Ordem e fronteiras

F1 é o menor corte que transforma a tela do Orgo em produto ao vivo. F2 fecha a promessa “assumir/devolver” com
concorrência segura. F3 tira o polling e dá operação confiável. F4 fecha a jornada prioritária de login no telefone. F5
é o gate de produção. Não juntar provisionamento, voz, apps conectados, terminal PTY ou redesign visual nessas fatias.

## Dependências e configuração

Já presentes: `@novnc/novnc`, `ws`, Postgres/RLS, SSE, cofre, provider selector, x11vnc no motor e as primitivas Orgo.
Não é necessária nova dependência de UI. Se o handshake DES/RFB puro do Bot HQ for adaptado, registrar a atribuição MIT;
evitar uma dependência criptográfica ampla só para 16 bytes de desafio VNC.

Configuração do motor: `NOD_COMPUTADORES=motor`, `NOD_CREDENTIAL_KEY`, app/motor compatível e pacote `x11vnc` instalado.
Configuração do Orgo: `NOD_COMPUTADOR_ORGO=1`, escolha por `NOD_COMPUTADOR_PROVEDOR*` e `ORGO_API_KEY` no cofre da pessoa.
Configuração comum: segredo de sessão do Nod e login normal. Nenhuma chave VNC ou do provedor entra em env da web,
localStorage, banco de eventos, comentário ou métrica.

## Decisões que precisam ser explícitas no primeiro PR

1. A tela ao vivo é capacidade do computador escolhido, não uma flag global do servidor.
2. A autorização pertence ao portão do Nod; o provider só fornece o fluxo.
3. Só uma sessão dirige; qualquer quantidade limitada de sessões pode assistir.
4. O servidor termina a autenticação do VNC externo; o navegador nunca recebe a senha.
5. Capturas continuam como fallback, não como implementação principal.
6. A UI continua única para desktop, app e celular.
7. F1–F5 são cinco PRs; cada um mantém motor e captura funcionando e tem rollback por flag/capacidade.
