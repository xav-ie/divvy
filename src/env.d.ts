declare namespace App {
  interface Locals {
    /** The signed-in user and database; set by src/middleware.ts on every route but /healthz. */
    ctx: import("./services/context.ts").Ctx;
    /** The auth mode in effect (pages show picker-only actions from it). */
    auth: import("./config.ts").AuthConfig;
    /** The email this request proved (the Access JWT's, in access mode). */
    email: string;
  }
}
