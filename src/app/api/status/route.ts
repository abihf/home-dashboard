import sys, { type Systeminformation } from "systeminformation";
import type { NetUsage, StatusResponse, Usage } from "./types";

export async function POST() {
  const [load, mem, fsSizes, temperature, net] = await Promise.all([
    sys.currentLoad(),
    sys.mem(),
    sys.fsSize(),
    sys.cpuTemperature(),
    sys.networkStats("enp4s0"),
  ]);

  const ethernet = net[0];
  const netUsage: NetUsage = {
    lastTx: ethernet.tx_bytes,
    lastRx: ethernet.rx_bytes,
  };

  const status: StatusResponse = {
    cpuUsage: load.currentLoad,
    cpuTemp: temperature.main,
    memUsage: { usage: mem.active, percent: (100 * mem.active) / mem.total },
    diskRoot: diskUsage(fsSizes.find((fs) => fs.mount === "/")),
    diskMedia: diskUsage(fsSizes.find((fs) => fs.mount === "/media/data")),
    netUsage,
  };
  return Response.json(status);
}

function diskUsage(fs?: Systeminformation.FsSizeData): Usage {
  if (!fs) return { usage: 0, percent: 0 };
  return {
    usage: fs.used,
    percent: (100 * fs.used) / fs.size,
  };
}
