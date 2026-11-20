---
name: qa-ponta-a-ponta
description: >-
  QA de ponta a ponta do nod no navegador: percorre as jornadas da pessoa, as ferramentas do bot e os cenários de volume
  em busca de problemas de front (layout, animação, componente fora do lugar ou fora do design system), de
  funcionamento (jornada ou componente que não faz o que promete, bugs), de volume, de acessibilidade, de resiliência e
  de paridade tela × chat. Sobe um ambiente descartável, distribui as áreas entre agentes, reproduz cada achado antes de
  registrá-lo e entrega um relatório com severidade e evidência. Use antes de uma release, depois de juntar várias
  frentes numa branch, ou quando pedirem "testar tudo", "QA geral", "teste de ponta a ponta", "mapear problemas",
  "rodada de testes".
---

# QA de ponta a ponta

O objetivo é achar o que a pessoa veria de errado, não provar que o código está certo. Cada achado precisa de passos
para reproduzir, do que era esperado, do que aconteceu e de uma evidência (captura, vídeo, log ou trecho de rede).
Achado que não se reproduz duas vezes não entra no relatório; vai para "instáveis", com o que se sabe.

O mapa das jornadas e das ferramentas está em [jornadas.md](jornadas.md). Ele é o checklist mínimo: a rodada cobre
tudo o que está lá ou diz, no relatório, o que ficou de fora e por quê.

## 1. O ambiente (nunca o banco diário)

Dois servidores descartáveis, cada um com o seu banco efêmero. Nunca a porta 5434 nem o volume `nod_nod_pgdata`.

| Servidor | Para quê | Executor | Banco | API | Web |
| --- | --- | --- | --- | --- | --- |
| **real** | jornadas e ferramentas | `claude-cli` (gasta assinatura) | `npm run db:efemero:up -- qa-real 5438` | 8892 | 5278 |
| **carga** | volume e resiliência | `catcher` (custo zero) | `npm run db:efemero:up -- qa-carga 5437` | 8891 | 5277 |

As portas são sugestões: confira com `lsof -nP -iTCP -sTCP:LISTEN` e use outras se alguém já estiver testando nelas.

- Suba cada um com as variáveis que o `db:efemero:up` imprime, mais `NOD_API_PORT`, `NOD_WEB_PORT`, `NOD_LOGIN=stub`,
  `NOD_EXECUTOR`, `NOD_HOME` próprio (`~/.nod-qa-real`, `~/.nod-qa-carga`) e `NOD_CAPTURA_TELA=1` (a ação
  `tela.capturar`, só leitura). Para o computador, `NOD_COMPUTADORES=docker` com a imagem `nod-computador:1` construída
  (`npm run computador:build`); o modo docker não tem tela ao vivo nem área de trabalho, que só existem no `motor`:
  registre isso como limite do ambiente, não como bug.
- Rodando dentro do Claude Code, tire `CLAUDECODE`, `CLAUDE_CODE_*` e `ANTHROPIC_*` do ambiente do servidor, senão o
  CLI do bot se recusa a rodar aninhado.
- Confira antes de começar: o log tem `nod_no_ar` com o executor certo, a web responde 200 e a tela mostra o selo
  âmbar **Efêmero · DB <porta>**.
- O seed cria duas pessoas (use as duas para testar o que uma não pode ver da outra) e a Vera. Cada agente da rodada
  cria os **próprios** bots com prefixo da área (`QA chat 1`, `QA quadro 2`…) e só mexe neles.

## 2. Como dirigir o navegador

Use o Chrome for Testing do cache do Playwright pelo DevTools, como `scripts/carga-tela/cdp.ts` (`abrirChrome`,
`Runtime.evaluate`, `Input.dispatch*`, `Page.captureScreenshot`). Um perfil por agente, numa pasta própria do
scratchpad. Escreva os roteiros em `.ts` no scratchpad e rode com `mise exec -- node roteiro.ts` (o Node 24 tira os
tipos).

Em cada jornada:

- **Duas larguras:** computador (1440×900) e celular (390×844, com toque). **Dois temas:** claro e escuro
  (`localStorage nod.tema`).
- **Capture** antes, durante e depois de cada passo que anima. Para animação, grave quadros (`Page.startScreencast`)
  ou faça capturas a cada ~50 ms na transição. Uma captura não mostra piscada; uma sequência mostra.
- **Escute:** `Runtime.consoleAPICalled` e `Runtime.exceptionThrown` (todo erro de console é achado), `Network.*`
  (toda resposta 4xx/5xx inesperada é achado) e o log do servidor (`"nivel":"erro"`).
- **Meça:** layout shift (`PerformanceObserver` de `layout-shift`), tempo até a resposta aparecer, tempo para abrir um
  bot.

## 3. O que conta como problema

| Categoria | Exemplos |
| --- | --- |
| **front/layout** | sobreposição, corte, texto que estoura, alinhamento, espaçamento fora da escala, rolagem horizontal, salto de layout |
| **front/animacao** | piscada, animação que reinicia, salto de rolagem, transição que falta ou dura demais, movimento com `prefers-reduced-motion` |
| **front/lugar** | componente na região errada, ordem errada, elemento duplicado, foco perdido depois de uma ação |
| **front/design-system** | cor literal fora de `web/tokens.css` (sem a marca `cor-fixa:`), raio, sombra, fonte ou ícone que não é do `web/design-system.html`, componente que não segue o protótipo do Paper |
| **funcionamento/jornada** | a jornada não chega ao fim, chega errada ou exige um passo que a tela não oferece |
| **funcionamento/componente** | botão que não faz nada, estado que não atualiza sem recarregar, menu que não fecha |
| **funcionamento/bug** | exceção, 500, dado errado, estado preso (como o computador em "aguardando você" sem saída) |
| **volume** | travamento, rolagem lenta, ordem errada, memória crescendo, lista que não pagina |
| **ferramenta** | ferramenta do bot que falha, devolve erro sem sentido, não aparece na tela ou some do catálogo |
| **a11y** | sem foco visível, sem rótulo para leitor de tela, contraste baixo, alvo menor que 44 px no celular, teclado que não alcança |
| **resiliencia** | o que quebra ao recarregar no meio do turno, ao reiniciar o servidor, com a rede caindo ou com duas abas |
| **paridade** | ação que a tela faz e o chat não faz (ou faz diferente) contra o que `docs/paridade.md` declara como `vivo` |
| **seguranca** | uma pessoa vê ou muda o que é da outra; dado sensível em log, URL ou mensagem |
| **texto** | erro de português, jargão técnico na tela, mensagem de erro crua, nome de referência externa |

**Severidade.** **P0**: perde dado, vaza dado ou trava a jornada principal sem saída. **P1**: a jornada não funciona,
mas há contorno. **P2**: funciona, mas com defeito visível. **P3**: acabamento.

## 4. A rodada

1. **Preparar:** os dois ambientes da seção 1, conferidos.
2. **Explorar por área,** um agente por área de [jornadas.md](jornadas.md), cada um com os próprios bots. Cada agente
   devolve os achados no formato da seção 5 e a cobertura: o que percorreu e o que não conseguiu percorrer.
3. **Volume** no servidor **carga**: 60 bots (criados pela API, não pela tela), uma conversa com 1.000 mensagens e 5 bots
   respondendo ao mesmo tempo. Complemente com `node scripts/carga-tela/rodar.ts` (a régua da ADR-061) e
   `node scripts/alvos-44px/rodar.ts`.
4. **Ferramentas** no servidor **real**: para cada grupo de `src/contracts/ferramentas-*.ts`, uma mensagem que leve o
   bot a usar a ferramenta e uma conferência do efeito, na tela e na API. Os grupos que mexem fora (credenciais,
   apps conectados, ligação, máquina na nuvem) só entram até onde não exigem conta real: registre o resto como "não
   coberto".
5. **Reproduzir:** cada achado é refeito por um agente que não o encontrou, partindo dos passos escritos. Dois de três
   precisam reproduzir. O que não reproduz vai para "instáveis".
6. **Juntar e deduplicar:** mesmo sintoma na mesma tela é um achado só, com as jornadas em que aparece.
7. **Crítico de cobertura:** um agente lê o relatório contra [jornadas.md](jornadas.md) e lista o que ficou sem teste.
   O que faltar vira outra volta da etapa 2.
8. **Entregar** o relatório da seção 6.

## 5. O formato do achado

```json
{
  "id": "QA-001",
  "categoria": "front/animacao",
  "severidade": "P2",
  "area": "chat",
  "titulo": "A resposta do bot pisca ao trocar o indicador pelo balão",
  "passos": ["Abrir o bot QA chat 1", "Enviar 'oi'", "Esperar a resposta"],
  "esperado": "O indicador sai em 140 ms e o balão sobe 12 px, sem quadro vazio",
  "observado": "Dois quadros sem nada entre o indicador e o balão; o balão aparece sem subir",
  "ambiente": { "servidor": "real", "largura": 1440, "tema": "claro" },
  "evidencias": ["<scratchpad>/qa/chat/pisca-01.png", "<scratchpad>/qa/chat/pisca.webm"],
  "suspeita": "web/telas/conversa.ts:1353 (blocoDaFalaSaindo)",
  "reproduzido": 2
}
```

A suspeita de código é opcional e nunca substitui a evidência. Nada de dado pessoal real nas capturas.

## 6. O relatório

Uma página com: o resumo por severidade e categoria; os P0 e P1 primeiro, cada um com passos e evidência; a cobertura
(jornadas percorridas × não percorridas, ferramentas testadas × não testadas, e por quê); os instáveis; e os limites do
ambiente. Publique como artefato quando for para o time. No fim, derrube os dois servidores e os dois bancos
efêmeros (`npm run db:efemero:down -- qa-real 5438` e `qa-carga 5437`) e remova os computadores criados pela rodada.

## Regras

- **Não corrija durante a rodada.** Achar e consertar são etapas diferentes; consertar no meio muda o que os outros
  agentes estão vendo.
- **Custo:** as jornadas no servidor real gastam assinatura. Diga no começo quantos turnos a rodada deve gastar e
  avise se passar.
- **Repo público:** o relatório que for para o GitHub não cita nomes internos nem a referência externa de design.
