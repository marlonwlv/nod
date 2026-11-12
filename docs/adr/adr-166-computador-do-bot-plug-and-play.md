# ADR-166 — O computador do bot é plug and play: uma interface de provedor e a escolha por configuração

Status: proposta · Data: 2026-11-12 (frente "Plataforma e time", engenharia reversa do Grok Bot) · Emenda a
[ADR-037](adr-037-computadores-por-bot.md) ("o `DriverComputador` permite substituir Docker por um provedor de máquinas
remotas") e convive com a [ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md) (motor) e a
[ADR-127](adr-127-supervisor-do-computador-na-vm-do-mac.md) (VM do Mac).

> Numeração: 166 em diante; a 164 é da frente de aprovações e a 165 fica para a do design system.

## Contexto: por que o computador falha hoje

O Marlon pediu o computador do bot "plug and play": trocar de provedor (Docker próprio hoje, um serviço de terceiros
amanhã, outro mais barato depois) sem reescrever. Lendo o código, os docs e o histórico (31 commits sobre o computador
desde 18/09), o que faz ele ser difícil de pôr de pé é estrutural, não um bug:

1. **Três pilhas que não se falam, escolhidas por uma flag do servidor inteiro.** `NOD_COMPUTADORES=docker` (ADR-037:
   container por bot, runtime `infra/computador/runtime.mjs`, uma ação = um `docker exec … client.mjs`),
   `NOD_COMPUTADORES=motor` (ADR-122: um computador por pessoa com systemd, bwrap, supervisor e comandos assinados numa
   Debian 12/13) e a VM do Mac (ADR-123/127: Lima vz, disco baixado e conferido por sha256, macOS 13+). Uma pessoa ou um
   bot não escolhe; o servidor escolhe para todos, e cada caminho tem a sua própria instalação e o seu próprio modo de quebrar.
2. **A interface tem a forma do motor.** `DriverComputador` mistura o ciclo (iniciar/parar) com sete métodos opcionais que
   só o motor tem (`operar`, `trocar`, `lugares`, `vivo`, `apagarPerfil`, `maquinaDoComputador`, `reconciliarSaidasPendentes`).
   Um provedor novo não sabe o que é obrigatório, e o plano de dados é "entenda a `AcaoComputador` inteira" — o que exige o
   runtime do nod (Playwright + Xvfb + cofre) dentro da máquina. Nenhum serviço de fora roda isso.
3. **Dependências pesadas no host.** O caminho Docker precisa de Docker de pé, imagem multi-arquitetura pré-construída
   (`npm run computador:build`, QEMU para a outra arquitetura) e 2 GiB + 2 CPUs por computador, com teto de 3 por host.
   Medido nesta frente (12/11): o Docker deste Mac (colima) estava desligado — `docker ps` falha com o socket ausente — e o
   Mac de 8 GB tinha 1,2–2,1 GB livres; o computador simplesmente não liga. A NOD-162 mediu boot frio de 6 a 25 s e uma
   falha `navegador_nao_abriu` (o Playwright estoura 30 s) com o host carregado.
4. **O motor e a VM pedem um Linux específico.** systemd, bwrap, `IPAddressDeny`, Debian 12/13, units novas e o
   supervisor com chave X25519 (o e2e roda numa `e2-standard-4` na GCP, `docs/e2e-computador-vm.md`); no Mac, Lima vz,
   macOS 13+, memória livre para a VM e o disco do release. Cada um é um ponto de falha que a pessoa não consegue consertar.
5. **Estado preso ao host.** Volumes Docker nomeados, perfil do Chromium com `SingletonLock` (a queda de 22/09 da emenda da
   ADR-037), órfãos para limpar à mão; não há snapshot nem migração entre hosts (a ADR-037 deixou de fora).

## Decisão

1. **Uma interface de provedor** (`src/contracts/provedor-computador.ts`, `ProvedorDeComputador`):
   - ciclo de vida obrigatório: `ambiente`, `criar` (idempotente), `iniciar` (cria se preciso e espera pronto), `parar`
     (guarda o disco), `retomar`, `saude` (sem mudar nada), `ligados`;
   - opcional por capacidade: `suspender` (memória), `snapshot`/`restaurar`, `excluir`, `acessoTela` (VNC por WebSocket);
   - plano de dados de UM de dois jeitos: `executar` (a máquina tem o runtime do nod: Docker, motor) **ou** `primitivas`
     (tela, clique, arrastar, digitar, tecla, rolar, comando, abrir URL — o que todo serviço de fora oferece);
   - `capacidades` declaradas (retomar com memória, snapshot completo/só cópia/nenhum, tela ao vivo, terminal, navegador
     por Playwright ou só pela tela, áudio, onde roda).
2. **Uma camada genérica refaz a semântica do nod sobre as primitivas**
   (`src/adapters/computador/provedores/primitivas.ts`): quadro com revisão e prazo de 2 min (`tela_alterada`), arquivos
   só dentro da pasta de trabalho (conferido antes e de novo com `realpath -m` na máquina), 512 KiB por arquivo, texto
   paginado a 5500 caracteres escapados com revisão sha256 (a mesma conta de `infra/computador/texto.mjs`), escrita em
   pedaços de 64 KiB (o `bash -c` do Linux não aceita argumento acima de 128 KiB), terminal com 20 s e 30 000 caracteres.
   O que a máquina não tem (texto da página, abas, diálogo JS, áudio, anexar) responde `acao_falhou` com o que fazer pela
   tela — nunca um sucesso de mentira. Assim um provedor novo implementa ~8 chamadas HTTP e herda o resto.
3. **O seletor monta o `DriverComputador` de sempre** (`provedores/seletor.ts`). O portão (`fundo/computadores.ts`), as
   ferramentas `computador_*`, o plano de turno e o agente não mudam. A cada chamada ele escolhe o provedor do
   computador e delega; `ligados` é a união. Se a escolha muda com o computador ligado, desliga no antigo antes de ligar
   no novo (log `computador_provedor_trocado`). **Arquivos e logins não migram entre provedores**: cada um tem o seu disco.
4. **A escolha é configuração** (`src/domain/provedor-computador.ts`, lida só no boot, em `compor.ts`), com precedência
   **bot > pessoa > global > padrão**:

   | Variável | Exemplo | Efeito |
   |---|---|---|
   | `NOD_COMPUTADORES=docker` | | o de antes: liga o computador e é o padrão |
   | `NOD_COMPUTADOR_PROVEDOR` | `orgo` | provedor global |
   | `NOD_COMPUTADOR_PROVEDOR_POR_PESSOA` | `{"<pessoaId>":"orgo"}` | por pessoa |
   | `NOD_COMPUTADOR_PROVEDOR_POR_BOT` | `{"<agenteId>":"docker"}` | por bot (`repos.computadores.agenteDoComputador`, sem trava) |

   Valor desconhecido ou JSON torto é ignorado com aviso no boot (`computador_provedor_config`) e nunca vira outro
   provedor: um erro de digitação não pode mandar o computador de alguém para a nuvem de um terceiro. Provedor escolhido e
   não montado falha fechado (`nao_iniciou`), sem cair em outro. Sem nenhuma variável, nada muda.
5. **O motor fica no caminho próprio.** Ele é um computador POR PESSOA com uma tela por bot (`porPessoa` no portão), não
   cabe na escolha por bot. `NOD_COMPUTADORES=motor` continua como está; o seletor só existe fora dele.
6. **Docker adaptado** (`provedores/docker.ts`): veste o driver de sempre (nenhuma linha do `subir` mudou) e acrescenta
   saúde explícita e **snapshot dos volumes** (-home e -workspace copiados para `…-foto-<rótulo>-*` com a própria imagem
   do computador, `--network none`, só com o computador desligado; restaurar é a cópia de volta). `excluir` não existe:
   volumes guardam logins de alguém (ADR-037).
7. **Orgo como driver de exemplo** (`provedores/orgo.ts`, atrás de `NOD_COMPUTADOR_ORGO=1`). Escrito pela documentação
   (docs.orgo.ai, spec 2.0.0), sem conta: os testes usam um `fetch` falso. **A chave é da pessoa e mora no cofre**: o
   conector `orgo`, chave `ORGO_API_KEY`, guardada pelo cartão do `pedir_credencial` (alvo `conector`). O driver a lê do
   cofre a cada chamada (`chaveDe(escopo)` em `compor.ts`), só no header `Authorization`; nunca no env do servidor, no
   código, na URL, no corpo, no log ou no detalhe do erro (teste). Os computadores ficam no workspace `nod` da conta da
   pessoa, com o nome `nod-<id do computador>` (não há listagem de computadores no Orgo: o id deles vem do workspace).
   Opções: `NOD_ORGO_URL`, `NOD_ORGO_WORKSPACE_NOME`, `NOD_ORGO_RAM_GB` (padrão 4).

## Como o Orgo cobre a interface

| Operação da interface | Orgo (API REST `https://www.orgo.ai/api`) | Cobertura |
|---|---|---|
| criar | `POST /computers` {workspace_id, name, os, ram, resolution} + `Idempotency-Key` | completa; boot "em segundos", template acelera |
| iniciar | `POST /computers/{id}/start` (de `frozen`/`stopped`), `…/resume` (de `suspended`), espera pela saúde | completa; novo `instance_id` e host a cada partida do arquivo |
| parar | `POST /computers/{id}/stop` — arquiva o disco, libera host e IP, fica `frozen` | completa (o parado não custa compute) |
| retomar (com memória) | `POST /computers/{id}/suspend` e `…/resume` | completa no Linux sem GPU |
| snapshot | `POST /computers/{id}/clone` (cópia do disco num computador novo); `fork` copia até a memória | **parcial**: não há foto nomeada nem restaurar no lugar; `clone` exige o computador ligado e conta como computador novo no plano |
| restaurar | — | **falta** (contornável: trocar o vínculo para o clone) |
| excluir | `DELETE /computers/{id}` | completa (irreversível) |
| saúde | `GET /computers/{id}/health` (não muda nada) + `POST …/heal` | completa; mais rica que a do Docker |
| tela (captura) | `GET /computers/{id}/screenshot?response_format=base64&format=png` | completa |
| tela ao vivo | `wss://www.orgo.ai/desktops/{instance}/ws/websockify?token=<vnc_password>` (noVNC); WebRTC opcional | completa no provedor; **falta no nod** o proxy dessa sessão para a web (hoje a tela ao vivo é só do motor, ADR-138) |
| mouse e teclado | `POST click` (botão, duplo, repetição), `drag`, `type`, `key` (keysyms do X), `scroll` | completa |
| terminal | `POST /computers/{id}/bash` (até 300 s, saída combinada + código); PTY por WebSocket `…/ws/terminal` | completa (o driver usa o `bash`) |
| arquivos | pelo `bash` (base64 em pedaços), dentro de `/root/workspace` | completa pelo shell; `/files/upload` e `/files/export` são a loja do workspace (URL assinada, até 2 GB) e ficam para arquivos grandes |
| navegador | Chrome na máquina, controlado **pela tela**; abrir URL é um comando | **parcial**: não há CDP/Playwright exposto — sem texto da página, URL, abas nem diálogo por API; o bot lê a imagem |
| áudio | `…/ws/audio` (stream do alto-falante) | **falta no driver** (o nod quer WAV curto; dá para gravar o stream) |
| teto de ligados | conta da pessoa (50 computadores, vCPU/RAM do plano) | não ocupa o host do nod: `ligados()` vazio |

## Consequências

- Trocar de provedor é escrever um arquivo em `adapters/computador/provedores/` com ~8 chamadas (as primitivas) e o ciclo,
  pôr o id em `PROVEDORES_COMPUTADOR` e no `compor.ts`. Nada no agente, nas ferramentas, no portão nem na web.
- O Docker de hoje continua idêntico com `NOD_COMPUTADORES=docker` (os 132 testes do computador passam sem mudança).
- Com um provedor só de tela, o bot perde o texto da página e o controle de abas do Playwright; as instruções de erro
  dizem o caminho pela tela. Quem precisa do texto continua no Docker ou no motor.
- Custos: o Orgo cobra da conta da pessoa (plano ou hora). O nod não cria conta, workspace pago nem computador sozinho:
  só quando a pessoa configurou o provedor, guardou a chave e o bot ligou o computador.

## Fora deste recorte

Escolher o provedor pela tela (hoje é env; o canal natural são as flags remotas por pessoa da ADR-168), migrar arquivos
e logins entre provedores, proxy da tela ao vivo por VNC de um provedor de fora para a web, áudio no Orgo, e um segundo
provedor de fora (E2B, Daytona, Cua, Scrapybara, Browserbase, Morph) — o contrato foi desenhado para eles, mas só o Orgo
foi lido a fundo.

## Gatilho de reversão

Se, em 30 dias com um provedor de fora ligado para alguém, mais de 20% das ações `computador_*` desse provedor falharem
com `acao_falhou` por falta de capacidade (texto da página, abas, diálogos), o contrato "só primitivas" não basta: exigir
dos provedores de fora um navegador controlável (CDP) e mover o runtime do nod para dentro deles.
