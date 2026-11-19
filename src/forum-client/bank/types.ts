import type { ActivityClientOptions } from "../activity-client.js";

export type BankClientOptions = ActivityClientOptions;
export type BankFailure =
  | {
      kind:
        "invalid-input" | "invalid-response" | "session-changed" | "network";
    }
  | { kind: "refused"; code?: string; message?: string };
export interface ForumBank {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly hasAccount: boolean;
  readonly url: string;
}
export type BankDirectoryResult =
  { kind: "bank-directory"; banks: readonly ForumBank[] } | BankFailure;

export type BankService =
  | "lobby"
  | "savings"
  | "fixed"
  | "transfer"
  | "loans"
  | "account"
  | "overview"
  | "rankings"
  | "trading";
export type BankOperation =
  | "open-account"
  | "close-account"
  | "deposit-current"
  | "withdraw-current"
  | "settle-interest"
  | "deposit-fixed"
  | "withdraw-fixed"
  | "transfer"
  | "change-password"
  | "apply-loan";
export type BankInput =
  | "banknum"
  | "daynum"
  | "touser"
  | "bankpass"
  | "bankpass2"
  | "newbankpass"
  | "newbankpass2";
export interface BankField {
  readonly name: BankInput;
  readonly type: "amount" | "days" | "recipient" | "password";
  readonly min: string | null;
  readonly maxLength: number | null;
}
export interface BankForm {
  readonly operation: BankOperation;
  readonly bankId: string;
  readonly recordId: string | null;
  readonly label: string;
  readonly context: string;
  readonly fields: readonly BankField[];
}
export interface BankWithdrawal {
  readonly bankId: string;
  readonly recordId: string;
  readonly label: string;
  readonly context: string;
}
export type BankBrowserHandoff = {
  readonly operation: "trade-points" | "repay-loan" | "cancel-loan";
  readonly destination: string;
  readonly bankId?: string;
  readonly recordId?: string;
  readonly context?: string;
};
export interface BankBlock {
  readonly text: string;
  readonly heading: boolean;
}
export interface BankServicePage {
  readonly kind: BankService;
  readonly bankId: string | null;
  readonly url: string;
  readonly page: number;
  readonly currency: string;
  readonly walletBalance: string;
  readonly summary: string;
  readonly interest: string;
  readonly notices: readonly string[];
  readonly blocks: readonly BankBlock[];
  readonly forms: readonly BankForm[];
  readonly withdrawals: readonly BankWithdrawal[];
  readonly handoffs: readonly BankBrowserHandoff[];
  readonly hasNext: boolean;
  readonly unsupportedForms: boolean;
  readonly transferFeeRate: string | null;
}
export type BankServiceResult =
  { kind: "bank-service"; service: BankServicePage } | BankFailure;
export interface BankLogQuery {
  received?: boolean;
  page?: number;
}
export interface BankLogEntry {
  readonly message: string;
  readonly time: string;
}
export type BankLogsResult =
  | {
      kind: "bank-logs";
      bankId: string;
      received: boolean;
      page: number;
      entries: readonly BankLogEntry[];
      hasNext: boolean;
    }
  | BankFailure;

export type BankValues = Readonly<Partial<Record<BankInput, string>>>;
export type BankEffectResult =
  | BankFailure
  | { kind: "not-confirmed" | "terms-changed" }
  | { kind: "unconfirmed"; operation: BankOperation; message?: string }
  | { kind: "uncertain"; operation: BankOperation };

export type BankConfirmationResult =
  | { kind: "bank-confirmation"; form: BankForm; withdrawal: BankWithdrawal }
  | BankFailure;
export interface BankClient {
  readBankDirectory(): Promise<BankDirectoryResult>;
  readBankService(
    service: BankService,
    bankId?: string,
    page?: number,
  ): Promise<BankServiceResult>;
  readBankLogs(bankId: string, options?: BankLogQuery): Promise<BankLogsResult>;
  prepareBankWithdrawal(
    record: BankWithdrawal,
  ): Promise<BankConfirmationResult>;
  estimateBankTransferFee(page: BankServicePage, amount: string): string | null;
  submitBankForm(
    form: BankForm,
    values: BankValues,
    approved: boolean,
  ): Promise<BankEffectResult>;
}
