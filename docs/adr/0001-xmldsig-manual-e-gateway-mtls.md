# 0001. Assinatura XMLDSig montada à mão e gateway para o mTLS da SEFAZ

## Contexto
A ciência da operação (evento 210210) exige um XML assinado com o certificado A1 da empresa, e os serviços de
distribuição da SEFAZ exigem TLS com certificado de cliente. As edge functions rodam em Deno. As bibliotecas
de XMLDSig disponíveis puxam DOM e canonicalização genérica, pesadas para um runtime de edge, e o cliente TLS do
runtime não fechou o handshake com os servidores da SEFAZ (cifras e cadeia antigas).

## Decisão
- A assinatura é montada em `sefaz/lib.ts` com `node-forge`: o evento é gerado já em forma canônica (C14N 1.0 é
  trivial quando se controla a serialização), o digest e a assinatura são RSA-SHA1, como o leiaute da NF-e ainda
  exige. O módulo não importa nada (o forge é injetado) e é testado com um certificado autoassinado criado no teste,
  verificando digest e assinatura como um validador faria.
- O mTLS passa por um gateway Node pequeno (`sefaz-gw`), que usa o OpenSSL do Node, aceita só destinos da SEFAZ,
  é autenticado por token e não guarda estado. A edge function usa o cliente HTTP do Deno só quando não há gateway.

## Consequências
- Sem dependência de uma biblioteca de assinatura; o custo é que só o evento de ciência é suportado. Outros eventos
  exigem estender a geração do XML canônico.
- O gateway recebe a chave privada a cada chamada. Ele roda sob controle de quem opera o sistema, em TLS, e não loga o
  corpo. É um risco aceito e documentado; a alternativa seria guardar o certificado no gateway.
- RSA-SHA1 é fraco, mas é o que o leiaute exige; o código não oferece escolha de algoritmo.
