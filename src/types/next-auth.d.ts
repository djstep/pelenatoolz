import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }

  interface User {
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
  }
}
