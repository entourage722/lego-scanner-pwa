import { json, getSessionUser } from "../../_lib/utils.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env);
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);
      return json({ user });
      }
      
