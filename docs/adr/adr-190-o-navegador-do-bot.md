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
4. **Vista ao vivo por screencast, não por VNC.** O agent-browser já transmite quadros JPEG, abas e estado por
   WebSocket, e recebe `input_mouse` e `input_keyboard`. O servidor repassa à web em
   `/api/t/:tenant/agentes/:id/navegador/vivo`, só para a dona. A entrada da pessoa só passa com ela no controle.
   Nada do nod cobre a imagem (D1d): a pílula mora numa faixa de 52 px embaixo, como na tela cheia do computador.
5. **Onde mora** (`src/domain/navegador-lugar.ts`, M e N). A pessoa responde só "Continuar com o seu Mac desligado".
   - Desligado (padrão): o navegador roda no Mac, pelo app.
   - Ligado: roda "no nod" (o servidor), ou numa máquina sempre ligada da pessoa, pelo nome que ela deu ("na vm-sp").
     Com várias, vale a mesma em que o computador do bot mora.
   - Máquina fora do ar: roda no nod daquela vez, a não ser que a pessoa tenha travado "Só na vm-sp".
   - A frase de baixo sempre diz onde; "servidor", "VM" e "nuvem" nunca aparecem.
   - Na máquina da pessoa, o app puxa os comandos (ADR-021) e empurra os quadros por um WebSocket que ele mesmo abre.
6. **Logins sem o bot ver** (L).
   - `navegador_entrar` pede o login na conversa (azul) e oferece primeiro o item do cofre que casa com o site: cofre do
     nod (cifrado no servidor), 1Password (`op`, no app do Mac, ADR-177) ou Bitwarden (`bw`, no app do Mac).
   - O valor vai do cofre ao campo como digitação pelo canal de entrada do Chrome. Nunca passa por argv, log, conversa
     ou modelo.
   - Enquanto o segredo está na página, a vista e a leitura do bot ficam travadas até a URL mudar
     (`src/domain/navegador-sensivel.ts`). A árvore entregue ao modelo troca o valor de senha, cartão e código por
     `[campo protegido]`.
   - O código de SMS entra num campo privado do cartão e vai direto para a página.
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

## Gatilhos de reversão

- O agent-browser não aguenta (quadro ao vivo pior que 5 por segundo no Mac, ou queda de sessão mais de uma vez por
  dia de uso): trocar pelo CDP direto, pelo `capturador-cdp.ts` que já existe, mantendo as mesmas ferramentas.
- A classificação pelo rótulo erra um ponto sem volta em produção, deixando passar um pagamento ou envio: a classe
  passa a ser decidida também pelo formulário (método e destino da requisição) antes do clique.
- A pessoa reclama de perguntas demais em pagamento repetido: o teto de antemão (A2) vira padrão por site.
