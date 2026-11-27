"""Raspa o catálogo público do Composio (docs.composio.dev/toolkits/<app>) para medir e avaliar o catálogo de apps sob demanda (XUM-11).
Uso: python3 -I scripts/catalogo-apps/raspar.py outlook gmail ... (grava catalogos/<app>.json, fora do git)."""
import re,json,sys,urllib.request
dec=json.JSONDecoder()
def linhas(txt):
    rows={}
    for m in re.finditer(r'(?:^|\n)([0-9a-f]+):',txt):
        rid=m.group(1); i=m.end()
        try: v,_=dec.raw_decode(txt[i:]); rows[rid]=v
        except Exception: pass
    return rows
def resolver(v,rows,d=0):
    if d>20: return v
    if isinstance(v,str) and re.fullmatch(r'\$[0-9a-f]+',v) and v[1:] in rows: return resolver(rows[v[1:]],rows,d+1)
    if isinstance(v,dict): return {k:resolver(x,rows,d+1) for k,x in v.items()}
    if isinstance(v,list): return [resolver(x,rows,d+1) for x in v]
    return v
def raspar(app):
    html=urllib.request.urlopen(f"https://docs.composio.dev/toolkits/{app}").read().decode()
    partes=re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)',html)
    txt="".join(json.loads(p) for p in partes)
    rows=linhas(txt)
    tools=[]
    for m in re.finditer(r'"tools":\[',txt):
        t,_=dec.raw_decode(txt[m.start()+8:])
        if any("input_parameters" in x for x in t): tools=t
    out=[]
    for t in tools:
        ip=resolver(t.get("input_parameters") or {},rows)
        if not isinstance(ip,dict): ip={}
        props={};req=[]
        for k,v in ip.items():
            if not isinstance(v,dict): continue
            p={kk:vv for kk,vv in v.items() if kk in("type","description","default","enum","examples","items","properties") and vv not in("$undefined",None,"")}
            if v.get("required") is True: req.append(k)
            props[k]=p
        tags=resolver(t.get("tags") or [],rows)
        tags=tags if isinstance(tags,list) else []
        out.append({"nome":t["slug"],"titulo":t.get("name"),"descricao":t.get("description",""),"readOnlyHint":"readOnlyHint" in tags,"destructiveHint":"destructiveHint" in tags,"importante":"important" in tags,"schema":{"type":"object","properties":props,"required":req}})
    return out
for app in sys.argv[1:]:
    try:
        o=raspar(app); import os; os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)),"catalogos"),exist_ok=True); json.dump(o,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"catalogos",f"{app}.json"),"w"),ensure_ascii=False)
        print(app,len(o),"leitura:",sum(1 for x in o if x["readOnlyHint"]),"importantes:",sum(1 for x in o if x["importante"]),"com params:",sum(1 for x in o if x["schema"]["properties"]),"chars:",sum(len(json.dumps(x["schema"],ensure_ascii=False))+len(x["descricao"]) for x in o))
    except Exception as e: print(app,"ERRO",repr(e))
