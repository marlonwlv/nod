# ADR-167 — O visual do Grok Bot: tokens por base, fonte do sistema e a casca do front

Status: proposta · Data: 2026-11-12 · Emenda a [ADR-070](adr-070-design-system-grafite-e-cor-do-agente.md) (tokens, Geist, balão na cor do
bot da NOD-431) e à [ADR-060](adr-060-menu-da-conta-sidebar-e-gaveta-por-niveis.md) (barra lateral). Telas 01–04, 08 e 16/16b do Paper
"nod x Grok Bot"; decisões do Marlon de 12/11/2026 (DECISOES.md da engenharia reversa do Grok Bot v1.0.1).

## Contexto

O Marlon decidiu trazer para o nod o comportamento e o visual do Grok Bot (Anysphere). O nod tinha tokens literais por
tema, a Geist servida pelo app, ~40 tamanhos de fonte soltos (corpo 12–13), três sombras, sombra escura no tema escuro, o
balão da pessoa sempre na cor do bot e o ⌘K só filtrando a barra. Uma frente de pesquisa avalia migrar o front para
React; até a decisão, o design system precisa sobreviver a qualquer camada de tela.

## Decisão

1. **Uma base, tudo por opacidade.** `--base` (`#1c1c1c` claro, `#f5f5f5` escuro). Texto, linha e superfície são a base
   achatada sobre o fundo da conversa (hex sólido, contraste estável); interação (`--hover` 6 %, `--ativo` 9 %,
   `--borda-*`) é translúcida por `color-mix`. Os nomes antigos (`--ink`, `--surface`, `--line`…) continuam e passam a
   valer os valores derivados. Desvio do Grok: texto terciário a 64 % no claro (o Grok usa 56 %, que dá 3,9:1) e a linha
   de controle a 52 %/45 % (3:1, a regra da ADR-070).
2. **Fonte do sistema** (`-apple-system`/SF Pro no Mac) no lugar da Geist; escala fechada de 7 tamanhos
   (26/22/17/14/13/12/11, `--fs-*`, `--lh-*`) com corpo 14 e conversa 14/22. Os CSS do computador foram migrados para a
   escala por script (`font-size`, `border-radius`, curva e duração das transições). Os do celular (ADR-094) e os de
   outras frentes (quadro, onboarding, cartões de aprovação) ficaram como estavam: herdam cor e fonte pelos tokens e
   migram a escala quando forem mexidos.
3. **Raios em escala** (`--raio-2` … `--raio-22`, `--raio-full`) e **cinco níveis de sombra** (`--sombra-controle`,
   `-inline`, `-popover`, `-modal`, `-janela`). **No escuro não há sombra**: todo nível vira a borda clara sutil
   (branco a 10–14 %). `--shadow-pop/-composer/-knob` viram aliases desses níveis.
4. **Movimento nomeado** (`--dur-instantaneo` 50 … `--dur-gaveta` 500, `--curva` = `cubic-bezier(.22,1,.36,1)`), que
   zera sozinho com `prefers-reduced-motion`, e o **shimmer** de carregando (`.ds-shimmer`, `.ds-esqueleto`).
5. **Componentes isolados em `web/ds.css`**: só classes e tokens, carregado depois dos CSS do computador e antes dos do
   celular. A lógica nova é pura e sem DOM (`web/lib/aguardando.ts`, `ajustes.ts`, `paleta.ts`, `sons.ts`, `balao.ts`);
   o que liga ao documento recebe dependências injetadas (`paleta-na-tela.ts`). Nada disso depende do render por string
   do `main.ts`: uma migração de framework reaproveita tokens, CSS e modelos e reescreve só a cola.
6. **Balão da pessoa preto por padrão**; a cor do bot (NOD-431) vira a opção "Cor do bot nos balões" em Configurações
   (deste computador, `nod.balao`, aplicada antes do primeiro quadro). O bot fala sem balão.
7. **"Aguardando você" sem caixa nem sino** (telas 16/16b): na linha do bot a prévia vira "Aguardando você: {motivo}" em
   laranja (`--aguardando`) com o ponto laranja; o avatar da grade ganha o ponto laranja; **azul só para não lido**.
   Clicar abre a conversa rolada até o cartão pendente, com halo laranja. O sino e o ícone de Trabalhos do topo saem; a
   linha fixa **Trabalhos** entra abaixo dos fixados, com o contador discreto e "N aguardando" (um pedido: a conversa no
   cartão; vários: Sua vez).
8. **⌘K é a paleta de tudo** (bots, trabalhos, ajustes com o caminho, ações com o atalho). No celular segue a busca de
   tela cheia (ADR-094).
9. **Atalhos novos** que não colidem: ⌘B (barra só com avatares, agora 88 px), ⌘, (Configurações), ⌘I (campo), ⌘L
   (seleção vira citação no campo), ⌘⇧N (nova sala). No navegador do Mac (⌃) ⌃B ⌃I ⌃L ficam com o campo de texto.
   ⌘[ ] da pílula e as regras por plataforma da NOD-117 não mudam.
10. **Configurações**: catálogo de ajustes com título e frase (começa por verbo), busca no topo das seções e link por
    ajuste (`#ajuste=<id>`, "copiar link" no hover da linha).
11. **Sons opcionais** de mensagem e de pedido de aprovação, sintetizados com Web Audio (sem arquivo), desligados por
    padrão, deste computador.
12. **Seletor de modelo** em todo campo que fala com um bot só (conversa e task); a sala, com vários bots, fica sem.

## Consequências

- Uma cor nova continua entrando só em `web/tokens.css` (`cores-por-token.test.ts`, agora também sobre `ds.css`).
- Quem mexer num CSS de fora da migração usa `--fs-*`, `--raio-*` e `--dur-*` nas linhas que tocar.
- Os textos que leem a barra ("esperando sua decisão") continuam no `aria-label`; o visual é que mudou.

## Gatilho de reversão

- Se a fonte do sistema render pior que a Geist em Windows/Linux (o fallback é Segoe UI/system-ui), voltar a Geist só
  fora do Mac, sem mudar a escala.
- Se o laranja de "aguardando" e o âmbar de `--warning` forem confundidos em uso real, juntar os dois num tom só.
