import type { DnsRecord, DomainSummary, RecordForm } from "./types";

export const recordTypes = [
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "MX",
  "NS",
  "CAA",
  "SRV",
  "HTTPS",
  "SVCB",
];

export const emptyRecordForm: RecordForm = {
  subDomain: "www",
  recordType: "A",
  recordLine: "默认",
  value: "",
  ttl: "600",
  mx: "0",
  status: "ENABLE",
  remark: "",
};

export function domainKey(domain: DomainSummary) {
  return `${domain.provider}:${domain.domainId || domain.name}`;
}

export function recordToForm(record: DnsRecord): RecordForm {
  return {
    recordId: record.recordId,
    subDomain: record.name || "@",
    recordType: record.recordType || "A",
    recordLine: record.line || "默认",
    value: record.value,
    ttl: String(record.ttl || 600),
    mx: String(record.mx || 0),
    status: record.status === "DISABLE" ? "DISABLE" : "ENABLE",
    remark: record.remark || "",
  };
}

export function draftsFromRecords(records: DnsRecord[]) {
  return records.reduce<Record<string, RecordForm>>((nextDrafts, record) => {
    nextDrafts[record.recordId] = recordToForm(record);
    return nextDrafts;
  }, {});
}

export function hasRecordChanges(record: DnsRecord, draft: RecordForm) {
  const original = recordToForm(record);
  return (
    original.subDomain !== draft.subDomain.trim() ||
    original.recordType !== draft.recordType ||
    original.recordLine !== draft.recordLine.trim() ||
    original.value !== draft.value.trim() ||
    original.ttl !== draft.ttl.trim() ||
    original.mx !== draft.mx.trim() ||
    original.status !== draft.status ||
    original.remark !== draft.remark.trim()
  );
}

export function recordTitle(record: DnsRecord, domain: string) {
  return record.name === "@" ? domain : `${record.name}.${domain}`;
}
