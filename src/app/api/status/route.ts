import { NetUsage, StatusResponse, Usage } from "./types";
import sys, { Systeminformation } from "systeminformation";

export async function POST() {
  const [load, mem, fsSizes, temperature, net] = await Promise.all([
    sys.currentLoad(),
    sys.mem(),
    sys.fsSize(),
    sys.cpuTemperature(),
    sys.networkStats("enp4s0"),
  ]);

  const rootFs = fsSizes.find((fs) => fs.mount === "/");
  const mediaFs = fsSizes.find((fs) => fs.mount === "/media/data");

  const ethernet = net[0];
  const netUsage: NetUsage = {
    // percent: 0,
    lastTx: ethernet.tx_bytes,
    lastRx: ethernet.rx_bytes,
  };
  const status: StatusResponse = {
    cpuUsage: load.currentLoad,
    cpuTemp: temperature.main,
    memUsage: { usage: mem.active, percent: (100 * mem.active) / mem.total },
    diskRoot: diskUsage(rootFs),
    diskMedia: diskUsage(mediaFs),
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
