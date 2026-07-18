import type { RequestHandler } from "@sveltejs/kit";
import { createStatusStream, createMetricsReader } from "./status";

export const GET: RequestHandler = async () => {
  return createStatusStream(createMetricsReader());
};
