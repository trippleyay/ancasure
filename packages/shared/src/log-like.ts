/** Minimal log shape shared by fixtures and real receipts. */
export interface LogLike {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
}

/** Minimal receipt shape. */
export interface ReceiptLike {
  status: number;
  transactionHash: string;
  logs: LogLike[];
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
}
