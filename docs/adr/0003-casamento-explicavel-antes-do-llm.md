# 0003. Casamento explicável antes do LLM

## Contexto
Cada item da NF do fornecedor precisa ser ligado a um item de pedido de venda, e as descrições raramente batem.
Errar o casamento põe a mercadoria no pedido errado. O operador precisa entender a sugestão para confirmar rápido.

## Decisão
A sugestão sai de uma pontuação determinística (`_shared/casamento.ts`): modelo em comum, similaridade de tokens, URL do
anúncio no marcador, memória de casamentos confirmados, exclusões duras (custo acima do preço de venda, NF anterior
ao pedido). Cada ponto vira um motivo legível na tela. Só quando a confiança não é alta, e só se houver um LLM
configurado, ele desempata entre os melhores candidatos. O LLM entra por uma porta (`ProvedorLLM`) com adaptador HTTP
genérico e um fake para testes; o texto da NF vai ao prompt como JSON (dado, não instrução) e a resposta passa por um
extrator estrito (JSON balanceado, `id` dentro da lista de candidatos, confiança válida). Resposta inválida cai na regra.
Toda sugestão nasce `sugerido` e o operador confirma; a origem (`regra`, `ia`, `manual`) fica gravada.

## Consequências
- O sistema funciona sem LLM, e o LLM nunca decide sozinho nem fora da lista de candidatos.
- A pontuação é testável com casos pequenos, e os pesos são constantes visíveis.
- O custo é manter os pesos à mão; a memória de confirmações compensa parte disso.
