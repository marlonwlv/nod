# ADR-190 — O navegador do bot: um Chrome só dele, dirigido pelo agent-browser, ao lado do computador

Status: proposta (2026-11-20, frente "Navegador, computador e seu Mac") · Usa a [ADR-021](adr-021-a-ponte-de-execucao-o-app-local-puxa-o-servidor-nunca-di.md)
(a máquina puxa) e a [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (paridade), sem mudá-las · Fica ao lado da
[ADR-037](adr-037-computadores-por-bot.md) (computador do bot) e da [ADR-138](adr-138-tela-ao-vivo-por-vnc.md) (tela por
VNC), que seguem iguais · Executa o lado do navegador da [ADR-177](adr-177-dinheiro-e-segredos-sem-o-bot-ver.md) (o
segredo vai do cofre ao campo).

## Contexto

Em 2026-11-19 o Marlon decidiu que o nod terá três lugares para o bot trabalhar: o navegador, o computador próprio do
bot e o computador da pessoa. O navegador vem primeiro. Comparamos três referências:
- OpenMausBot: um Chrome headless por perfil, gerido pelo servidor com o agent-browser, visto por screencast JPEG.
- nightly-labs/openbot: Electron, CDP, 35 ferramentas com busca de catálogo, cofres e "Teach a task".
- CopilotKit/OpenBot: container com Playwright e portão de política.

A comparação está no artifact "Onde o bot trabalha".

Em 2026-11-20 ele recusou a recomendação de reaproveitar o Chrome do computador do bot. Ele quer o navegador como nas
referências, com paridade de recursos e a experiência em primeiro lugar. As decisões dele, uma por uma:
- **Motor:** o agent-browser, mais testado pela comunidade; trocar por um próprio só se não performar.
- **Aprovação:** fica, sem pesar na experiência.
- **Ferramentas:** as ~30, com catálogo enxuto, `eval` e script com travas, CSS e pixel.
- **Cofres:** 1Password, Bitwarden e o cofre do nod já na primeira entrega.
- **Ensinar tarefa:** já na primeira entrega.
- **Vista:** ao vivo, com boa experiência.
- **Lugar:** o navegador roda no servidor do nod ou no Mac, e a pessoa só responde se o bot continua com o Mac desligado.

As telas estão no Paper, arquivo "nod · Chat e conversa":
- linhas 1, 5 e 1+5;
- detalhes D0–D9, D1b, D1c e D1d;
- L (login e cofre), A (aprovações) e T (ensinar);
- M e N (onde mora);
- jornadas J e K.

## Decisão

1. **Um Chrome por bot, separado do computador.** O navegador do bot é uma sessão do agent-browser (versão fixa,
   `agent-browser@0.43.0`, binário nativo do pacote npm), com um perfil próprio por bot e o estado cifrado
   (`AGENT_BROWSER_ENCRYPTION_KEY`). Ele não toca no Chrome do Xvfb do computador (ADR-037). Os dois aparecem como
   lugares diferentes na tela: Navegador e Computador.
2. **Ferramentas `navegador_*`, origem `navegador` no plano.** São 12 diretas (`abrir`, `ler`, `clicar`, `preencher`,
   `tecla`, `rolar`, `esperar`, `ver`, `entrar`, `pedir_ajuda`, `buscar`, `usar`) e 19 no catálogo, chamadas por
   `navegador_buscar` e `navegador_usar` (`src/contracts/ferramentas-navegador.ts`). Referências como `@e3` valem só para
   a última leitura. O portão é `src/adapters/fundo/navegadores.ts`, no molde de `computadores.chamar`: catálogo,
   validade do plano, parada, esquema, controle, aprovação e trilha. O resultado volta não confiável.
3. **Aprovação só no ponto sem volta** (`src/domain/navegador-aprovacao.ts`, quadro A).
   - A classe sai do alvo que o SERVIDOR resolveu da última leitura (papel e nome acessível do botão), nunca do que o
     modelo diz.
   - Abrir, ler, preencher, rolar e baixar nunca pedem.
   - Apagar pede no manual e no automático.
   - Enviar pede no manual e vai ao revisor no automático.
   - Pagar pede sempre, com Touch ID, a não ser que a pessoa tenha dado um teto para aquele site (A2).
   - Trocar senha, e-mail ou segurança da conta é sempre a pessoa que faz.
   - "Não perguntar de novo" vale para destinos de envio, nunca para dinheiro (A3).
   - Como ficou (2026-11-20): o pedido entra na vista (`pedido.tipo "aprovacao"`, com a pergunta, o botão, a `caixa` do
     alvo e o `lembrar`) e se responde pela MESMA decisão (`POST /decisoes/:id/decidir`; o `sempre` do cartão é o
     "Não perguntar de novo"). O destino só vale se o `para` de `navegador_clicar` aparece no texto da página ou no título
     da aba. O combinado de antemão (A2) é a `navegador_combinar` do catálogo: a resposta grava o teto (ou o destino) por
     site em `liberacoes`. A web não tem o fluxo de passkey: pagar e o teto pedem o Touch ID do app do Mac
     (`systemPreferences.promptTouchID`, pela fila) na hora de executar, por qualquer caminho; sem o app, vale o botão e
     o cartão avisa. O revisor do Automático (ADR-115) ainda não olha o navegador: no automático, envio passa.
4. **Vista ao vivo por screencast, não por VNC.** O agent-browser já transmite quadros JPEG, abas e estado por
   WebSocket, e recebe `input_mouse` e `input_keyboard`. O servidor repassa à web em
   `/api/t/:tenant/agentes/:id/navegador/vivo`, só para a dona. A entrada da pessoa só passa com ela no controle.
   Nada do nod cobre a imagem (D1d): a pílula mora numa faixa de 52 px embaixo, como na tela cheia do computador.
   - Emenda (2026-11-20): o tamanho do Chrome do bot acompanha quem assiste. Com o Chrome fixo em 1280×720, o painel, a
     folha do celular e a gravação mostravam a imagem com uma faixa cinza enorme embaixo. A web manda pelo canal ao vivo
     `{t:"tamanho", w, h}` (a área da vista em CSS px) 600 ms depois do fim de um redimensionamento (`EntradaNavegador`;
     conferido em `lerEntradaNavegador`, 120–8192). O servidor põe o viewport (`set viewport` do agent-browser; na
     máquina, a operação `tamanho` da fila) em largura = clamp(round(w × 1,6), 800, 1440) e altura = largura × h / w,
     arredondada, até 2400 (`viewportDeQuemAssiste`). Só muda com mais de 4% de diferença em algum lado
     (`viewportMudouMuito`; era 8%, e o que sobrava virava faixa cinza embaixo da imagem; a faixa do aviso do site não conta). Sem ninguém assistindo, fica o último; o Chrome que liga de novo nasce no padrão e ganha o
     tamanho pedido quando fica ao vivo. Mudar o tamanho derruba a última leitura do bot: a referência velha ouve "a
     página mudou de tamanho; leia de novo". A vista enche a área, e o clique segue mapeado pelo tamanho real do quadro.
5. **Onde mora** (`src/domain/navegador-lugar.ts`, M e N). A pessoa responde só "Continuar com o seu Mac desligado".
   - Desligado (padrão): o navegador roda no Mac, pelo app.
   - Ligado: roda "no nod" (o servidor), ou numa máquina sempre ligada da pessoa, pelo nome que ela deu ("na vm-sp").
     Com várias, vale a mesma em que o computador do bot mora.
   - Máquina fora do ar: roda no nod daquela vez, a não ser que a pessoa tenha travado "Só na vm-sp".
   - A frase de baixo sempre diz onde; "servidor", "VM" e "nuvem" nunca aparecem.
   - Na máquina da pessoa, o app puxa os comandos (ADR-021) e empurra os quadros por um WebSocket que ele mesmo abre.
   - Como ficou (2026-11-20, atrás de `NOD_NAVEGADOR_NA_MAQUINA=1`, só no modo compartilhado): o portão fala com um
     motor remoto (`src/adapters/navegador/motor-remoto.ts`) que põe cada chamada na fila da máquina
     (`canal-maquina.ts`; long-poll `POST /api/maquina/navegador/puxar`, resposta em `navegador/resultado`). A máquina roda
     o mesmo `criarMotorAgentBrowser` (`src/adapters/executor/navegador.ts`), no app do Mac e no motor do Linux. A
     máquina que faz o long-poll é a que está "ligada" para o navegador. Um app conectado que não faz o long-poll é de
     uma versão sem o navegador, e a vista pede para atualizar.
   - A vista: o servidor manda `assistir` com um token de uso único. A máquina liga o stream local e disca para
     `/api/maquina/navegador/vivo/:agenteId?t=`. Sobem só `frame`, `tabs` e `status`. Descem a entrada (`input_*`) e o
     relay (tecla e `insertText`), conferidos de novo na máquina.
   - O lugar é decidido a cada chamada e a cada "ligar" (`decidirLugarDoNavegador`). As entradas são as preferências
     (0180, mais `no_nod` da 0181), as chaves vivas da pessoa (Linux = sempre ligada, na ordem de conexão), quem puxa o
     navegador agora e onde o computador do bot mora.
   - Espera: a vista vai a `erro` com a causa ("Seu Mac está desligado") e o bot lê a instrução. Desvio: roda no nod e
     a conversa ganha a linha "Fiz no nod" uma vez por queda.
   - O Chrome no Mac: o Google Chrome do sistema quando existe, senão o Chrome for Testing que o `agent-browser install`
     baixa na primeira vez (o bot ouve "tente em 2 min" enquanto isso). O binário do agent-browser vai fora do asar, em
     `Contents/Resources/agent-browser`.
   - O Chrome no Linux: `NOD_NAVEGADOR_CHROME`, senão o Chromium do computador em /opt/nod-motor/chromium, senão um do
     PATH. O agent-browser vem da instalação do motor, em /opt/nod-motor/navegador.
   - A chave que cifra os perfis na máquina é dela (`<dados>/navegadores/segredo`, 0600) e nunca vai ao servidor.
   - Como ficou na tela (2026-11-20, Paper M, J, K e N; `web/lib/navegador-lugar-tela.ts`):
     - A pergunta vem uma vez por bot, como cartão na conversa dele (`navegador_pergunta`). Ela aparece quando a pessoa
       cria uma rotina de um bot com navegador para uma hora em que o Mac costuma estar desligado, ou quando uma rotina
       vai usar o navegador com o Mac desligado. Sem histórico de uso do Mac, a hora conta como fora de 8h–20h
       (`macCostumaEstarDesligado`). A 0182 marca quando a pergunta foi feita e quando foi respondida.
     - Respondida, o cartão vira "Você escolheu: … · Desfazer".
     - O pedido feito pela conversa com o Mac desligado ganha o cartão "Seu Mac está desligado" (ação
       `navegador.mac_desligado`). "Fazer agora" liga o continuar e retoma o turno; "Quando o Mac ligar" guarda o turno
       (`retomar_turno_id`), que continua quando o app do Mac volta a puxar o navegador (`aoLigar` do canal).
     - O painel do bot tem a linha "Com o Mac desligado" com o interruptor. Sem o app, a linha vira "Onde a Ada
       trabalha", sem interruptor. Tocar na frase abre a lista de N.
     - A linha de atividade termina com o lugar ("· no nod").
6. **Logins sem o bot ver** (L).
   - `navegador_entrar` pede o login na conversa (azul) e oferece primeiro o item do cofre que casa com o site: cofre do
     nod (cifrado no servidor), 1Password (`op`, no app do Mac, ADR-177) ou Bitwarden (`bw`, no app do Mac).
   - O valor vai do cofre ao campo como digitação pelo canal de entrada do Chrome. Nunca passa por argv, log, conversa
     ou modelo.
   - Enquanto o segredo está na página, a vista e a leitura do bot ficam travadas até a URL mudar
     (`src/domain/navegador-sensivel.ts`). A árvore entregue ao modelo troca o valor de senha, cartão e código por
     `[campo protegido]`.
   - O código de SMS entra num campo privado do cartão e vai direto para a página.
   - Como ficou (2026-11-20): o cartão (`pedido.tipo "login"`) traz as opções sem segredo, montadas na hora: o cofre do
     nod do site e, com o app do Mac ligado, os itens do 1Password (`op item list`) e do Bitwarden (`bw list items`) que
     o app achou, pela fila da máquina (`mac-da-pessoa.ts`). Com o Mac desligado, os itens vistos por último ficam cinza.
     `POST /agentes/:id/navegador/login` preenche: o usuário por `fill`, a senha pelo relay do daemon (`focus` e
     `insertText`, medidos), nunca por argv. Com o navegador no próprio Mac, o segredo não sai dele; em outro lugar, o
     app o devolve pela ponte e o servidor preenche e esquece. "Trazer do meu Chrome" lê os cookies DAQUELE site do Chrome
     do Mac (o macOS pergunta pelo Keychain) e os grava pelo relay (`cookies_set`, medido). "Entrar eu mesmo" guarda o que
     a pessoa digita só em memória, cifrado, por 5 min, e oferece guardar no cofre quando a página muda.
7. **Ensinar uma tarefa** (T). Com a pessoa no controle, o nod grava páginas, cliques (nome do botão) e campos (o
   rótulo, nunca o valor), até 200 passos ou 10 min (`src/domain/navegador-ensinar.ts`). "Salvar e ensinar" manda uma
   mensagem da pessoa com `passos-gravados.txt` anexado. A tarefa fica guardada no bot e
   `navegador_tarefa_ensinada` a devolve.
8. **Limites.**
   - O navegador pausa com 10 min sem uso e guarda as abas (D0, decisão 6).
   - No servidor, no máximo `NOD_NAVEGADORES_MAX` Chromes vivos (padrão 4, como o OpenMausBot no servidor). Quando
     passa disso, a vista diz que está na fila.
   - O servidor de produção (e2-medium) já está cheio: navegador "no nod" em produção pede uma máquina à parte,
     `NOD_NAVEGADOR_NO_SERVIDOR=1` só onde couber. Sem ela, "no nod" responde "indisponível" com o motivo, e o bot usa o
     Mac.

9. **O perfil do Chrome do bot fica com `--password-store=basic`**, que o agent-browser liga sozinho (medido em
   2026-11-20). É um desvio consciente da regra do computador do bot (AGENTS.md). A proteção aqui são o perfil e o
   estado cifrados pela chave de cada bot (HKDF da `NOD_CREDENTIAL_KEY`), e o fato de as senhas virem do cofre na hora,
   sem o Chrome guardá-las.

10. **Onde a tela desvia das pranchetas, e por quê** (conferência final de 2026-11-20, prancheta por prancheta; a matriz e
    os prints lado a lado estão no PR #243). Vale o que vem depois na lista de pranchetas e os achados da crítica de
    interface que o dono aceitou:
    - **Largura do painel:** 40% da área (D5), não os 580 px das telas 1a e C1. A página aparece reduzida porque o
      Chrome do bot tem no mínimo 800 px de largura (item 4, emenda).
    - **Barra de cima:** só ícones nas ações (D1, item 2), não o "Abrir em aba" escrito da C1. Com um lugar só, o seletor
      vira rótulo, sem fundo nem botão (crítica, achado 11).
    - **Pílula:** a da tela cheia de hoje, com os ícones dela (D1b: "iguais aos da tela cheia de hoje"). Sem o app do
      Mac, pagar diz "Pagar sem Touch ID" (crítica). O "terminou" vai na pílula ("✓ Terminou · 16h04", no formato da
      linha de atividade), não sobre a imagem (D1d).
    - **Faixa de aviso:** "Precisa de você" fica só com o motivo; a ação é a da pílula (crítica, achado 10).
    - **Abas do Chrome no painel estreito:** a partir de 4 à vista, as de fundo ficam só com o favicon (crítica, achado
      6).
    - **Aba de lugar:** diz "Navegador"; o título da página está na aba do Chrome logo abaixo e na dica (crítica, achado
      11). O × fica sempre à vista, como nas abas de tarefa (validação de 2026-11-19). O clique direito diz "Assumir o
      controle" e "Fechar os outros lugares" (crítica, achado 15). A fileira começa pela pílula do bot, que é a Conversa
      (Paper 10c A).
    - **Linha de atividade:** no modo pílula diz "Ver" e abre o painel; "Abrir" é do modo abas (C1 e C2, linhas 1+5).
    - **Pergunta da aprovação:** o rótulo do botão do site e o domínio da página ("Pagar R$ 3.780 no flytap.com?"); o
      servidor não conhece o nome de marca ("na TAP").
    - **Nova tarefa:** ⌃N no navegador, ⌘N no app do Mac (o ⌘N do navegador abre janela; web/lib/atalhos.ts).

### Revisão de 2026-11-22: o controle assumido à mão (teste do dono)

Teste do IMDb: a pessoa assumiu o navegador, depois pediu outra tarefa, e a Ada ficou presa. A ferramenta respondeu "a
pessoa está com o navegador (ou ele espera um passo dela)", a Ada leu isso como "provavelmente uma verificação do
site", e devolver não retomou nada porque não havia pedido aberto. Comparado com o OpenBot (a chamada espera a aba ser
devolvida e continua) e o OpenMausBot (recusa clara; o controle volta sozinho depois de minutos sem a pessoa mexer):

- **Mensagem nova devolve.** O turno da conversa criado depois de a pessoa assumir recebe o navegador, como a mensagem
  nova já dispensa o pedido de login e de ajuda (ADR-191). A retomada de um turno antigo não tira o navegador dela.
- **Devolver retoma.** O turno que esbarrou no navegador com a pessoa fica guardado; devolver (ou a volta sozinha)
  o continua pela retomada de sempre (`retomarAposDevolverNavegador` → `enfileirarRetomada`).
- **Volta sozinho em 5 min parado** (`DEVOLVE_SOZINHO_MS`), com a pílula dizendo "Volta à Ada em 1 min" no último
  minuto. Não vale com pedido aberto (o bot espera a pessoa) nem gravando uma tarefa.
- **Frase clara**, sem proibir outro caminho (decisão do dono: ler por fora não faz mal): "A pessoa assumiu o controle
  do navegador… quando ela devolver, você é retomada e continua daqui." O pedido aberto tem a sua própria frase.

### Revisão de 2026-11-22: o Chrome do bot se apresenta como ele mesmo com janela

O IMDb (firewall da Amazon) devolvia "403 Forbidden" ao Chrome do bot. Sem janela (`--headless=new`), o Chrome se
denuncia por duas coisas: a palavra "HeadlessChrome" na identificação e `navigator.webdriver = true`, que vem da marca
de automação. O motor agora desliga a marca (`--disable-blink-features=AutomationControlled`) e informa a identificação
que o mesmo Chrome dá com janela: uma vez por processo, numa sessão à parte (perfil próprio, nenhum bot), pergunta
`navigator.userAgent` ao Chrome que o agent-browser escolhe e troca só "HeadlessChrome/" por "Chrome/". É o que o
OpenMausBot faz com o mesmo agent-browser. A primeira versão lia `--version` do binário e só valia com
`NOD_NAVEGADOR_CHROME`; no teste do dono o agent-browser escolhia o Chrome sozinho e o 403 voltou. Medido: 403 → a lista
de 2024 do IMDb abre normal, com 50 filmes.

Fica de fora, por ora: as marcas de Client Hints (`navigator.userAgentData.brands`) saem vazias com a identificação
trocada; o OpenMausBot as repõe por CDP em cada página e worker. Sites que barram por endereço de data center (o nod
no servidor, a vm-sp) ou com detecção mais forte (bancos, companhias aéreas) continuam pedindo a pessoa: é o pedido de
ajuda (CAPTCHA), não falha do navegador.

## Revisão de 2026-11-22: o navegador no PC (Windows), com tudo o que o Mac tem

Pedido do dono: o navegador do bot funciona no Windows com as mesmas coisas do Mac. No PC quem roda o trabalho é o motor
(ADR-151), não o app (que só abre a janela e pareia), então o navegador mora no motor do Windows:

- **Motor do navegador:** o agent-browser do Windows (`@agent-browser/cli-win32-x64-msvc`, `agent-browser.exe`, a mesma
  versão fixa) instalado pelo `irm …/windows | iex` em `%LOCALAPPDATA%\nod\navegador`. O PC que já tinha o motor e só
  recebe a atualização automática instala sozinho, na primeira vez que o bot usa o navegador, com o npm do Node do nod.
  O Chrome é o Google Chrome do sistema; sem ele, o Microsoft Edge (todo Windows 10/11 tem, e é Chromium); sem os dois,
  o `agent-browser install`. O ambiente do Chrome leva as pastas do sistema (SystemRoot, LOCALAPPDATA, USERPROFILE,
  TEMP), nunca variável do nod.
- **Cofres:** a mesma lógica do Mac. O `op` do 1Password vem do PATH, do WinGet ou de Arquivos de Programas e só roda
  com a assinatura Authenticode válida e emitida para a AgileBits (o par do Team ID no Mac). O `bw` é o `.exe` ou o atalho
  do npm, que vira `node <script>` sem o cmd.exe.
- **Trazer do meu Chrome no PC, pela extensão do nod (2026-11-23):** no perfil do dia a dia o Chrome do Windows
  prende os cookies a ele (`v20`, app-bound, Chrome 127+): nenhum programa de fora os abre, nem o próprio `chrome.exe`
  numa cópia do perfil, e o Chrome 136+ recusa a depuração no perfil padrão (medido no runner). O caminho é o do
  1Password: a extensão do nod (`extensao-chrome/`, MV3, só `cookies`, `nativeMessaging` e `alarms`) pergunta ao Chrome
  (`chrome.cookies.getAll`) e fala com o host do native messaging `app.nod.navegador`, que o motor registra em HKCU ao
  subir (sem admin; a atualização automática também leva) e que repassa, por um pipe do usuário com senha, ao motor.
  Só os cookies do site pedido saem, só quando a pessoa toca "Trazer do meu Chrome". Sem a extensão, a leitura pela
  cópia do perfil serve aos cookies `v10`; esbarrando nos `v20`, a pessoa ouve para instalar a extensão. Publicar a
  extensão na Chrome Web Store (a mesma chave do `key`, que fixa o id que o host aceita) é com o dono.
- **Confirmação de pagar:** o Windows Hello (rosto, digital ou PIN) pelo WinRT no PowerShell 5.1; sem ele configurado, a
  caixa do Windows com o motivo e OK/Cancelar (como o diálogo do Mac sem Touch ID).
- **Textos:** a vista diz o aparelho (`aparelho: "mac" | "pc"`), e o servidor e a web falam "seu PC" e "Windows Hello"
  no lugar de "seu Mac" e "Touch ID" (`textosDoAparelho`).
- **Prova:** o job `windows` da CI roda o agent-browser.exe com o Chrome do runner (abrir, ler, clicar, preencher, o
  stream e o relay do cofre), o "Trazer do meu Chrome" (a cópia lê o v10; no perfil padrão, o v20 vira a recusa com o motivo), o op.exe oficial e o bw reais, o npm instalando
  o agent-browser como o motor faria, o WinRT do Windows Hello carregando e a conferência do Authenticode.

## Revisão de 2026-11-25: no Mac e no Windows, só o navegador

Pedido do dono: o computador do bot (ADR-122) fica desligado no Mac e no Windows até a reestruturação do computador e da
experiência; nessas máquinas o bot trabalha só com o navegador desta ADR.

- **Por quê.** Em 24/11 a Micherlaine (só um PC Windows) pediu ao bot para abrir o WhatsApp Web. O computador dela estava
  "fora do ar" desde 19/11 (`maquina_sem_contato`: o Windows anuncia `sem_suporte`, ADR-147, e ela não tem outra máquina).
  O plano saía sem `computador_*` e com "Seu computador está fora do ar… Não tente contornar", e o bot recusou três vezes,
  embora as `navegador_*` estivessem no plano. Medido em produção nos 14 dias até 25/11: 1.450 ações do computador
  concluídas em máquinas Linux (o motor de teste do Marlon e a "Linux - Bots" do Bruno) e nenhuma fora delas.
- **Como ficou.** No modo motor (`NOD_COMPUTADORES=motor`), o computador só mora numa máquina Linux da pessoa
  (`COMPUTADOR_NO_MAC = false` em `src/domain/computador-canal.ts`: o Mac não entra em `escolherMaquina`, `lugarPadrao`
  nem `opcoesDeLugar`). Quem não tem máquina Linux viva (`maquinaTokens.temLinuxViva`) fica sem computador
  (`src/use-cases/computador-tem-lugar.ts`): o plano sai sem `computador_*` e sem a frase do fora do ar, a frota não
  acende o fora do ar e marca `semComputador` (a web esconde o bloco Computador do painel e a linha do perfil no celular),
  e `GET /computador` responde 404 (a vista do navegador mostra só o lugar Navegador). Com máquina Linux, nada muda.
- **Reverter.** `COMPUTADOR_NO_MAC = true` religa o Mac (ADR-127 §5) para quem tem a VM local; o Windows continua
  `sem_suporte` até existir o computador no Windows.

## Gatilhos de reversão

- O agent-browser não aguenta (quadro ao vivo pior que 5 por segundo no Mac, ou queda de sessão mais de uma vez por
  dia de uso): trocar pelo CDP direto, pelo `capturador-cdp.ts` que já existe, mantendo as mesmas ferramentas.
- A classificação pelo rótulo erra um ponto sem volta em produção, deixando passar um pagamento ou envio: a classe
  passa a ser decidida também pelo formulário (método e destino da requisição) antes do clique.
- A pessoa reclama de perguntas demais em pagamento repetido: o teto de antemão (A2) vira padrão por site.
