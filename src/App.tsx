import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type PublicConfig = {
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
  domainId: number;
  name: string;
  status: string;
  dnsStatus: string;
  gradeTitle: string;
  recordCount: number;
  remark: string;
  updatedOn: string;
};

type DnsRecord = {
  recordId: number;
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
  recordId?: number;
  subDomain: string;
  recordType: string;
  recordLine: string;
  value: string;
  ttl: string;
  mx: string;
  status: "ENABLE" | "DISABLE";
};

const defaultEndpoint = "https://dnspod.tencentcloudapi.com";
const recordTypes = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "CAA", "SRV"];
const emptyRecordForm: RecordForm = {
  subDomain: "www",
  recordType: "A",
  recordLine: "默认",
  value: "",
  ttl: "600",
  mx: "0",
  status: "ENABLE",
};

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览模式不能调用腾讯云 API，请使用 Tauri 桌面应用。");
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
  };
}

function draftsFromRecords(records: DnsRecord[]) {
  return records.reduce<Record<number, RecordForm>>((nextDrafts, record) => {
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
    original.status !== draft.status
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
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretKeySaved, setSecretKeySaved] = useState(false);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [region, setRegion] = useState("");
  const [domain, setDomain] = useState("");
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [recordDrafts, setRecordDrafts] = useState<Record<number, RecordForm>>({});
  const [recordForm, setRecordForm] = useState<RecordForm>(emptyRecordForm);
  const [notice, setNotice] = useState("未连接 DNSPod");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const desktopReady = useMemo(() => isTauriRuntime(), []);

  const activeDomain = useMemo(
    () => domains.find((item) => item.name === domain),
    [domain, domains],
  );

  useEffect(() => {
    if (!desktopReady) {
      setNotice("浏览器预览模式");
      return;
    }

    invokeCommand<PublicConfig | null>("load_config")
      .then((config) => {
        if (!config) {
          setConfigOpen(true);
          return;
        }
        setSecretId(config.secretId);
        setSecretKeySaved(config.secretKeySaved);
        setEndpoint(config.endpoint || defaultEndpoint);
        setRegion(config.region || "");
        setNotice(config.secretKeySaved ? "配置已加载" : "未保存 Key");
      })
      .catch((error) => setNotice(toMessage(error)));
  }, [desktopReady]);

  async function persistConfig() {
    const config = await invokeCommand<PublicConfig>("save_config", {
      config: {
        secretId,
        secretKey,
        endpoint,
        region,
      },
    });
    setSecretKey("");
    setSecretKeySaved(config.secretKeySaved);
    setEndpoint(config.endpoint);
    setRegion(config.region);
    return config;
  }

  async function requestVerify() {
    const result = await invokeCommand<VerifyResult>("verify_config");
    setVerifyResult(result);
    setDomains(result.domains || []);
    setNotice(`已同步 ${result.domains?.length || 0} 个域名`);
    return result;
  }

  async function saveConfig(verifyAfter = false) {
    setBusy(verifyAfter ? "save-verify" : "save");
    setVerifyResult(null);
    try {
      await persistConfig();
      if (verifyAfter) {
        const result = await requestVerify();
        const firstDomain = result.domains?.[0]?.name;
        if (!domain.trim() && firstDomain) {
          await loadRecords(firstDomain);
        }
        setConfigOpen(false);
      } else {
        setDomains([]);
        setRecords([]);
        setRecordDrafts({});
        setNotice("配置已保存");
      }
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function verifyConfig() {
    setBusy("verify");
    try {
      const result = await requestVerify();
      const nextDomain = domain.trim() || result.domains?.[0]?.name;
      if (nextDomain) {
        await loadRecords(nextDomain);
      }
      setConfigOpen(false);
    } catch (error) {
      setVerifyResult(null);
      setDomains([]);
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshCurrent() {
    if (domain.trim()) {
      await loadRecords(domain);
      return;
    }
    if (secretKeySaved) {
      await verifyConfig();
      return;
    }
    setConfigOpen(true);
  }

  async function loadRecords(nextDomain = domain) {
    const cleanDomain = nextDomain.trim();
    if (!cleanDomain) {
      setNotice("未选择域名");
      return;
    }

    setBusy("list");
    try {
      const nextRecords = await invokeCommand<DnsRecord[]>("list_records", {
        domain: cleanDomain,
      });
      setDomain(cleanDomain);
      setRecords(nextRecords);
      setRecordDrafts(draftsFromRecords(nextRecords));
      setRecordForm(emptyRecordForm);
      setNotice(`${cleanDomain}：${nextRecords.length} 条记录`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function updateDraft(recordId: number, patch: Partial<RecordForm>) {
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

  function recordPayload(form: RecordForm, recordId?: number) {
    return {
      domain: domain.trim(),
      recordId,
      subDomain: form.subDomain.trim(),
      recordType: form.recordType.trim(),
      recordLine: form.recordLine.trim(),
      value: form.value.trim(),
      ttl: Number(form.ttl || 600),
      mx: Number(form.mx || 0),
      status: form.status,
    };
  }

  async function saveInlineRecord(record: DnsRecord) {
    const draft = recordDrafts[record.recordId];
    if (!draft || !hasRecordChanges(record, draft)) return;

    setBusy(`update-${record.recordId}`);
    try {
      await invokeCommand("update_record", {
        input: recordPayload(draft, record.recordId),
      });
      await loadRecords(domain);
      setNotice(`${recordTitle(record, domain)} 已保存`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function createRecord() {
    if (!domain.trim()) {
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
      await loadRecords(domain);
      setNotice("解析记录已新增");
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeRecord(record: DnsRecord) {
    const fullName = recordTitle(record, domain);
    const confirmed = window.confirm(`确认删除 ${fullName} 这条解析记录吗？`);
    if (!confirmed) return;

    setBusy(`delete-${record.recordId}`);
    try {
      await invokeCommand("delete_record", {
        domain: domain.trim(),
        recordId: record.recordId,
      });
      await loadRecords(domain);
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
            <p>{domain || "未选择域名"}</p>
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
            title={domain ? "刷新解析记录" : "同步域名"}
            aria-label={domain ? "刷新解析记录" : "同步域名"}
          >
            <RefreshIcon />
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setRecordForm(emptyRecordForm);
              setAddOpen(true);
            }}
            disabled={!domain || busy !== null || !desktopReady}
          >
            <PlusIcon />
            添加
          </button>
          <button
            className="tool-button"
            onClick={() => setConfigOpen(true)}
            title="配置"
          >
            <SettingsIcon />
            配置
          </button>
        </div>
      </header>

      <section className="domain-strip">
        {domains.map((item) => (
          <button
            className={item.name === domain ? "domain-chip active" : "domain-chip"}
            key={item.domainId || item.name}
            onClick={() => loadRecords(item.name)}
            disabled={busy !== null || !desktopReady}
            title={item.remark || item.name}
          >
            <strong>{item.name}</strong>
            <span>{item.recordCount} 条</span>
          </button>
        ))}
        {!domains.length && (
          <button className="domain-chip empty" onClick={() => setConfigOpen(true)}>
            <strong>{secretKeySaved ? "同步域名" : "配置 DNSPod"}</strong>
            <span>{desktopReady ? "Ready" : "Preview"}</span>
          </button>
        )}
      </section>

      <section className="records-panel">
        <div className="table-header">
          <div>
            <strong>{activeDomain?.name || domain || "解析记录"}</strong>
            <span>{records.length} 条记录</span>
          </div>
          {activeDomain?.dnsStatus && <em>DNS {activeDomain.dnsStatus}</em>}
        </div>

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
                        disabled={locked}
                      >
                        <option value="ENABLE">启用</option>
                        <option value="DISABLE">暂停</option>
                      </select>
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
              <strong>{domain ? "暂无解析记录" : "未选择域名"}</strong>
              <button className="primary-button" onClick={() => setConfigOpen(true)}>
                <SettingsIcon />
                {secretKeySaved ? "同步域名" : "配置"}
              </button>
            </div>
          )}
        </div>
      </section>

      {configOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="腾讯云配置">
            <div className="modal-header">
              <div>
                <h2>腾讯云配置</h2>
                <p>{secretKeySaved ? "已保存 Key" : "未保存 Key"}</p>
              </div>
              <button className="icon-button" onClick={() => setConfigOpen(false)} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>

            <div className="modal-form">
              <label>
                SecretId
                <input
                  value={secretId}
                  onChange={(event) => setSecretId(event.currentTarget.value)}
                  placeholder="AKID..."
                  spellCheck={false}
                />
              </label>
              <label>
                SecretKey
                <input
                  value={secretKey}
                  onChange={(event) => setSecretKey(event.currentTarget.value)}
                  placeholder={secretKeySaved ? "留空保留已保存 SecretKey" : "创建时展示一次的 SecretKey"}
                  spellCheck={false}
                  type="password"
                />
              </label>
              <label>
                API Endpoint
                <input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.currentTarget.value)}
                  placeholder={defaultEndpoint}
                  spellCheck={false}
                />
              </label>
              <label>
                Region
                <input
                  value={region}
                  onChange={(event) => setRegion(event.currentTarget.value)}
                  placeholder="通常可留空"
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => saveConfig(false)} disabled={busy !== null || !desktopReady}>
                {busy === "save" ? "保存中" : "只保存"}
              </button>
              <button className="secondary-button" onClick={verifyConfig} disabled={busy !== null || !desktopReady || !secretKeySaved}>
                {busy === "verify" ? "验证中" : "验证连接"}
              </button>
              <button className="primary-button" onClick={() => saveConfig(true)} disabled={busy !== null || !desktopReady}>
                {busy === "save-verify" ? "处理中" : "保存并验证"}
              </button>
            </div>
          </section>
        </div>
      )}

      {addOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal compact-modal" role="dialog" aria-modal="true" aria-label="添加记录">
            <div className="modal-header">
              <div>
                <h2>添加记录</h2>
                <p>{domain}</p>
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
                  placeholder="默认"
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
                >
                  <option value="ENABLE">启用</option>
                  <option value="DISABLE">暂停</option>
                </select>
              </label>
              <label className="span-2">
                记录值
                <textarea
                  value={recordForm.value}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, value: event.currentTarget.value })
                  }
                  placeholder="IP、CNAME、TXT 内容或其它记录值"
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
