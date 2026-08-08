export type ProviderKey = "tencent" | "cloudflare" | "aliyun" | "volcengine";

export type PublicConfig = {
  provider: ProviderKey;
  secretId: string;
  secretKeySaved: boolean;
  endpoint: string;
  region: string;
};

export type DomainSummary = {
  domainId: string;
  provider: ProviderKey;
  providerLabel: string;
  name: string;
  status: string;
  dnsStatus: string;
  gradeTitle: string;
  recordCount: number;
  remark: string;
  updatedOn: string;
};

export type VerifyResult = {
  ok: boolean;
  message: string;
  requestId?: string;
  domainCount?: number;
  domains: DomainSummary[];
};

export type DnsRecord = {
  recordId: string;
  name: string;
  recordType: string;
  line: string;
  lineId: string;
  value: string;
  ttl: number;
  mx: number;
  status: string;
  updatedOn: string;
  remark: string;
  defaultNs: boolean;
};

export type RecordForm = {
  recordId?: string;
  subDomain: string;
  recordType: string;
  recordLine: string;
  value: string;
  ttl: string;
  mx: string;
  status: "ENABLE" | "DISABLE";
  remark: string;
};

export type ProviderOption = {
  value: ProviderKey;
  label: string;
  shortLabel: string;
  status: string;
  endpoint: string;
  secretIdLabel: string;
  secretIdPlaceholder: string;
  secretKeyLabel: string;
  secretKeyPlaceholder: string;
  regionLabel: string;
  regionPlaceholder: string;
};
