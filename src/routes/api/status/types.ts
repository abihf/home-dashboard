export interface Usage {
	usage: number;
	percent: number;
}

export interface NetUsage {
	lastTx: number;
	lastRx: number;
}

export interface StatusResponse {
	cpuUsage: number;
	cpuTemp: number;
	memUsage: Usage;
	diskRoot: Usage;
	diskMedia: Usage;
	netUsage: NetUsage;
}
