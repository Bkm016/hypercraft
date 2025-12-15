import "./globals.css";
import Header from "@/components/header";
import localFont from "next/font/local";
import Script from "next/script";
import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import { Inter as FontSans } from "next/font/google";
import { NotificationProvider } from "@/components/ui/notification-provider";
import { Provider as TooltipProvider } from "@/components/ui/tooltip";
import { ServicesProvider } from "@/lib/services-context";
import { ThemeProvider } from "next-themes";
import { cn } from "@/utils/cn";

const inter = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMono[wght].woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Hypercraft",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(inter.variable, geistMono.variable, "antialiased")}
    >
      <head>
        <Script src="/config.js" strategy="beforeInteractive" />
      </head>
      <body className="bg-bg-white-0 text-text-strong-950">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <ServicesProvider>
              <TooltipProvider>
                <div className="flex h-screen flex-col overflow-hidden">
                  <Header />
                  <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
                </div>
              </TooltipProvider>
            </ServicesProvider>
          </AuthProvider>
        </ThemeProvider>
        <NotificationProvider />
      </body>
    </html>
  );
}
