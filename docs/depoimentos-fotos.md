# Fotos dos depoimentos (v3 / v4)

Como publicar a foto de um depoimento:

1. Salve o arquivo aqui, com o primeiro nome em minúsculas:
   `sidney.jpg` · `erica.jpg` · `marcelo.jpg` · `ricardo.jpg` · `diego.jpg`
2. Em `components/v3/testimonials-section.tsx` E `components/v4/testimonials-section.tsx`,
   troque `photo: null` por `photo: '/depoimentos/<arquivo>'` na pessoa correspondente.

Formato: quadrado (1:1), no mínimo 104x104px (renderiza a 52px em telas 2x).
JPG ou WebP, rosto centralizado. Enquanto `photo` for `null`, o card mostra um
avatar com as iniciais — a página não quebra sem a foto.
