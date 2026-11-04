// Leitura da NF-e de saída (XML do ERP) no servidor. Só o que a conferência com a volumetria usa.
export function lerNfeSaida(xml: string) {
  const tag = (t: string, src = xml) => src.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? null;
  const chave = xml.match(/Id="NFe(\d{44})"/)?.[1] ?? null;
  const transp = xml.match(/<transp>([\s\S]*?)<\/transp>/)?.[1] ?? "";
  const vols = [...transp.matchAll(/<vol>([\s\S]*?)<\/vol>/g)].map((m) => m[1]);
  const soma = (t: string) => vols.reduce((s, v) => s + Number(tag(t, v) ?? 0), 0);
  const dest = xml.match(/<dest>([\s\S]*?)<\/dest>/)?.[1] ?? "";
  return {
    chave,
    numero: tag("nNF"),
    serie: tag("serie"),
    qVol: vols.length ? soma("qVol") : null,
    pesoB: vols.length ? Math.round(soma("pesoB") * 1000) / 1000 : null,
    pesoL: vols.length ? Math.round(soma("pesoL") * 1000) / 1000 : null,
    destCnpj: tag("CNPJ", dest) ?? tag("CPF", dest),
    valor: Number(tag("vNF") ?? 0),
  };
}
