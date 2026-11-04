import type { Metadata } from "next";
import { MedeoSans } from "medeo-font/sans";
import { APP_BRAND } from "@/shared/brand";
import { ThemeProvider } from "@/shared/theme/theme-provider";
import { ToastProvider } from "@/shared/ui/toast";
import { ConfirmProvider } from "@/shared/ui/confirm/confirm-provider";
import { UnsavedChangesProvider } from "@/shared/ui/unsaved/unsaved-changes-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_BRAND,
  description: "Платформа управления кинопроизводством",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${MedeoSans.variable} h-full`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">
        <ThemeProvider>
          <ToastProvider>
            <UnsavedChangesProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </UnsavedChangesProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
