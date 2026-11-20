# ADR-173 — O nod no Mac: Quick Chat, captura, ferramentas do Mac e os estados do computador

Status: proposta · Data: 2026-11-12 (frente "Mac e Quick Chat", pesquisa de referência) · Estende a
[ADR-048](adr-048-github-um-conector-varios-jeitos-de-conectar.md) (efeito "na máquina") a um segundo conector, emenda a
[ADR-149](adr-149-atualizacao-automatica-do-app-do-mac.md) (reiniciar sozinho com o Mac ocioso) e usa a
[ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md) sem mudá-la (só a leitura dos estados).

## Contexto

O Marlon decidiu em 12/11 trazer para o nod, desligados por padrão: as ferramentas do Mac (Mail, Notas, Calendário,
Lembretes, Contatos e iMessage), o controle de tela do macOS, o Quick Chat com captura, o avatar solto na área de
trabalho e a atualização com o Mac ocioso. Premissa: entregar em horas,
copiando comportamento e visual, nunca código. O repo está congelado (NOD-485): o PR é de transição e não é mesclado.

## Decisão

1. **Ferramentas do Mac são UM conector, `mac`, com efeito na máquina (como o `github` da ADR-048).** Onze capacidades
   (`src/contracts/mac.ts`), cada uma de uma família. O servidor decide catálogo, concessão, aprovação e trilha; o
   proxy MCP do turno executa no Mac (`executarLocal`). Item aprovado depois do turno roda no app ou no motor, pelo
   mesmo despachante (`src/adapters/conectores-locais/maquina.ts`), que confere o nome `mac__<capacidade>`.
2. **Fora do macOS elas não existem.** O plano do turno tira as ferramentas `mac__*` quando a máquina do turno não é um
   Mac da pessoa (`ferramentasMacNoPlano`); o conector `mac` de outra pessoa sai sempre. Na máquina, a primeira trava é
   `process.platform === "darwin"`.
3. **Família desligada por padrão, liga na máquina.** Nove interruptores (Ler o Mail, Enviar pelo Mail, Notas,
   Calendário, Lembretes, Contatos, Ler o iMessage, Enviar iMessage, Controlar a tela) em Configurações › Máquinas, só no app do Mac.
   Moram em `~/.nod/ferramentas-mac.json` (0600), lidos pelo proxy a cada chamada; sem arquivo ou corrompido = tudo
   desligado. Ligar não aprova nada: a escrita (`readOnlyHint: false`) passa pela aprovação de sempre.
4. **AppleScript/JXA com o dado como `argv`.** Scripts constantes; o que vem do modelo é validado no domínio
   (`src/domain/mac.ts`) e entra só como argumento do `osascript` (execFile, sem shell). O iMessage lê o `chat.db` com
   `sqlite3 -readonly` (Acesso Total ao Disco) e envia pelo app Mensagens. Recusa do macOS vira frase para a pessoa
   (Automação, Acesso Total ao Disco), nunca o código do erro.
5. **Quick Chat é a mesma página em modo compacto.** Atalho global (padrão ⌥Espaço, configurável, recusa o que outro
   app usa) abre uma janela de 560×392 (revisto em 2026-11-12, rodada 3 do Paper: era 608×440, mas o cartão da tela 10 tem 560×392 e o resto era sombra), sem moldura, flutuando em todas as mesas, na partição e com o preload da janela
   web. A página lê `?janela=quick-chat` e esconde barra, cabeçalho e detalhes; o topo traz o seletor de bot, ⤢ e ✕.
   Nenhuma ponte nova além de funções nomeadas, validadas no processo principal (o remetente aceito passa a ser a
   janela principal OU a do Quick Chat).
6. **Captura pelo `screencapture -i` do macOS.** Região, ou Espaço para janela (o gesto do ⇧⌘4); a janela do Quick
   Chat sai da frente durante a captura. O PNG vira um anexo comum do composer (teto de 10 MB). Sem módulo nativo.
7. **Controle de tela do macOS no mesmo conector.** `tela_ver`, `tela_clicar`, `tela_digitar`, `tela_tecla` e
   `tela_rolar` (família `controle_tela`): o mouse por CoreGraphics pela ponte ObjC do JXA, o teclado pelo System
   Events (Acessibilidade), e o print da tela principal em PONTOS (`screencapture` + `sips`, JPEG) anexado ao resultado
   de cada ação. As ações de escrita passam pela aprovação. O "overlay" do cursor é o próprio cursor do
   macOS, que vai ao ponto antes do clique.
8. **Avatar do bot solto na mesa.** Uma janela transparente de 88×88 por bot (até 6), sem moldura, por cima dos apps,
   só com o mascote: clicar abre o Quick Chat já na conversa dele (o mini-composer e o popout são o Quick Chat). Montar
   e tirar pelo alfinete do topo do Quick Chat ou pelo × do avatar; a posição fica em preferencias.json.
9. **Tela 11: cinco estados derivados.** Conectando, Ao vivo, Reconectando (sem contato há até 60 s ou operação longa),
   Sem conexão (com Tentar de novo e Ver máquinas) e Em repouso, lidos do que GET /computador já devolve
   (`web/lib/computador-estados.ts`), no topo da aba Computador do bot.
10. **Atualiza sozinho com o Mac ocioso.** Versão pronta + 15 min sem teclado/mouse + nada rodando (turno, tela do
   computador, ligação) + nenhuma janela do nod em foco → reinicia; uma tentativa a cada 30 min.

## Alternativas recusadas

- **Módulos nativos de ScreenCaptureKit e um app auxiliar dono das permissões (outro desenho possível).** Separa melhor as
  permissões TCC, mas exige build nativo, assinatura de um segundo bundle e não cabe em horas. Gatilho de reversão:
  a pessoa precisar de captura sem interação (o bot tirando print sozinho) ou o macOS atribuir a permissão ao processo
  errado.
- **Uma página própria para o Quick Chat.** Duplicaria composer, anexos e envio. A página compacta reaproveita tudo.

## Fora desta ADR (próximos passos)

O `mac` no Marketplace e no prompt (hoje o conector nasce no primeiro `pedir_acesso` com `conector: "mac"`, mas o
prompt ainda não cita o slug); o overlay desenhado com o nome do bot sobre o cursor (pede uma ponte do proxy ao app);
a prévia da última fala no mouse sobre o avatar; o menu "Montar na área de trabalho" no clique direito do bot.
