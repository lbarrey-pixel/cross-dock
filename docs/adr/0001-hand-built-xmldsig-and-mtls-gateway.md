# 0001. Hand-built XMLDSig signature and a gateway for SEFAZ mTLS

## Context
Operation awareness (event 210210) requires an XML signed with the company's A1 certificate (a file-based Brazilian digital certificate), and the distribution services of SEFAZ (the Brazilian state tax authority) require TLS with a client certificate. The edge functions run on Deno. The available XMLDSig libraries pull in a DOM and generic canonicalization, which are heavy for an edge runtime, and the runtime's TLS client did not complete the handshake with the SEFAZ servers (old ciphers and an old certificate chain).

## Decision
- The signature is built in `sefaz/lib.ts` with `node-forge`: the event is generated already in canonical form (C14N 1.0 is trivial when you control the serialization), and the digest and the signature are RSA-SHA1, as the NF-e (Brazilian electronic invoice) layout still requires. The module imports nothing (forge is injected) and is tested with a self-signed certificate created in the test, checking the digest and the signature the way a validator would.
- mTLS goes through a small Node gateway (`sefaz-gw`), which uses Node's OpenSSL, accepts only SEFAZ destinations, is authenticated by token, and keeps no state. The edge function uses Deno's HTTP client only when there is no gateway.

## Consequences
- No dependency on a signature library; the cost is that only the awareness event is supported. Other events require extending canonical XML generation.
- The gateway receives the private key on every call. It runs under the control of whoever operates the system, over TLS, and does not log the body. This is an accepted, documented risk; the alternative would be to store the certificate on the gateway.
- RSA-SHA1 is weak, but it is what the layout requires; the code offers no choice of algorithm.
