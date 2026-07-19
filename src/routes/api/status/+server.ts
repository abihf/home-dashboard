import { createMetricsReader, createSystemMonitor } from "./status";

import type { RequestHandler } from "@sveltejs/kit";

const monitor = createSystemMonitor(createMetricsReader());

export const GET: RequestHandler = async () => {
  const stream = monitor.stream();
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
    },
  });
};
