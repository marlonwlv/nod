# ADR-179 — A barra lateral redimensionável

Status: aceito · Data: 2026-11-12 · Substitui o ADR-060 na parte da barra (o item 3, "Sidebar de 340 px", e a emenda de
2026-10-29 da NOD-119, densidades e encaixes). O resto do ADR-060 (menu, arrastar bots, gaveta por níveis) continua.

## Contexto

A NOD-119 deu à barra duas densidades (Confortável e Compacta, escolhidas em Configurações › Aparência) e uma borda que só
encaixava em larguras fixas, a cada 40 px arrastados (272 ↔ 88; 200 ↔ 56, e 340 alargada). Na prática eram cinco estados
que a pessoa não via nomeados, uma escolha a mais em Aparência e uma borda que não seguia a mão. A especificação de
detalhes (item 1, "Barra lateral") pede o gesto comum dos outros apps: arrastar a borda até a largura que se quer.

## Decisão

1. **Larguras.** Padrão 340 px na primeira abertura. A expandida vai de 240 a 400 px, com o máximo limitado pela janela:
   `min(400, janela − 424 − painel da direita)`, o chat nunca com menos de 424; se der menos de 240, vale 240. A compacta
   tem 88 px (só avatares). O grid é `var(--largura-barra) minmax(0, 1fr) auto` (a 3ª coluna é o painel do bot, 360 px,
   e some com ele fechado). O máximo é recalculado no resize da janela; a largura guardada não muda quando a janela encolhe.
2. **Puxador.** Uma div de 12 px centrada na borda, invisível (sem linha nem cor no hover), `col-resize`,
   `role="separator"`, `aria-label="Redimensionar barra lateral"` e o valor em px. O arrasto é ao vivo e 1:1, sem
   animação e sem elástico acima do máximo. Abaixo de 208 px (240 − 32) a barra anima até 88 com o botão ainda apertado;
   a compacta reabre a partir de 216 px, em 240, e segue o ponteiro (a histerese evita piscar na fronteira). ← e → mudam
   16 px. Duplo clique não faz nada. Grava ao soltar.
3. **⌘B** alterna compacta e expandida, voltando à última largura expandida (340 → 88 → 340), em 200 ms
   `cubic-bezier(0.22, 1, 0.36, 1)`: a coluna, as linhas (100% → 54 px), nome e prévia por opacidade e flex-grow, e o
   rodapé compacto 80 ms depois. Com `prefers-reduced-motion`, troca seca.
4. **Memória.** `{larguraExpandida, compacta}` em JSON na chave `nod.barra.largura` (web/lib/densidade.ts); no app do Mac
   também no `preferencias.json` do userData (src/contracts/desktop-barra.ts, validado no processo principal), que o
   preload repõe antes da página. O index.html aplica antes do primeiro quadro, com as mesmas contas (um teste confere).
   A chave antiga `nod.densidade` é migrada uma vez: as recolhidas → compacta (340 guardado); a Compacta → 240; o resto
   → 340. O valor antigo no `preferencias.json` volta pela chave antiga e a web o migra.
5. **Sai a escolha "Densidade"** de Configurações › Aparência. O card do chat (`ajustar_barra_lateral`) continua: "só
   avatares" = a compacta, "compacta" = 240 expandida, "normal" = a última largura expandida.
6. **Prévia na compacta.** O mouse parado 280 ms num bot abre à direita um cartão de 260 px (mini-avatar, nome e a
   última mensagem em até duas linhas), `aria-label="Prévia do chat de {nome}"`. No foco e nos outros botões, a
   etiqueta curta de antes.

## Alternativas descartadas

- **Manter os encaixes e só trocar os números:** continua a borda que não segue a mão, e a escolha em Aparência fica.
- **Duplo clique restaurando o padrão:** é o comportamento de alguns editores, mas some com a largura que a pessoa
  escolheu por um clique a mais acidental; a spec pede que não faça nada.

## Gatilho de reversão

A preferência vive só no computador, sem métrica no servidor; o gatilho é observável na equipe: se em 30 dias (até
2026-12-12) a largura livre gerar relatos de barra "perdida" (estreita ou larga demais sem saber voltar) em mais de um
membro do time, ou se o arrasto ao vivo pesar na tela (quadro acima de 16 ms no `carga-tela` durante o arrasto), voltar
aos encaixes fixos (240 / 340 / 88) mantendo o mesmo puxador, a memória e o ⌘B.
