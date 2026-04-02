import type { Metadata } from "next";
import { DM_Sans, Plus_Jakarta_Sans, Outfit, Sora, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://eidosform.com.br'),
  openGraph: {
    title: 'EidosForm — Formulários que convertem',
    description: 'Crie formulários conversacionais com rastreamento de pixels, validação de CPF/CNPJ e preço em real.',
    url: 'https://eidosform.com.br',
    siteName: 'EidosForm',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'EidosForm — Formulários que convertem',
      },
    ],
  },
  title: "EidosForm - Crie Formulários Incríveis",
  description: "Construa formulários bonitos e envolventes em minutos. Gratuito e open source pela Eidos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${plusJakarta.variable} ${outfit.variable} ${sora.variable} ${inter.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
