import nodeAssert from "node:assert/strict";
import { lerNfeSaida } from "./nfe.ts";
import { corsHeaders, escaparHtml, igual } from "./comum.ts";

const XML = `<NFe><infNFe Id="NFe35260111122233000183550010000000771000000774" versao="4.00"><ide><nNF>77</nNF><serie>1</serie></ide>
<dest><CNPJ>45678912000155</CNPJ></dest><total><ICMSTot><vNF>3139.80</vNF></ICMSTot></total>
<transp><vol><qVol>2</qVol><pesoL>1.5</pesoL><pesoB>2.0</pesoB></vol><vol><qVol>1</qVol><pesoL>1.5</pesoL><pesoB>1.5</pesoB></vol></transp></infNFe></NFe>`;

Deno.test("lerNfeSaida soma volumes e pesos", () => {
  const nf = lerNfeSaida(XML);
  nodeAssert.equal(nf.chave, "35260111122233000183550010000000771000000774");
  nodeAssert.equal(nf.numero, "77");
  nodeAssert.equal(nf.qVol, 3);
  nodeAssert.equal(nf.pesoB, 3.5);
  nodeAssert.equal(nf.pesoL, 3);
  nodeAssert.equal(nf.destCnpj, "45678912000155");
  nodeAssert.equal(nf.valor, 3139.8);
});

Deno.test("lerNfeSaida sem bloco de volumes devolve nulos (a RPC marca divergência)", () => {
  const nf = lerNfeSaida(XML.replace(/<transp>[\s\S]*<\/transp>/, ""));
  nodeAssert.equal(nf.qVol, null);
  nodeAssert.equal(nf.pesoB, null);
});

Deno.test("CORS só devolve Allow-Origin para origem permitida", () => {
  const ok = corsHeaders("https://app.example.com", ["https://app.example.com"]);
  nodeAssert.equal(ok["Access-Control-Allow-Origin"], "https://app.example.com");
  nodeAssert.equal(corsHeaders("https://outro.example.com", ["https://app.example.com"])["Access-Control-Allow-Origin"], undefined);
  nodeAssert.equal(corsHeaders(null, ["https://app.example.com"])["Access-Control-Allow-Origin"], undefined);
});

Deno.test("igual compara em tempo constante e escaparHtml neutraliza marcação", () => {
  nodeAssert.ok(igual("abc", "abc"));
  nodeAssert.ok(!igual("abc", "abd"));
  nodeAssert.ok(!igual("abc", "abcd"));
  nodeAssert.equal(escaparHtml(`<script>"x"&'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;&lt;/script&gt;");
});
