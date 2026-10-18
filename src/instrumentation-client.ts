import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    {
      path: "/api/auth/register",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
    {
      path: "/api/auth/register-check",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
    {
      path: "/api/auth/register-code",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
  ],
});
