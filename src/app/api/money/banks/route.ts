import { requireUser } from "@/server/auth";
import { banks } from "@/server/banks";
import { json,failure } from "@/server/http";
export async function GET(){try{await requireUser();return json(await banks());}catch(e){return failure(e);}}
