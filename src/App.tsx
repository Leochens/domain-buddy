import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type ProviderKey = "tencent" | "cloudflare" | "aliyun";

type PublicConfig = {
  provider: ProviderKey;
  secretId: string;
  secretKeySaved: boolean;
  endpoint: string;
  region: string;
};

type VerifyResult = {
  ok: boolean;
  message: string;
  requestId?: string;
  domainCount?: number;
  domains: DomainSummary[];
};

type DomainSummary = {
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

type DnsRecord = {
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

type RecordForm = {
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

type ProviderOption = {
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

const providerOptions: ProviderOption[] = [
  {
    value: "tencent",
    label: "腾讯云 DNSPod",
    shortLabel: "DNSPod",
    status: "已支持",
    endpoint: "https://dnspod.tencentcloudapi.com",
    secretIdLabel: "SecretId",
    secretIdPlaceholder: "AKID...",
    secretKeyLabel: "SecretKey",
    secretKeyPlaceholder: "创建时展示一次的 SecretKey",
    regionLabel: "Region",
    regionPlaceholder: "通常可留空",
  },
  {
    value: "cloudflare",
    label: "Cloudflare",
    shortLabel: "Cloudflare",
    status: "已支持",
    endpoint: "https://api.cloudflare.com/client/v4",
    secretIdLabel: "Account ID",
    secretIdPlaceholder: "可选，留空也可以",
    secretKeyLabel: "API Token",
    secretKeyPlaceholder: "需要 Zone Read / DNS Edit 权限",
    regionLabel: "Region",
    regionPlaceholder: "Cloudflare 可留空",
  },
  {
    value: "aliyun",
    label: "阿里云 DNS",
    shortLabel: "Aliyun",
    status: "配置预留",
    endpoint: "https://alidns.aliyuncs.com",
    secretIdLabel: "AccessKeyId",
    secretIdPlaceholder: "LTAI...",
    secretKeyLabel: "AccessKeySecret",
    secretKeyPlaceholder: "阿里云访问密钥",
    regionLabel: "Region",
    regionPlaceholder: "例如 cn-hangzhou",
  },
];

const recordTypes = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "CAA", "SRV", "HTTPS", "SVCB"];
const emptyRecordForm: RecordForm = {
  subDomain: "www",
  recordType: "A",
  recordLine: "默认",
  value: "",
  ttl: "600",
  mx: "0",
  status: "ENABLE",
  remark: "",
};

function providerMeta(provider: ProviderKey) {
  return providerOptions.find((item) => item.value === provider) || providerOptions[0];
}

function domainKey(domain: DomainSummary) {
  return `${domain.provider}:${domain.domainId || domain.name}`;
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览模式不能调用供应商 API，请使用 Tauri 桌面应用。");
  }
  return invoke<T>(command, args);
}

function recordToForm(record: DnsRecord): RecordForm {
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

function draftsFromRecords(records: DnsRecord[]) {
  return records.reduce<Record<string, RecordForm>>((nextDrafts, record) => {
    nextDrafts[record.recordId] = recordToForm(record);
    return nextDrafts;
  }, {});
}

function hasRecordChanges(record: DnsRecord, draft: RecordForm) {
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

function recordTitle(record: DnsRecord, domain: string) {
  return record.name === "@" ? domain : `${record.name}.${domain}`;
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.8 9A7 7 0 0 0 6.3 6.2L4 8.5" />
      <path d="M5.2 15A7 7 0 0 0 17.7 17.8L20 15.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V21a2 2 0 0 1-4 0v-.2a1.8 1.8 0 0 0-1.2-1.7 1.8 1.8 0 0 0-2 .4l-.1.1A2 2 0 0 1 3.8 17l.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1.1H2.5a2 2 0 0 1 0-4h.2A1.8 1.8 0 0 0 4.3 8a1.8 1.8 0 0 0-.4-2l-.1-.1A2 2 0 1 1 6.6 3l.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 9.8 2h.4a2 2 0 0 1 4 0v.2a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1A2 2 0 1 1 20.2 6l-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1.1h.1a2 2 0 0 1 0 4h-.2a1.8 1.8 0 0 0-1.9 1.8Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m6 6 1 15h10l1-15" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function App() {
  const [configs, setConfigs] = useState<PublicConfig[]>([]);
  const [configProvider, setConfigProvider] = useState<ProviderKey>("tencent");
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretKeySaved, setSecretKeySaved] = useState(false);
  const [endpoint, setEndpoint] = useState(providerMeta("tencent").endpoint);
  const [region, setRegion] = useState("");
  const [activeDomainKey, setActiveDomainKey] = useState("");
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [recordDrafts, setRecordDrafts] = useState<Record<string, RecordForm>>({});
  const [recordForm, setRecordForm] = useState<RecordForm>(emptyRecordForm);
  const [notice, setNotice] = useState("未连接供应商");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const desktopReady = useMemo(() => isTauriRuntime(), []);

  const activeDomain = useMemo(
    () => domains.find((item) => domainKey(item) === activeDomainKey),
    [activeDomainKey, domains],
  );
  const configFormProvider = providerMeta(configProvider);
  const activeProviderLabel = activeDomain?.providerLabel || `${configs.length} 个供应商`;
  const recordValueOptions = useMemo(
    () => Array.from(new Set(records.map((record) => record.value).filter(Boolean))).sort(),
    [records],
  );

  useEffect(() => {
    if (!desktopReady) {
      setNotice("浏览器预览模式");
      return;
    }

    invokeCommand<PublicConfig[]>("load_configs")
      .then((nextConfigs) => {
        setConfigs(nextConfigs);
        if (nextConfigs.length) {
          applyConfigToForm(nextConfigs[0].provider, nextConfigs);
          setNotice(`已加载 ${nextConfigs.length} 个供应商配置`);
        } else {
          setConfigOpen(true);
        }
      })
      .catch((error) => setNotice(toMessage(error)));
  }, [desktopReady]);

  function configForProvider(provider: ProviderKey, source = configs) {
    return source.find((item) => item.provider === provider);
  }

  function applyConfigToForm(provider: ProviderKey, source = configs) {
    const existing = configForProvider(provider, source);
    const meta = providerMeta(provider);
    setConfigProvider(provider);
    setSecretId(existing?.secretId || "");
    setSecretKey("");
    setSecretKeySaved(Boolean(existing?.secretKeySaved));
    setEndpoint(existing?.endpoint || meta.endpoint);
    setRegion(existing?.region || "");
  }

  function mergeProviderDomains(provider: ProviderKey, nextDomains: DomainSummary[]) {
    setDomains((current) => [
      ...current.filter((item) => item.provider !== provider),
      ...nextDomains,
    ]);
  }

  async function persistConfig() {
    const config = await invokeCommand<PublicConfig>("save_config", {
      config: {
        provider: configProvider,
        secretId,
        secretKey,
        endpoint,
        region,
      },
    });
    setConfigs((current) => [
      ...current.filter((item) => item.provider !== config.provider),
      config,
    ]);
    applyConfigToForm(config.provider, [
      ...configs.filter((item) => item.provider !== config.provider),
      config,
    ]);
    return config;
  }

  async function verifyCurrentProvider() {
    setBusy("verify");
    try {
      const result = await invokeCommand<VerifyResult>("verify_config", {
        provider: configProvider,
      });
      setVerifyResult(result);
      mergeProviderDomains(configProvider, result.domains || []);
      const firstDomain = result.domains?.[0];
      if (!activeDomain && firstDomain) {
        await loadRecords(firstDomain);
      }
      setNotice(`${providerMeta(configProvider).shortLabel} 已同步 ${result.domains?.length || 0} 个域名`);
      setConfigOpen(false);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function syncAllProviders() {
    setBusy("sync-all");
    try {
      const result = await invokeCommand<VerifyResult>("verify_all_configs");
      setVerifyResult(result);
      setDomains(result.domains || []);
      const activeStillExists = result.domains?.some((item) => domainKey(item) === activeDomainKey);
      const nextDomain = activeStillExists
        ? result.domains.find((item) => domainKey(item) === activeDomainKey)
        : result.domains?.[0];
      if (nextDomain) {
        await loadRecords(nextDomain);
      } else {
        setActiveDomainKey("");
        setRecords([]);
        setRecordDrafts({});
      }
      setNotice(result.message);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig(syncAfter = false) {
    setBusy(syncAfter ? "save-sync" : "save");
    try {
      await persistConfig();
      setNotice(`${providerMeta(configProvider).shortLabel} 配置已保存`);
      if (syncAfter) {
        await syncAllProviders();
        setConfigOpen(false);
      }
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshCurrent() {
    if (activeDomain) {
      await loadRecords(activeDomain);
      return;
    }
    if (configs.length) {
      await syncAllProviders();
      return;
    }
    setConfigOpen(true);
  }

  async function loadRecords(target = activeDomain) {
    if (!target) {
      setNotice("未选择域名");
      return;
    }

    setBusy("list");
    try {
      const nextRecords = await invokeCommand<DnsRecord[]>("list_records", {
        provider: target.provider,
        domain: target.name,
      });
      setActiveDomainKey(domainKey(target));
      setRecords(nextRecords);
      setRecordDrafts(draftsFromRecords(nextRecords));
      setRecordForm(emptyRecordForm);
      setNotice(`${target.providerLabel} · ${target.name}：${nextRecords.length} 条记录`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function updateDraft(recordId: string, patch: Partial<RecordForm>) {
    setRecordDrafts((current) => ({
      ...current,
      [recordId]: {
        ...(current[recordId] || emptyRecordForm),
        ...patch,
      },
    }));
  }

  function resetDraft(record: DnsRecord) {
    setRecordDrafts((current) => ({
      ...current,
      [record.recordId]: recordToForm(record),
    }));
  }

  function recordPayload(form: RecordForm, recordId?: string) {
    if (!activeDomain) {
      throw new Error("未选择域名");
    }
    return {
      provider: activeDomain.provider,
      domain: activeDomain.name,
      recordId,
      subDomain: form.subDomain.trim(),
      recordType: form.recordType.trim(),
      recordLine: form.recordLine.trim(),
      value: form.value.trim(),
      ttl: Number(form.ttl || 600),
      mx: Number(form.mx || 0),
      status: form.status,
      remark: form.remark.trim(),
    };
  }

  async function saveInlineRecord(record: DnsRecord) {
    if (!activeDomain) return;
    const draft = recordDrafts[record.recordId];
    if (!draft || !hasRecordChanges(record, draft)) return;

    setBusy(`update-${record.recordId}`);
    try {
      await invokeCommand("update_record", {
        input: recordPayload(draft, record.recordId),
      });
      await loadRecords(activeDomain);
      setNotice(`${recordTitle(record, activeDomain.name)} 已保存`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function createRecord() {
    if (!activeDomain) {
      setNotice("未选择域名");
      return;
    }

    setBusy("create");
    try {
      await invokeCommand("create_record", {
        input: recordPayload(recordForm),
      });
      setAddOpen(false);
      setRecordForm(emptyRecordForm);
      await loadRecords(activeDomain);
      setNotice("解析记录已新增");
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeRecord(record: DnsRecord) {
    if (!activeDomain) return;
    const fullName = recordTitle(record, activeDomain.name);
    const confirmed = window.confirm(`确认删除 ${fullName} 这条解析记录吗？`);
    if (!confirmed) return;

    setBusy(`delete-${record.recordId}`);
    try {
      await invokeCommand("delete_record", {
        provider: activeDomain.provider,
        domain: activeDomain.name,
        recordId: record.recordId,
      });
      await loadRecords(activeDomain);
      setNotice(`${fullName} 已删除`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">DB</div>
          <div>
            <h1>Domain Buddy</h1>
            <p>
              {activeProviderLabel}
              {activeDomain ? ` · ${activeDomain.name}` : " · 未选择域名"}
            </p>
          </div>
        </div>

        <div className="toolbar">
          <span className={verifyResult?.ok ? "connection on" : "connection"}>
            {notice}
          </span>
          <button
            className="icon-button"
            onClick={refreshCurrent}
            disabled={busy !== null || !desktopReady}
            title={activeDomain ? "刷新解析记录" : "同步全部供应商"}
            aria-label={activeDomain ? "刷新解析记录" : "同步全部供应商"}
          >
            <RefreshIcon />
          </button>
          <button
            className="secondary-button"
            onClick={syncAllProviders}
            disabled={!configs.length || busy !== null || !desktopReady}
          >
            同步全部
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setRecordForm(emptyRecordForm);
              setAddOpen(true);
            }}
            disabled={!activeDomain || busy !== null || !desktopReady}
          >
            <PlusIcon />
            添加
          </button>
          <button className="tool-button" onClick={() => setConfigOpen(true)} title="配置">
            <SettingsIcon />
            配置
          </button>
        </div>
      </header>

      <section className="domain-strip">
        {domains.map((item) => (
          <button
            className={domainKey(item) === activeDomainKey ? "domain-chip active" : "domain-chip"}
            key={domainKey(item)}
            onClick={() => loadRecords(item)}
            disabled={busy !== null || !desktopReady}
            title={item.remark || item.name}
          >
            <span className="provider-badge">{item.providerLabel}</span>
            <strong>{item.name}</strong>
            <span>{item.recordCount ? `${item.recordCount} 条记录` : item.status || "可用"}</span>
          </button>
        ))}
        {!domains.length && (
          <button className="domain-chip empty" onClick={() => setConfigOpen(true)}>
            <span className="provider-badge">{configs.length ? "All" : "Setup"}</span>
            <strong>{configs.length ? "同步全部供应商" : "添加供应商配置"}</strong>
            <span>{desktopReady ? `${configs.length} 个配置` : "Preview"}</span>
          </button>
        )}
      </section>

      <section className="records-panel">
        <div className="table-header">
          <div>
            <strong>{activeDomain?.name || "解析记录"}</strong>
            <span>{records.length} 条记录</span>
          </div>
          {activeDomain?.providerLabel && <em>{activeDomain.providerLabel}</em>}
        </div>

        <datalist id="record-value-options">
          {recordValueOptions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>

        <div className="records-table">
          <table>
            <thead>
              <tr>
                <th>主机</th>
                <th>类型</th>
                <th>线路</th>
                <th>记录值</th>
                <th>TTL</th>
                <th>状态</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const draft = recordDrafts[record.recordId] || recordToForm(record);
                const changed = hasRecordChanges(record, draft);
                const locked = record.defaultNs || busy !== null || !desktopReady;

                return (
                  <tr key={record.recordId} className={record.defaultNs ? "system-row" : ""}>
                    <td>
                      <input
                        className="table-control host-control"
                        value={draft.subDomain}
                        onChange={(event) =>
                          updateDraft(record.recordId, { subDomain: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                      <small>{record.recordId}</small>
                    </td>
                    <td>
                      <select
                        className="table-control"
                        value={draft.recordType}
                        onChange={(event) =>
                          updateDraft(record.recordId, { recordType: event.currentTarget.value })
                        }
                        disabled={locked}
                      >
                        {recordTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="table-control line-control"
                        value={draft.recordLine}
                        onChange={(event) =>
                          updateDraft(record.recordId, { recordLine: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                    </td>
                    <td>
                      <input
                        className="table-control value-control"
                        value={draft.value}
                        list="record-value-options"
                        onChange={(event) =>
                          updateDraft(record.recordId, { value: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                    </td>
                    <td>
                      <input
                        className="table-control ttl-control"
                        value={draft.ttl}
                        onChange={(event) =>
                          updateDraft(record.recordId, { ttl: event.currentTarget.value })
                        }
                        disabled={locked}
                        inputMode="numeric"
                      />
                    </td>
                    <td>
                      <select
                        className="table-control status-control"
                        value={draft.status}
                        onChange={(event) =>
                          updateDraft(record.recordId, {
                            status: event.currentTarget.value as RecordForm["status"],
                          })
                        }
                        disabled={locked || activeDomain?.provider === "cloudflare"}
                      >
                        <option value="ENABLE">启用</option>
                        <option value="DISABLE">暂停</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="table-control remark-control"
                        value={draft.remark}
                        onChange={(event) =>
                          updateDraft(record.recordId, { remark: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="mini-button save"
                          onClick={() => saveInlineRecord(record)}
                          disabled={!changed || locked}
                          title="保存"
                          aria-label="保存"
                        >
                          <SaveIcon />
                        </button>
                        <button
                          className="mini-button"
                          onClick={() => resetDraft(record)}
                          disabled={!changed || locked}
                          title="还原"
                          aria-label="还原"
                        >
                          <UndoIcon />
                        </button>
                        <button
                          className="mini-button danger"
                          onClick={() => removeRecord(record)}
                          disabled={record.defaultNs || busy === `delete-${record.recordId}` || !desktopReady}
                          title={record.defaultNs ? "系统 NS 记录" : "删除"}
                          aria-label="删除"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!records.length && (
            <div className="empty-state">
              <strong>{activeDomain ? "暂无解析记录" : "未选择域名"}</strong>
              <button className="primary-button" onClick={() => setConfigOpen(true)}>
                <SettingsIcon />
                {configs.length ? "同步域名" : "配置"}
              </button>
            </div>
          )}
        </div>
      </section>

      {configOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="供应商配置">
            <div className="modal-header">
              <div>
                <h2>供应商配置</h2>
                <p>
                  {configFormProvider.label} · {secretKeySaved ? "已保存凭证" : configFormProvider.status}
                </p>
              </div>
              <button className="icon-button" onClick={() => setConfigOpen(false)} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>

            <div className="provider-tabs">
              {providerOptions.map((item) => {
                const saved = Boolean(configForProvider(item.value));
                return (
                  <button
                    key={item.value}
                    className={configProvider === item.value ? "provider-tab active" : "provider-tab"}
                    onClick={() => applyConfigToForm(item.value)}
                  >
                    <strong>{item.shortLabel}</strong>
                    <span>{saved ? "已保存" : item.status}</span>
                  </button>
                );
              })}
            </div>

            <div className="modal-form">
              <label>
                {configFormProvider.secretIdLabel}
                <input
                  value={secretId}
                  onChange={(event) => setSecretId(event.currentTarget.value)}
                  placeholder={configFormProvider.secretIdPlaceholder}
                  spellCheck={false}
                />
              </label>
              <label>
                {configFormProvider.secretKeyLabel}
                <input
                  value={secretKey}
                  onChange={(event) => setSecretKey(event.currentTarget.value)}
                  placeholder={secretKeySaved ? "留空保留已保存凭证" : configFormProvider.secretKeyPlaceholder}
                  spellCheck={false}
                  type="password"
                />
              </label>
              <label>
                API Endpoint
                <input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.currentTarget.value)}
                  placeholder={configFormProvider.endpoint}
                  spellCheck={false}
                />
              </label>
              <label>
                {configFormProvider.regionLabel}
                <input
                  value={region}
                  onChange={(event) => setRegion(event.currentTarget.value)}
                  placeholder={configFormProvider.regionPlaceholder}
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => saveConfig(false)} disabled={busy !== null || !desktopReady}>
                {busy === "save" ? "保存中" : "保存此供应商"}
              </button>
              <button className="secondary-button" onClick={verifyCurrentProvider} disabled={busy !== null || !desktopReady || !secretKeySaved}>
                {busy === "verify" ? "验证中" : "验证此供应商"}
              </button>
              <button className="primary-button" onClick={() => saveConfig(true)} disabled={busy !== null || !desktopReady}>
                {busy === "save-sync" || busy === "sync-all" ? "同步中" : "保存并同步全部"}
              </button>
            </div>
          </section>
        </div>
      )}

      {addOpen && activeDomain && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal compact-modal" role="dialog" aria-modal="true" aria-label="添加记录">
            <div className="modal-header">
              <div>
                <h2>添加记录</h2>
                <p>
                  {activeDomain.providerLabel} · {activeDomain.name}
                </p>
              </div>
              <button className="icon-button" onClick={() => setAddOpen(false)} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>

            <div className="modal-form two-column">
              <label>
                主机
                <input
                  value={recordForm.subDomain}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, subDomain: event.currentTarget.value })
                  }
                  placeholder="@ 或 www"
                  spellCheck={false}
                />
              </label>
              <label>
                类型
                <select
                  value={recordForm.recordType}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, recordType: event.currentTarget.value })
                  }
                >
                  {recordTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                线路
                <input
                  value={recordForm.recordLine}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, recordLine: event.currentTarget.value })
                  }
                  placeholder={activeDomain.provider === "cloudflare" ? "DNS only 或 Proxied" : "默认"}
                />
              </label>
              <label>
                TTL
                <input
                  value={recordForm.ttl}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, ttl: event.currentTarget.value })
                  }
                  inputMode="numeric"
                />
              </label>
              <label>
                MX
                <input
                  value={recordForm.mx}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, mx: event.currentTarget.value })
                  }
                  inputMode="numeric"
                />
              </label>
              <label>
                状态
                <select
                  value={recordForm.status}
                  onChange={(event) =>
                    setRecordForm({
                      ...recordForm,
                      status: event.currentTarget.value as RecordForm["status"],
                    })
                  }
                  disabled={activeDomain.provider === "cloudflare"}
                >
                  <option value="ENABLE">启用</option>
                  <option value="DISABLE">暂停</option>
                </select>
              </label>
              <label className="span-2">
                记录值
                <input
                  value={recordForm.value}
                  list="record-value-options"
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, value: event.currentTarget.value })
                  }
                  placeholder="IP、CNAME、TXT 内容或其它记录值"
                  spellCheck={false}
                />
              </label>
              <label className="span-2">
                备注
                <textarea
                  value={recordForm.remark}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, remark: event.currentTarget.value })
                  }
                  placeholder="内部备注，不影响 DNS 解析"
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setAddOpen(false)} disabled={busy !== null}>
                取消
              </button>
              <button className="primary-button" onClick={createRecord} disabled={busy !== null || !desktopReady}>
                {busy === "create" ? "添加中" : "添加记录"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
