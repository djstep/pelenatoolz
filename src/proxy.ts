import createMiddleware from "next-intl/middleware";
import { routing } from "@/shared/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // /privacy — адрес из текста политики, язык подставит next-intl.
  matcher: ["/", "/privacy", "/(ru|en)/:path*"],
};
