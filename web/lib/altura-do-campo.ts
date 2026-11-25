/**
 * Rolagem da conversa por trás do campo (paridade com o Grok Bot): a timeline desce até o fim do palco e o campo fica
 * por cima dela, então o texto só some no fim do campo, não numa linha seca acima dele. Para a timeline saber quanto do
 * pé é do campo (ele cresce com o texto, os anexos e a faixa de Trabalhos), publicamos a altura do `#composer` em
 * `--campo-h` no palco; sem a medida, o CSS cai em 0 px e o layout antigo continua valendo.
 */
export function ligarAlturaDoCampo(doc: Document): () => void {
  const palco = doc.querySelector<HTMLElement>(".stage");
  const campo = doc.getElementById("composer");
  const janela = doc.defaultView;
  if (!palco || !campo || !janela || typeof janela.ResizeObserver !== "function") return () => {};
  const medir = (): void => {
    const altura = `${campo.offsetHeight}px`;
    if (palco.style.getPropertyValue("--campo-h") !== altura) palco.style.setProperty("--campo-h", altura);
  };
  const ro = new janela.ResizeObserver(medir);
  ro.observe(campo);
  medir();
  return () => {
    ro.disconnect();
    palco.style.removeProperty("--campo-h");
  };
}
