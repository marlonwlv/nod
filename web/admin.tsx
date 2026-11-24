import { createRoot } from "react-dom/client";
import { apiDoServidor, PainelAdmin } from "./react/admin/painel.tsx";

/** ADR-193: /admin.html, o painel admin de uso (só leitura). Quem é admin o servidor decide; aqui só desenha. */
const raiz = document.getElementById("admin");
if (raiz) createRoot(raiz).render(<PainelAdmin api={apiDoServidor()} />);
